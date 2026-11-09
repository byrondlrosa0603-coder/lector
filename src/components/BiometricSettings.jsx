import { useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../use-session';

export default function BiometricSettings() {
  const { capacidad, biometria, cambiar_biometria, persistente, acceso_huella, quitar_acceso_huella } = useSession();
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState('');
  const pending = useRef(false);
  if (Platform.OS === 'web') return null;
  async function ejecutar(accion) {
    if (pending.current) return;
    pending.current = true;
    set_loading(true);
    set_error('');
    try { await accion(); }
    catch (failure) { set_error(failure.message || 'No se pudo cambiar la opción. Inténtalo de nuevo.'); }
    finally { pending.current = false; set_loading(false); }
  }
  return <View style={styles.card}>
    <Text style={styles.tag}>SEGURIDAD DEL DISPOSITIVO · OPCIONAL</Text>
    <Text style={styles.title}>Desbloqueo con huella</Text>
    <Text style={styles.description}>{biometria
      ? 'Activado. Al volver a la app, tu celular solicitará su biometría para abrir tu sesión.'
      : 'Activa el lector de tu celular para desbloquear tu sesión sin escribir la contraseña.'}</Text>
    <Text style={styles.note}>La huella permanece en el teléfono. También puedes entrar con contraseña. El sistema puede ofrecer otra biometría fuerte registrada en el dispositivo.</Text>
    {!persistente ? <Text style={styles.note}>Para desbloquear la sesión guardada, inicia sesión marcando «Mantener sesión iniciada».</Text> : capacidad.disponible || biometria ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: loading, busy: loading }} disabled={loading} onPress={() => ejecutar(() => cambiar_biometria(!biometria))} style={styles.button}>
      {loading ? <ActivityIndicator size="small" color="#2563eb" /> : null}
      <Text style={styles.buttonText}>{loading ? 'Configurando…' : biometria ? 'Desactivar desbloqueo con huella' : 'Activar desbloqueo con huella'}</Text>
    </Pressable> : <Text style={styles.note}>{capacidad.motivo}</Text>}
    {Platform.OS === 'android' && acceso_huella ? <>
      <Text style={styles.note}>Hay una cuenta guardada en este teléfono para entrar con huella después de cerrar sesión.</Text>
      <Pressable accessibilityRole="button" disabled={loading} onPress={() => ejecutar(quitar_acceso_huella)} style={styles.button}>
        <Text style={styles.buttonText}>Eliminar credenciales guardadas</Text>
      </Pressable>
    </> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { marginTop: 24, padding: 24, backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: '#e3eafa' },
  tag: { fontSize: 9, fontWeight: '700', letterSpacing: 1, color: '#2563eb', marginBottom: 14 },
  title: { fontSize: 20, fontWeight: '700', color: '#142745' },
  description: { fontSize: 14, lineHeight: 23, color: '#64748b', marginTop: 12 },
  note: { fontSize: 12, lineHeight: 20, color: '#718096', marginTop: 12 },
  button: { alignSelf: 'flex-start', minHeight: 48, padding: 14, marginTop: 18, borderRadius: 12, backgroundColor: '#edf3ff', flexDirection: 'row', gap: 10, alignItems: 'center' },
  buttonText: { color: '#2563eb', fontSize: 13, fontWeight: '600', flexShrink: 1 },
  error: { color: '#b42333', fontSize: 13, lineHeight: 20, marginTop: 12 },
});
