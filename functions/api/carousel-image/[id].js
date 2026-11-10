const VALID_ID = /^[a-f0-9-]{36}\.(?:jpg|png|webp)$/i;

export async function readCarouselImage(id, env, includeInactive = false) {
  if (!VALID_ID.test(id)) return new Response('Not found', { status: 404 });
  if (!env.AUSO_MEDIA) return new Response('Media storage not configured', { status: 503 });
  const manifest = await env.AUSO_MEDIA.get('carousel/manifest.json');
  const slides = manifest ? (await manifest.json()).slides : [];
  if (!Array.isArray(slides) || !slides.some(slide => slide.id === id && (includeInactive || slide.active === true))) {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const item = await env.AUSO_MEDIA.get(`carousel/images/${id}`);
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
