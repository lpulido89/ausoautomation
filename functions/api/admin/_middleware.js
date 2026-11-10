/* AUSO administrator account: ONLY this identity may make admin API requests.
   Cloudflare Access must additionally protect both /admin/* and /api/admin/*.
   Do not reuse this identity gate for future Client Portal users. */
const AUSO_ADMIN_EMAIL = 'leonardo.pulido89@gmail.com';
function decodeB64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(decodeB64Url(value)));
}

async function verifyAccessJwt(request, env) {
  const domain = String(env.CF_ACCESS_TEAM_DOMAIN || '').trim().replace(/\/$/, '');
  const aud = String(env.CF_ACCESS_AUD || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(domain) || !aud) {
    return { configured: false, ok: false };
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return { configured: true, ok: false };
  const parts = token.split('.');
  if (parts.length !== 3) return { configured: true, ok: false };
  try {
    const header = decodeJson(parts[0]);
    const payload = decodeJson(parts[1]);
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== 'RS256' || !header.kid ||
      payload.iss !== domain ||
      !Array.isArray(payload.aud) || !payload.aud.includes(aud) ||
      String(payload.email || '').trim().toLowerCase() !== AUSO_ADMIN_EMAIL ||
      typeof payload.exp !== 'number' || payload.exp <= now ||
      (typeof payload.nbf === 'number' && payload.nbf > now)) {
      return { configured: true, ok: false };
    }
    const response = await fetch(`${domain}/cdn-cgi/access/certs`);
    if (!response.ok) return { configured: true, ok: false };
    const certs = await response.json();
    const jwk = (certs.keys || []).find((key) => key.kid === header.kid && key.kty === 'RSA');
    if (!jwk) return { configured: true, ok: false };
    const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const signatureValid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, decodeB64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    return { configured: true, ok: signatureValid };
  } catch {
    return { configured: true, ok: false };
  }
}

export async function onRequest(context) {
  const auth = await verifyAccessJwt(context.request, context.env);
  const headers = { 'Cache-Control': 'no-store' };
  if (!auth.configured) return Response.json({ error: 'Admin authentication not configured' }, { status: 503, headers });
  if (!auth.ok) return Response.json({ error: 'Access denied' }, { status: 403, headers });
  const origin = context.request.headers.get('Origin');
  if (origin && origin !== new URL(context.request.url).origin) {
    return Response.json({ error: 'Access denied' }, { status: 403, headers });
  }
  const result = new Response(await context.next());
  result.headers.set('Cache-Control', 'no-store');
  return result;
}
