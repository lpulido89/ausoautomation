export const MAX_FILE = 50 * 1024 * 1024;
const privateHeaders = { 'Cache-Control': 'private, no-store' };

export const json = (value, status = 200) => Response.json(value, { status, headers: privateHeaders });
export const error = (message, status) => json({ error: message }, status);
export const ready = env => Boolean(env.PORTAL_DB && env.AUSO_DOWNLOADS);
export const objectKey = id => `materials/${id}`;

export function listClientCourses(db, email) {
  return db.prepare(`
    SELECT c.id AS course_id, c.title, m.id AS material_id, m.filename, m.size
    FROM enrollments e JOIN courses c ON c.id = e.course_id
    LEFT JOIN materials m ON m.course_id = c.id
    WHERE e.email = ? ORDER BY c.title, c.id, m.filename
  `).bind(email).all();
}

export function findClientMaterial(db, email, id) {
  return db.prepare(`
    SELECT m.id, m.filename FROM materials m
    JOIN enrollments e ON e.course_id = m.course_id
    WHERE e.email = ? AND m.id = ?
  `).bind(email, id).first();
}
