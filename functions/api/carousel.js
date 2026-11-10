const MANIFEST_KEY = 'carousel/manifest.json';

export async function onRequestGet({ env }) {
  if (!env.AUSO_MEDIA) return Response.json({ error: 'Media storage not configured' }, { status: 503 });
  try {
    const item = await env.AUSO_MEDIA.get(MANIFEST_KEY);
    const manifest = item ? await item.json() : { slides: [] };
    const slides = (Array.isArray(manifest.slides) ? manifest.slides : [])
      .filter((slide) => slide.active === true)
      .map(({ id, title, description }) => ({
        id,
        title,
        description,
        image: `/api/carousel-image/${encodeURIComponent(id)}`,
      }));
    return Response.json({ slides }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Could not load carousel' }, { status: 500 });
  }
}
