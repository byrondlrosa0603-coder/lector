import { Redirect, useLocalSearchParams } from 'expo-router';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../../use-session';
import { modulos_edicion, nombre_rol, opciones_portal } from '../../config/portal';
import BiometricSettings from '../../components/BiometricSettings';

export default function PortalScreen() {
  const { seccion } = useLocalSearchParams();
  const { empleado } = useSession();
  if (!empleado) return <Redirect href="/" />;
  if (seccion === 'empleados' && empleado.rol === 'administrativo') return <Redirect href="/editar" />;
  const opcion = opciones_portal(empleado.rol).find((item) => item.ruta === seccion);
  // Comprueba también las rutas escritas directamente en el navegador.
  if (!opcion) return <Redirect href="/inicio" />;
  const inicio = seccion === 'inicio';
  const editar = seccion === 'editar';
  const android = Platform.OS === 'android';
  const nombre = `${empleado.nombre} ${empleado.apellido ?? ''}`.trim();
  const iniciales = `${empleado.nombre?.[0] ?? ''}${empleado.apellido?.[0] ?? ''}`.toUpperCase();
  return <View style={styles.page}>
    <Text style={styles.eyebrow}>{nombre_rol(empleado.rol).toUpperCase()} / {opcion.titulo.toUpperCase()}</Text>
    <Text accessibilityRole="header" style={styles.heading}>{inicio ? 'Tu espacio de trabajo' : opcion.titulo}</Text>
    <Text style={styles.subtitle}>{inicio ? 'Tu acceso y tu asistencia, en un solo lugar.' : editar ? 'Módulos previstos para consultar y editar datos.' : 'Esta sección está lista para incorporar su contenido.'}</Text>
    {inicio ? <View style={[styles.welcome, android && styles.androidWelcome]}>
      <View style={[styles.welcomeTop, android && styles.androidWelcomeTop]}>
        <View style={[styles.avatar, android && styles.androidAvatar]}><Text style={styles.initials}>{iniciales}</Text></View>
        <View style={[styles.identity, android && styles.androidIdentity]}>
          <Text style={styles.greeting}>TE DAMOS LA BIENVENIDA</Text>
          <Text style={styles.name}>{nombre}</Text>
          <View style={styles.role}><View style={styles.dot} /><Text style={styles.roleText}>{nombre_rol(empleado.rol)}</Text></View>
        </View>
      </View>
      <View style={styles.details}>
        <View style={styles.detail}><Text style={styles.label}>ID DE EMPLEADO</Text><Text style={styles.value}>{empleado.id}</Text></View>
        <View style={styles.detail}><Text style={styles.label}>CORREO ELECTRÓNICO</Text><Text style={styles.value}>{empleado.correo || 'Sin correo registrado'}</Text></View>
      </View>
    </View> : editar ? <View style={styles.editGrid}>
      {modulos_edicion.map(modulo => (
        <View key={modulo.titulo} style={styles.editCard}>
          <View style={styles.editBadge}><Text style={styles.editBadgeText}>{modulo.sigla}</Text></View>
          <Text accessibilityRole="header" style={styles.editTitle}>{modulo.titulo}</Text>
          <Text style={styles.editDescription}>{modulo.descripcion}</Text>
        </View>
      ))}
    </View> : <View style={styles.placeholder}>
      <View style={styles.placeholderIcon}><Text style={styles.symbol}>{opcion.simbolo}</Text></View>
      <Text style={styles.emptyTitle}>{opcion.titulo}</Text>
      <Text style={styles.emptyText}>Próximamente encontrarás aquí las opciones de esta sección.</Text>
    </View>}
    {inicio ? <BiometricSettings /> : null}
  </View>;
}
const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 1040, alignSelf: 'center' },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.7, color: '#2563eb', marginBottom: 14 },
  heading: { fontSize: 30, fontWeight: '800', color: '#142745', letterSpacing: -0.8 },
  subtitle: { fontSize: 14, lineHeight: 23, color: '#718096', marginTop: 10, marginBottom: 32 },
  welcome: { backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderColor: '#e3eafa', padding: 28, boxShadow: '0 10px 40px rgba(34,71,136,0.04)' },
  androidWelcome: { padding: 20 },
  welcomeTop: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, alignItems: 'center' },
  avatar: { width: 76, height: 76, backgroundColor: '#eaf1ff', borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  androidWelcomeTop: { flexWrap: 'nowrap', gap: 14 },
  androidAvatar: { width: 54, height: 54, borderRadius: 17 },
  initials: { fontSize: 26, color: '#2563eb', fontWeight: '700' },
  identity: { flex: 1, minWidth: 150 },
  androidIdentity: { minWidth: 0 },
  greeting: { fontSize: 9, fontWeight: '700', color: '#718096', letterSpacing: 1.4 },
  name: { fontSize: 25, fontWeight: '700', color: '#142745', marginVertical: 10 },
  role: { flexDirection: 'row', gap: 7, alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#edf4ff', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  dot: { height: 5, width: 5, borderRadius: 3, backgroundColor: '#2563eb' },
  roleText: { color: '#2458c0', fontWeight: '600', fontSize: 12 },
  details: { flexDirection: 'row', flexWrap: 'wrap', gap: 28, borderTopWidth: 1, borderTopColor: '#edf1f7', marginTop: 28, paddingTop: 24 },
  detail: { minWidth: 140, flexShrink: 1 },
  label: { color: '#7c8ca4', fontSize: 9, fontWeight: '600', letterSpacing: 1.2, marginBottom: 9 },
  value: { color: '#33435c', fontSize: 14, lineHeight: 22 },
  editGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  editCard: { flexGrow: 1, flexShrink: 1, flexBasis: 240, minWidth: 0, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3eafa', borderRadius: 20, padding: 20 },
  editBadge: { alignSelf: 'flex-start', minWidth: 40, padding: 10, borderRadius: 12, backgroundColor: '#edf4ff', alignItems: 'center' },
  editBadgeText: { fontSize: 11, fontWeight: '700', color: '#2563eb' },
  editTitle: { fontSize: 18, fontWeight: '700', color: '#142745', marginTop: 14 },
  editDescription: { fontSize: 13, lineHeight: 21, color: '#64748b', marginTop: 8 },
  placeholder: { alignItems: 'center', paddingHorizontal: 28, paddingVertical: 64, backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderColor: '#e3eafa' },
  placeholderIcon: { height: 60, width: 60, backgroundColor: '#edf4ff', borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  symbol: { fontSize: 28, color: '#2563eb' },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#142745' },
  emptyText: { fontSize: 14, lineHeight: 23, color: '#718096', textAlign: 'center', maxWidth: 340, marginTop: 12 },
});
