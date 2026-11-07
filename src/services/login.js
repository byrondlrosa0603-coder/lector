import { LOGIN_URL, PUBLIC_API_KEY } from '../config/login.js';

export async function verificar_credenciales(identificador, password) {
  if (!LOGIN_URL) throw new Error('Add LOGIN_URL in src/config/login.js.');
  let endpoint;
  try { endpoint = new URL(LOGIN_URL); } catch {
    throw new Error('Check the login URL in src/config/login.js.');
  }
  if (endpoint.protocol !== 'https:' || !endpoint.pathname.endsWith('/functions/v1/login-empleado')) {
    throw new Error('Use the HTTPS URL ending in /functions/v1/login-empleado.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(endpoint.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(PUBLIC_API_KEY ? { apikey: PUBLIC_API_KEY } : {}),
      },
      body: JSON.stringify({ identificador: identificador.trim(), password }),
      signal: controller.signal,
    });
    let data;
    try { data = await response.json(); } catch {
      throw new Error('The server returned an invalid response.');
    }
    if (!response.ok) {
      if (response.status === 401) throw new Error('Incorrect ID, email or password, or inactive account.');
      if (response.status === 429) throw new Error('Too many attempts. Please try again later.');
      throw new Error('Unable to sign in. Please try again later.');
    }
    if (data?.ok !== true || !Number.isInteger(data.empleado?.id) ||
      typeof data.empleado?.nombre !== 'string' ||
      !['empleado', 'administrativo'].includes(data.empleado?.rol)) {
      throw new Error('The server returned an unexpected login response.');
    }
    // Solo presentación: estos datos no autorizan operaciones posteriores.
    const { id, nombre, apellido, correo, rol } = data.empleado;
    return { id, nombre, apellido, correo, rol };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The request timed out. Please try again.');
    if (error instanceof TypeError) throw new Error('Unable to connect. Check your internet connection and function URL.');
    throw error;
  } finally { clearTimeout(timeout); }
}
