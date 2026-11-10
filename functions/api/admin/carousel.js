import { mediaBucket } from '../../_media.js';

const MANIFEST = 'carousel/manifest.json';
const MAX_SLIDES = 24;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const allowedMime = new Map([['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp']]);
class ManifestConflict extends Error {}

function failure(cause, message) {
  return cause instanceof ManifestConflict ? error('Gallery changed. Reload the page and try again.', 409) : error(message, 500);
}

function error(message, status = 400) {
  return Response.json({ error: message }, { status });
}

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

async function getSlides(env) {
  const item = await mediaBucket(env).get(MANIFEST);
  if (!item) return { slides: [], etag: null };
  const data = await item.json();
  if (!Array.isArray(data.slides)) throw new Error('Invalid manifest');
  return { slides: data.slides, etag: item.httpEtag };
}

async function saveSlides(env, slides, etag) {
  const result = await mediaBucket(env).put(MANIFEST, JSON.stringify({ version: 1, slides }), {
    onlyIf: etag ? new Headers({ 'If-Match': etag }) : new Headers({ 'If-None-Match': '*' }),
    httpMetadata: { contentType: 'application/json' },
  });
  if (result === null) throw new ManifestConflict();
}

function extensionFor(bytes) {
  const has = (arr) => arr.every((n, i) => bytes[i] === n);
  if (has([0xff, 0xd8, 0xff])) return '.jpg';
  if (has([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return '.png';
  if (has([0x52, 0x49, 0x46, 0x46]) &&
      hasAt(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return '.webp';
  return null;
}

function hasAt(bytes, values, offset) {
  return values.every((n, i) => bytes[offset + i] === n);
}

export async function onRequestGet({ env }) {
  if (!mediaBucket(env)) return error('R2 is not configured', 503);
  try {
    const { slides, etag } = await getSlides(env);
    return Response.json({ slides, etag }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return error('Could not read the carousel', 500); }
}

export async function onRequestPost({ request, env }) {
  if (!mediaBucket(env)) return error('R2 is not configured', 503);
  if (Number(request.headers.get('content-length') || 0) > MAX_IMAGE_BYTES + 30000) return error('Image exceeds 8 MB', 413);
  let data;
  try { data = await request.formData(); } catch { return error('Invalid upload form'); }
  const file = data.get('image');
  if (!file || typeof file.arrayBuffer !== 'function' || typeof file.size !== 'number') return error('Choose an image');
  if (file.size < 20 || file.size > MAX_IMAGE_BYTES) return error('Image must be smaller than 8 MB', 413);
  if (!allowedMime.has(file.type)) return error('Only JPG, PNG and WebP are accepted');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = extensionFor(bytes.slice(0, 16));
  if (!ext || ext !== allowedMime.get(file.type)) return error('Invalid image format');
  try {
    const { slides, etag } = await getSlides(env);
    if (slides.length >= MAX_SLIDES) return error('Maximum of 24 images reached');
    const id = crypto.randomUUID() + ext;
    await mediaBucket(env).put(`carousel/images/${id}`, bytes, {
      httpMetadata: { contentType: file.type },
    });
    const slide = {
      id,
      title: text(data.get('title'), 100),
      description: text(data.get('description'), 250),
      active: true,
      createdAt: new Date().toISOString(),
    };
    try { await saveSlides(env, [...slides, slide], etag); }
    catch (e) { await mediaBucket(env).delete(`carousel/images/${id}`); throw e; }
    return Response.json({ slide }, { status: 201 });
  } catch (cause) { return failure(cause, 'Could not save image'); }
}

export async function onRequestPatch({ request, env }) {
  if (!mediaBucket(env)) return error('R2 is not configured', 503);
  let body;
  try { body = await request.json(); } catch { return error('Invalid JSON'); }
  if (!Array.isArray(body?.slides) || body.slides.length > MAX_SLIDES || body.slides.some(item => !item || typeof item.id !== 'string')) return error('Invalid slide list');
  try {
    const { slides: existing, etag } = await getSlides(env);
    if (body.etag !== etag) throw new ManifestConflict();
    const byId = new Map(existing.map((item) => [item.id, item]));
    const ids = body.slides.map((item) => item.id);
    if (ids.length !== existing.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) {
      return error('Slide list does not match existing records', 409);
    }
    const slides = body.slides.map((item) => ({
      ...byId.get(item.id),
      title: text(item.title, 100),
      description: text(item.description, 250),
      active: item.active === true,
    }));
    await saveSlides(env, slides, etag);
    return Response.json({ slides });
  } catch (cause) { return failure(cause, 'Could not update carousel'); }
}

export async function onRequestDelete({ request, env }) {
  if (!mediaBucket(env)) return error('R2 is not configured', 503);
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return error('Missing image id');
  try {
    const { slides, etag } = await getSlides(env);
    if (!slides.some((slide) => slide.id === id)) return error('Image not found', 404);
    await saveSlides(env, slides.filter((slide) => slide.id !== id), etag);
    await mediaBucket(env).delete(`carousel/images/${id}`);
    return Response.json({ success: true });
  } catch (cause) { return failure(cause, 'Could not delete image'); }
}
