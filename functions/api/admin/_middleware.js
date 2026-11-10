import { verifyAccessJwt } from '../../_access.js';

/* AUSO administrator account: ONLY this identity may make admin API requests.
   Cloudflare Access must additionally protect both /admin/* and /api/admin/*.
   Do not reuse this identity gate for future Client Portal users. */
const AUSO_ADMIN_EMAIL = 'leonardo.pulido89@gmail.com';
export async function onRequest(context) {
  const auth = await verifyAccessJwt(context.request, context.env);
  const headers = { 'Cache-Control': 'no-store' };
  if (!auth.configured) return Response.json({ error: 'Admin authentication not configured' }, { status: 503, headers });
  if (!auth.ok || auth.email !== AUSO_ADMIN_EMAIL) return Response.json({ error: 'Access denied' }, { status: 403, headers });
  const origin = context.request.headers.get('Origin');
  if (origin && origin !== new URL(context.request.url).origin) {
    return Response.json({ error: 'Access denied' }, { status: 403, headers });
  }
  const result = await context.next();
  const response = new Response(result.body, result);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
