import { LOGIN_URL, PUBLIC_API_KEY } from '../config/login.js';

async function solicitar(accion, body = {}, token) {
  if (!LOGIN_URL) throw new Error('Configura LOGIN_URL en src/config/login.js.');
  let endpoint;
  try { endpoint = new URL(LOGIN_URL); } catch {
    throw new Error('Revisa la URL de acceso en src/config/login.js.');
  }
  if (endpoint.protocol !== 'https:' || !endpoint.pathname.endsWith('/functions/v1/login-empleado')) {
    throw new Error('Usa la URL HTTPS que termina en /functions/v1/login-empleado.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    if (accion !== 'login') endpoint.pathname = endpoint.pathname.replace(/login-empleado$/, 'sesion-empleado');
    const response = await fetch(endpoint.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(PUBLIC_API_KEY ? { apikey: PUBLIC_API_KEY } : {}),
        ...(token ? { 'x-session-token': token } : {}),
      },
      body: JSON.stringify({ ...body, accion }),
      signal: controller.signal,
    });
    let data;
    try { data = await response.json(); } catch {
      throw new Error('El servidor devolvió una respuesta inválida.');
    }
    if (!response.ok) {
      if (response.status === 401) {
        const error = new Error(accion === 'login' ? 'ID, correo o contraseña incorrectos, o cuenta inactiva.' : 'Tu sesión ha vencido. Inicia sesión de nuevo.');
        error.status = 401;
        throw error;
      }
      if (response.status === 429) throw new Error('Demasiados intentos. Inténtalo más tarde.');
      throw new Error('No se pudo procesar la solicitud. Inténtalo más tarde.');
    }
    if (accion === 'cerrar' && data?.ok === true) return data;
    if (data?.ok !== true || !Number.isInteger(data.empleado?.id) ||
      typeof data.empleado?.nombre !== 'string' ||
      !['empleado', 'administrativo'].includes(data.empleado?.rol)) {
      throw new Error('El servidor devolvió una respuesta de acceso inesperada.');
    }
    const expires_at = accion === 'login' ? data.session?.expires_at : data.expires_at;
    if (!Number.isFinite(Date.parse(expires_at)) || Date.parse(expires_at) <= Date.now() ||
      (accion === 'login' && !/^[a-f0-9]{64}$/.test(data.session?.token ?? ''))) {
      throw new Error('Actualiza las funciones de Supabase para activar las sesiones. Consulta LOGIN.md.');
    }
    return { empleado: data.empleado, token: data.session?.token ?? token, expires_at };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('La solicitud tardó demasiado. Inténtalo de nuevo.');
    if (error instanceof TypeError) throw new Error('No se pudo conectar. Revisa tu conexión a internet y la URL de la función.');
    throw error;
  } finally { clearTimeout(timeout); }
}

export const verificar_credenciales = (identificador, password) => solicitar('login', { identificador: identificador.trim(), password });
export const validar_sesion = (token) => solicitar('validar', {}, token);
export const cerrar_sesion = (token) => solicitar('cerrar', {}, token);
