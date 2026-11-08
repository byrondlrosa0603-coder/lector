const key = 'lector.session.web';
const legacy_key = 'lector.session';
export const DURACION_TEMPORAL_MS = 30 * 60 * 1000;

function leer_registro() {
  // Descarta el antiguo token por pestaña para evitar recuperarlo tras un logout.
  window.sessionStorage.removeItem(legacy_key);
  let raw = window.localStorage.getItem(key);
  if (!raw) {
    const legacy = window.localStorage.getItem(legacy_key);
    if (!legacy) return null;
    raw = JSON.stringify({ token: legacy, mantener: true, hasta: null });
    window.localStorage.setItem(key, raw);
    window.localStorage.removeItem(legacy_key);
  }
  try {
    const registro = JSON.parse(raw);
    if (typeof registro.token !== 'string' || !registro.token || typeof registro.mantener !== 'boolean' ||
      (!registro.mantener && (!Number.isFinite(registro.hasta) || registro.hasta <= Date.now()))) throw new Error('Sesión local vencida');
    return registro;
  } catch {
    if (window.localStorage.getItem(key) === raw) window.localStorage.removeItem(key);
    return null;
  }
}
export async function leer_token() { return leer_registro()?.token ?? null; }
export async function leer_persistencia() { return leer_registro()?.mantener ?? false; }
export async function leer_expiracion() { return leer_registro()?.hasta ?? null; }
export async function guardar_token(token, mantener = false) {
  const registro = { token, mantener, hasta: mantener ? null : Date.now() + DURACION_TEMPORAL_MS };
  // Un solo registro evita que otras pestañas lean token y plazo de cuentas distintas.
  window.sessionStorage.removeItem(legacy_key);
  window.localStorage.removeItem(legacy_key);
  window.localStorage.setItem(key, JSON.stringify(registro));
}
export async function borrar_token() {
  window.sessionStorage.removeItem(legacy_key);
  window.localStorage.removeItem(legacy_key);
  window.localStorage.removeItem(key);
}
export async function leer_biometria() { return false; }
export async function capacidad_biometrica() { return { disponible: false, motivo: 'La huella está disponible solo en la app móvil.' }; }
export async function activar_biometria() { throw new Error('Disponible solo en la app móvil.'); }
export async function desactivar_biometria() {}
