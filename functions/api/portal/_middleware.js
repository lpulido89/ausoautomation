import { verifyAccessJwt } from '../../_access.js';
import { error, ready } from '../../_portal.js';

export async function onRequest(context) {
  const { request, env, data } = context;
  const preview = new URL(request.url).hostname.endsWith('.ausoautomation.pages.dev');
  const auth = await verifyAccessJwt(request, env, env.CF_PORTAL_ACCESS_AUD || (preview ? env.CF_ACCESS_AUD : ''));
  if (!auth.configured) return error('El acceso al portal todavía no está configurado.', 503);
  if (!auth.ok) return error('Inicia sesión con tu correo autorizado.', 403);
  if (!ready(env)) return error('El almacenamiento de materiales todavía no está configurado.', 503);
  data.clientEmail = auth.email;
  return context.next();
}
