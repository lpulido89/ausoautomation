function decodeB64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(decodeB64Url(value)));
}

export async function verifyAccessJwt(request, env, audience = env.CF_ACCESS_AUD) {
  const domain = String(env.CF_ACCESS_TEAM_DOMAIN || '').trim().replace(/\/$/, '');
  const aud = String(audience || '').trim();
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
      typeof payload.email !== 'string' || !payload.email.trim() ||
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
    return { configured: true, ok: signatureValid, email: signatureValid ? payload.email.trim().toLowerCase() : undefined };
  } catch {
    return { configured: true, ok: false };
  }
}
