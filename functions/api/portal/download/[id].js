import { error, findClientMaterial, objectKey } from '../../../_portal.js';

export async function onRequestGet({ env, data, params }) {
  const material = await findClientMaterial(env.PORTAL_DB, data.clientEmail, params.id);
  if (!material) return error('Archivo no disponible.', 404);
  const object = await env.AUSO_DOWNLOADS.get(objectKey(material.id));
  if (!object) return error('Archivo no disponible.', 404);
  const name = encodeURIComponent(material.filename).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16));
  return new Response(object.body, { headers: {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="material"; filename*=UTF-8''${name}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  } });
}
