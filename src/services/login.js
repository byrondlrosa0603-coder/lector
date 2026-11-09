import { LOGIN_URL, PUBLIC_API_KEY } from '../config/login.js';

async function solicitar_funcion(nombre, body, token, signal) {
  if (!LOGIN_URL) throw new Error('Configura LOGIN_URL en src/config/login.js.');
  let endpoint;
  try { endpoint = new URL(LOGIN_URL); } catch {
    throw new Error('Revisa la URL de acceso en src/config/login.js.');
  }
  if (endpoint.protocol !== 'https:' || !endpoint.pathname.endsWith('/functions/v1/login-empleado')) {
    throw new Error('Usa la URL HTTPS que termina en /functions/v1/login-empleado.');
  }
  const controller = new AbortController();
  const cancelar = () => controller.abort();
  if (signal?.aborted) cancelar();
  else signal?.addEventListener('abort', cancelar, { once: true });
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    endpoint.pathname = endpoint.pathname.replace(/login-empleado$/, nombre);
    const response = await fetch(endpoint.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(PUBLIC_API_KEY ? { apikey: PUBLIC_API_KEY } : {}),
        ...(token ? { 'x-session-token': token } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let data;
    try { data = await response.json(); } catch {
      throw new Error('El servidor devolvió una respuesta inválida.');
    }
    return { response, data };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (controller.signal.aborted) throw new Error('La solicitud tardó demasiado. Inténtalo de nuevo.');
    if (error instanceof TypeError) throw new Error('No se pudo conectar. Revisa tu conexión a internet y la URL de la función.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancelar);
  }
}

async function solicitar(accion, body = {}, token) {
  const nombre = accion === 'login' ? 'login-empleado' : 'sesion-empleado';
  const { response, data } = await solicitar_funcion(nombre, { ...body, accion }, token);
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
}

export async function solicitar_catalogo(body, token, signal) {
  let resultado;
  try {
    resultado = await solicitar_funcion('gestionar-catalogos', body, token, signal);
  } catch (error) {
    if (body.accion !== 'crear') throw error;
    throw creacion_sin_confirmar();
  }
  const { response, data } = resultado;
  if (response.status === 401) {
    if (data?.ok === false) throw new Error('Supabase rechazó esta sesión. Vuelve a iniciar sesión e inténtalo de nuevo.');
    throw new Error('Supabase rechazó la solicitud. Revisa la clave pública y Verify JWT en gestionar-catalogos.');
  }
  if (response.status === 403) throw new Error('Se requiere el rol administrativo para consultar los catálogos.');
  if (response.status === 404 && data?.ok !== false) {
    throw new Error('No se encontró gestionar-catalogos en el proyecto de Supabase del login.');
  }
  if (data?.error === 'Acción inválida' && (body.accion === 'crear' || body.accion === 'borrar')) {
    throw new Error('Actualiza el código de gestionar-catalogos en Supabase para habilitar esta acción.');
  }
  if (!response.ok) {
    if (body.accion === 'crear' && response.status >= 500 && data?.ok !== false) throw creacion_sin_confirmar();
    throw new Error(data?.ok === false && data.error ? data.error : 'No se pudo procesar la operación del catálogo.');
  }
  if (data?.ok !== true) {
    if (body.accion === 'crear') throw creacion_sin_confirmar();
    throw new Error('El servidor devolvió una respuesta inesperada.');
  }
  if (body.accion === 'listar') {
    if (!Array.isArray(data.registros) || !data.registros.every(registro => Number.isInteger(registro?.id)) ||
        (data.siguiente_id !== null && (!Number.isInteger(data.siguiente_id) || data.siguiente_id <= (body.despues_de ?? 0)))) {
      throw new Error('El servidor devolvió una lista con un formato inesperado.');
    }
  } else if (body.accion === 'borrar' ? data.id !== body.id : !Number.isInteger(data.registro?.id)) {
    if (body.accion === 'crear') throw creacion_sin_confirmar();
    throw new Error('No se pudo confirmar el resultado. Consulta la lista antes de repetir la operación.');
  }
  return data;
}

function creacion_sin_confirmar() {
  const error = new Error('No se pudo confirmar la creación. Cancela y actualiza la lista antes de intentarlo de nuevo.');
  error.resultado_incierto = true;
  return error;
}

export async function listar_catalogo_completo(gestionar_catalogo, catalogo, signal) {
  const registros = [];
  let cursor = null;
  do {
    const pagina = await gestionar_catalogo({
      accion: 'listar', catalogo, ...(cursor === null ? {} : { despues_de: cursor }),
    }, signal);
    registros.push(...pagina.registros);
    cursor = pagina.siguiente_id;
  } while (cursor !== null);
  return registros;
}

export async function solicitar_huellas(body, token, signal) {
  const { response, data } = await solicitar_funcion('gestionar-huellas', body, token, signal);
  if (response.status === 404 && data?.ok !== false) {
    throw new Error('Despliega gestionar-huellas en el mismo proyecto de Supabase que el login.');
  }
  if (response.status === 401 && data?.ok !== false) {
    throw new Error('Revisa Verify JWT y la clave pública de gestionar-huellas en Supabase.');
  }
  if (!response.ok || data?.ok !== true) {
    const error = new Error(data?.error || 'No se pudo consultar el registro de huellas.');
    error.status = response.status;
    throw error;
  }
  if (body.accion === 'preparar' && (!Array.isArray(data.lectores) || !Array.isArray(data.huellas))) {
    throw new Error('Actualiza gestionar-huellas en Supabase para cargar la lista de huellas.');
  }
  if (!(body.accion === 'preparar' && data.solicitud === null) &&
      (typeof data.solicitud?.id !== 'string' ||
       !['pendiente', 'capturando', 'completada', 'fallida', 'vencida'].includes(data.solicitud?.estado))) {
    throw new Error('El servidor devolvió un estado de captura inesperado.');
  }
  return data;
}

export const verificar_credenciales = (identificador, password) => solicitar('login', { identificador: identificador.trim(), password });
export const validar_sesion = (token) => solicitar('validar', {}, token);
export const cerrar_sesion = (token) => solicitar('cerrar', {}, token);
