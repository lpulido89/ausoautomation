import { error, json, MAX_FILE, objectKey, ready } from '../../_portal.js';

export async function onRequestGet({ env }) {
  if (!ready(env)) return error('Falta conectar la base de datos y el almacenamiento de materiales.', 503);
  const [courses, enrollments, files] = await env.PORTAL_DB.batch([
    env.PORTAL_DB.prepare('SELECT id, title FROM courses ORDER BY title'),
    env.PORTAL_DB.prepare('SELECT email, course_id FROM enrollments ORDER BY email'),
    env.PORTAL_DB.prepare('SELECT id, course_id, filename, size FROM materials ORDER BY filename'),
  ]);
  return json({ courses: courses.results, enrollments: enrollments.results, files: files.results });
}

export async function onRequestPost({ request, env }) {
  if (!ready(env)) return error('Falta conectar la base de datos y el almacenamiento de materiales.', 503);
  const db = env.PORTAL_DB;
  const url = new URL(request.url);
  if (url.searchParams.has('upload')) {
    const course = url.searchParams.get('course');
    const filename = (url.searchParams.get('name') || '').replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim();
    const size = Number(request.headers.get('Content-Length'));
    if (!filename || filename.length > 200 || !request.body || !Number.isInteger(size) || size < 1) {
      return error('Selecciona un archivo válido.', 400);
    }
    if (size > MAX_FILE) return error('El archivo supera los 50 MB.', 413);
    if (!await db.prepare('SELECT id FROM courses WHERE id = ?').bind(course).first()) return error('Curso no encontrado.', 404);
    const id = crypto.randomUUID();
    const stream = new FixedLengthStream(size);
    await Promise.all([
      request.body.pipeTo(stream.writable),
      env.AUSO_DOWNLOADS.put(objectKey(id), stream.readable),
    ]);
    try {
      await db.prepare('INSERT INTO materials (id, course_id, filename, size) VALUES (?, ?, ?, ?)')
        .bind(id, course, filename, size).run();
    } catch (cause) {
      await env.AUSO_DOWNLOADS.delete(objectKey(id));
      throw cause;
    }
    return json({ id }, 201);
  }
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return error('Formato inválido.', 415);
  const body = await request.json().catch(() => null);
  if (body?.action === 'course') {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 100) return error('Escribe un nombre de curso válido.', 400);
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO courses (id, title) VALUES (?, ?)').bind(id, title).run();
    return json({ id }, 201);
  }
  if (body?.action !== 'assign' && body?.action !== 'revoke') return error('Acción inválida.', 400);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof body.course !== 'string') {
    return error('Indica un curso y un correo válido.', 400);
  }
  if (!await db.prepare('SELECT id FROM courses WHERE id = ?').bind(body.course).first()) return error('Curso no encontrado.', 404);
  const sql = body.action === 'assign'
    ? 'INSERT OR IGNORE INTO enrollments (email, course_id) VALUES (?, ?)'
    : 'DELETE FROM enrollments WHERE email = ? AND course_id = ?';
  await db.prepare(sql).bind(email, body.course).run();
  return json({ ok: true });
}
