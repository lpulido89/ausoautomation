import { mediaBucket } from '../../_media.js';

const VALID_ID = /^[a-f0-9-]{36}\.(?:jpg|png|webp)$/i;

export async function readCarouselImage(id, env, includeInactive = false) {
  if (!VALID_ID.test(id)) return new Response('Not found', { status: 404 });
  if (!mediaBucket(env)) return new Response('Media storage not configured', { status: 503 });
  const manifest = await mediaBucket(env).get('carousel/manifest.json');
  const slides = manifest ? (await manifest.json()).slides : [];
  if (!Array.isArray(slides) || !slides.some(slide => slide.id === id && (includeInactive || slide.active === true))) {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const item = await mediaBucket(env).get(`carousel/images/${id}`);
  if (!item) return new Response('Not found', { status: 404 });
  const type = id.endsWith('.png') ? 'image/png' : id.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  return new Response(item.body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function onRequestGet({ params, env }) {
  return readCarouselImage(String(params.id || ''), env);
}
