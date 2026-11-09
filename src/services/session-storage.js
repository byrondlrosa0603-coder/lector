import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

const key = 'lector.session';
// Un token recuperado de SecureStore siempre corresponde a una sesión guardada.
export async function leer_persistencia() { return true; }
export async function leer_expiracion() { return null; }
export function renovar_actividad() { return null; }
export function plazo_actualizado() { return null; }
const protected_key = 'lector.session.biometric';
const preference_key = 'lector.biometric.enabled';
const credentials_key = 'lector.login.credentials';
const account_key = 'lector.login.account';
const protected_options = {
  requireAuthentication: true,
  keychainService: 'lector-biometric-session',
  authenticationPrompt: 'Desbloquea Lector con la biometría de tu celular',
};
const credentials_options = {
  requireAuthentication: true,
  keychainService: 'lector-biometric-login',
  authenticationPrompt: 'Usa tu huella para acceder a las credenciales de Lector',
};
export const leer_biometria = async () => (await SecureStore.getItemAsync(preference_key)) === 'true';
export async function capacidad_biometrica() {
  const hardware = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  if (!hardware || !enrolled || !types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return { disponible: false, motivo: 'Necesitas un lector compatible y una huella registrada en los ajustes del celular.' };
  }
  if (!SecureStore.canUseBiometricAuthentication()) {
    return { disponible: false, motivo: 'La protección biométrica no está disponible en este entorno. Puede requerir una compilación propia de la app.' };
  }
  return { disponible: true, motivo: '' };
}
export async function leer_token(autenticar = false) {
  if (await leer_biometria()) {
    if (!autenticar) return null; // Nunca abrir un diálogo desde restauraciones automáticas.
    return SecureStore.getItemAsync(protected_key, protected_options);
  }
  return SecureStore.getItemAsync(key);
}
export async function guardar_token(token, mantener = false) {
  // Entrar con contraseña establece una sesión nueva y reinicia la opción local.
  await borrar_token();
  if (mantener) await SecureStore.setItemAsync(key, token);
}
export async function activar_biometria(token) {
  const capability = await capacidad_biometrica();
  if (!capability.disponible) throw new Error(capability.motivo);
  await SecureStore.setItemAsync(protected_key, token, protected_options);
  await SecureStore.deleteItemAsync(key);
  await SecureStore.setItemAsync(preference_key, 'true');
}
export async function desactivar_biometria(token) {
  await SecureStore.setItemAsync(key, token);
  await SecureStore.deleteItemAsync(protected_key, protected_options);
  await SecureStore.deleteItemAsync(preference_key);
}
export async function borrar_token() {
  await SecureStore.deleteItemAsync(key);
  await SecureStore.deleteItemAsync(protected_key, protected_options);
  await SecureStore.deleteItemAsync(preference_key);
}

export async function leer_cuenta_huella() {
  const id = Number(await SecureStore.getItemAsync(account_key));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function guardar_credenciales_huella(id, identificador, password) {
  const capacidad = await capacidad_biometrica();
  if (!capacidad.disponible) throw new Error(capacidad.motivo);
  const credenciales = JSON.stringify({ id, identificador: identificador.trim(), password });
  await SecureStore.setItemAsync(credentials_key, credenciales, credentials_options);
  try {
    await SecureStore.setItemAsync(account_key, String(id));
  } catch (error) {
    await borrar_credenciales_huella().catch(() => {});
    throw error;
  }
}

export async function leer_credenciales_huella() {
  const id = await leer_cuenta_huella();
  if (id == null) return null;
  const raw = await SecureStore.getItemAsync(credentials_key, credentials_options);
  if (raw == null) return null;
  try {
    const credenciales = JSON.parse(raw);
    if (credenciales?.id === id && typeof credenciales.identificador === 'string' &&
      credenciales.identificador.trim() && typeof credenciales.password === 'string' && credenciales.password) {
      return credenciales;
    }
  } catch { /* Una entrada dañada requiere volver a guardar las credenciales. */ }
  return null;
}

export async function borrar_credenciales_huella() {
  await SecureStore.deleteItemAsync(credentials_key, credentials_options);
  await SecureStore.deleteItemAsync(account_key);
}
