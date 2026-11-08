import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

const key = 'lector.session';
// Un token recuperado de SecureStore siempre corresponde a una sesión guardada.
export async function leer_persistencia() { return true; }
export async function leer_expiracion() { return null; }
const protected_key = 'lector.session.biometric';
const preference_key = 'lector.biometric.enabled';
const protected_options = {
  requireAuthentication: true,
  keychainService: 'lector-biometric-session',
  authenticationPrompt: 'Desbloquea Lector con la biometría de tu celular',
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
