// Copiar este archivo COMPLETO a login-empleado Y a sesion-empleado.
// Ambas funciones: Verify JWT desactivado; autorización propia por token.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { timingSafeEqual } from 'jsr:@std/crypto/timing-safe-equal';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-session-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const campos = 'id, nombre, apellido, correo, rol, estado, id_area, id_horario';
function responder(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
async function hash_token(token: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function verificar_password(password: string, stored: string) {
  try {
    const [tipo, coste, sal, hash, extra] = stored.split('$');
    if (tipo !== 'pbkdf2' || coste !== '600000' || extra !== undefined) return false;
    const salt = Uint8Array.from(atob(sal), (c) => c.charCodeAt(0));
    const expected = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0));
    if (salt.length !== 16 || expected.length !== 32) return false;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 }, key, 256);
    return timingSafeEqual(new Uint8Array(bits), expected);
  } catch { return false; }
}
const dummy = `pbkdf2$600000$${btoa('\0'.repeat(16))}$${btoa('\0'.repeat(32))}`;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return responder({ error: 'Método no permitido' }, 405);
  let body;
  try { body = await request.json(); } catch { return responder({ error: 'JSON inválido' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return responder({ error: 'Datos inválidos' }, 400);
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    const key = keys.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return responder({ error: 'Configuración incompleta' }, 500);
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const accion = body.accion ?? 'login';

    if (accion === 'validar' || accion === 'cerrar') {
      const token = request.headers.get('x-session-token') ?? '';
      if (!/^[a-f0-9]{64}$/.test(token)) return responder({ error: 'Sesión inválida' }, 401);
      const token_hash = await hash_token(token);
      if (accion === 'cerrar') {
        const { error } = await db.from('sesion_empleado').delete().eq('token_hash', token_hash);
        if (error) return responder({ error: 'No se pudo cerrar la sesión' }, 500);
        return responder({ ok: true });
      }
      const { data: sesion, error } = await db.from('sesion_empleado')
        .select('id_empleado, fecha_expiracion').eq('token_hash', token_hash).maybeSingle();
      if (error) return responder({ error: 'No se pudo validar la sesión' }, 500);
      if (!sesion || Date.parse(sesion.fecha_expiracion) <= Date.now()) return responder({ error: 'Sesión expirada' }, 401);
      const { data: empleado, error: employee_error } = await db.from('empleado')
        .select(campos).eq('id', sesion.id_empleado).maybeSingle();
      if (employee_error) return responder({ error: 'No se pudo consultar el empleado' }, 500);
      if (!empleado?.estado) return responder({ error: 'Sesión inválida' }, 401);
      return responder({ ok: true, empleado, expires_at: sesion.fecha_expiracion });
    }
    if (accion !== 'login') return responder({ error: 'Acción inválida' }, 400);
    const { identificador, password } = body;
    if (!['string', 'number'].includes(typeof identificador) || typeof password !== 'string' || !password || password.length > 128) {
      return responder({ error: 'Credenciales inválidas' }, 400);
    }
    const identifier = String(identificador).trim();
    if (!identifier || identifier.length > 150) return responder({ error: 'Identificador inválido' }, 400);
    const es_id = /^\d+$/.test(identifier);
    if (es_id && (!Number.isSafeInteger(Number(identifier)) || Number(identifier) <= 0 || Number(identifier) > 2147483647)) {
      return responder({ error: 'ID inválido' }, 400);
    }
    let query = db.from('empleado').select(`${campos}, contrasena_hash`);
    query = es_id ? query.eq('id', Number(identifier)) : query.eq('correo', identifier.toLowerCase());
    const { data: empleado, error } = await query.maybeSingle();
    if (error) return responder({ error: 'No se pudo iniciar sesión' }, 500);
    const valid = await verificar_password(password, empleado?.contrasena_hash ?? dummy);
    if (!empleado?.estado || !valid) return responder({ error: 'Credenciales inválidas o cuenta inactiva' }, 401);
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
    const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: session_error } = await db.from('sesion_empleado').insert({
      token_hash: await hash_token(token), id_empleado: empleado.id, fecha_expiracion: expires_at,
    });
    if (session_error) return responder({ error: 'No se pudo crear la sesión' }, 500);
    const { contrasena_hash: _hash, ...perfil } = empleado;
    return responder({ ok: true, empleado: perfil, session: { token, expires_at } });
  } catch { return responder({ error: 'Error interno del servidor' }, 500); }
});
