import { useRef, useState } from 'react';
import { Link, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSession } from '../use-session';
import { nombre_rol, opciones_portal } from '../config/portal';

export default function PortalShell({ children }) {
  const { empleado, salir } = useSession();
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const wide = width >= 900;
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState('');
  const pending = useRef(false);
  if (!empleado) return null;
  const opciones = opciones_portal(empleado.rol);
  async function cerrar() {
    if (pending.current) return;
    pending.current = true;
    set_loading(true);
    set_error('');
    try { await salir(); }
    catch { set_error('No se pudo cerrar sesión. Revisa tu conexión e inténtalo de nuevo.'); }
    finally { pending.current = false; set_loading(false); }
  }
  return <SafeAreaView style={styles.safe}>
    <StatusBar style="dark" />
    <View style={[styles.layout, wide && styles.desktop]}>
      <View style={[styles.navigation, wide && styles.sidebar]}>
        <View style={styles.brandRow}>
          <View style={styles.logo}><Text style={styles.logoText}>L</Text></View>
          <View><Text style={styles.brand}>lector<Text style={styles.blue}>.</Text></Text><Text style={styles.caption}>ASISTENCIA Y ACCESO</Text></View>
        </View>
        {wide ? <Text style={styles.menuLabel}>ESPACIO {nombre_rol(empleado.rol).toUpperCase()}</Text> : null}
        <ScrollView horizontal={!wide} style={wide ? styles.desktopMenu : styles.mobileMenu} contentContainerStyle={wide ? styles.verticalMenu : styles.horizontalMenu} showsHorizontalScrollIndicator={false}>
          {opciones.map((item) => {
            const active = pathname === `/${item.ruta}`;
            return <Link key={item.ruta} href={`/${item.ruta}`} asChild>
              <Pressable accessibilityRole="link" accessibilityState={{ selected: active }} style={({ pressed }) => [styles.navItem, wide && styles.wideItem, active && styles.activeItem, pressed && styles.pressed]}>
                <Text style={[styles.navSymbol, active && styles.activeText]}>{item.simbolo}</Text>
                <Text style={[styles.navText, active && styles.activeText]}>{item.titulo}</Text>
              </Pressable>
            </Link>;
          })}
        </ScrollView>
        {wide ? <View style={styles.sidebarFooter}><View style={styles.statusDot} /><Text style={styles.sidebarFooterText}>Tu espacio, conectado</Text></View> : null}
      </View>
      <View style={styles.body}>
        <View style={[styles.topbar, !wide && styles.mobileTopbar]}>
          <View style={styles.identity}><Text style={styles.userName} numberOfLines={1}>{empleado.nombre} {empleado.apellido}</Text><Text style={styles.userRole}>{nombre_rol(empleado.rol)}</Text></View>
          <Pressable accessibilityRole="button" disabled={loading} accessibilityState={{ disabled: loading, busy: loading }} onPress={cerrar} style={({ pressed }) => [styles.logout, pressed && styles.pressed]}>
            {loading ? <ActivityIndicator size="small" color="#2563eb" /> : null}<Text style={styles.logoutText}>{loading ? 'Cerrando…' : 'Cerrar sesión'}</Text>
          </Pressable>
        </View>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <ScrollView style={styles.content} contentContainerStyle={[styles.contentInner, wide && styles.desktopContent]}>{children}</ScrollView>
      </View>
    </View>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f8ff' },
  layout: { flex: 1 }, desktop: { flexDirection: 'row' },
  navigation: { backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#e5ecf8', paddingTop: 18 },
  sidebar: { width: 240, borderRightWidth: 1, borderBottomWidth: 0, paddingTop: 32, paddingHorizontal: 18 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 18, marginBottom: 18 },
  logo: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#fff', fontSize: 26, fontWeight: '800' },
  brand: { color: '#142745', fontSize: 25, fontWeight: '800', letterSpacing: -1 },
  blue: { color: '#2563eb' },
  caption: { fontSize: 8, color: '#718096', letterSpacing: 1.4 },
  menuLabel: { fontSize: 9, color: '#8a97ac', letterSpacing: 1.2, fontWeight: '600', marginTop: 32, marginBottom: 16, marginLeft: 14 },
  desktopMenu: { flex: 1 }, mobileMenu: { flexGrow: 0 },
  verticalMenu: { gap: 8 }, horizontalMenu: { gap: 6, paddingHorizontal: 18, paddingBottom: 14 },
  navItem: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: 12 },
  wideItem: { width: '100%' }, activeItem: { backgroundColor: '#edf3ff' },
  navSymbol: { width: 20, textAlign: 'center', color: '#718096', fontSize: 21 },
  navText: { fontSize: 13, fontWeight: '600', color: '#718096' }, activeText: { color: '#2563eb' }, pressed: { opacity: 0.7 },
  sidebarFooter: { flexDirection: 'row', gap: 8, alignItems: 'center', marginVertical: 28, marginLeft: 14 },
  statusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#2563eb' },
  sidebarFooterText: { color: '#8a97ac', fontSize: 10 },
  body: { flex: 1, minWidth: 0 },
  topbar: { minHeight: 88, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5ecf8', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 36, gap: 12 },
  mobileTopbar: { paddingHorizontal: 24, minHeight: 76 },
  identity: { flex: 1, minWidth: 0 },
  userName: { fontSize: 14, fontWeight: '600', color: '#33435c' }, userRole: { fontSize: 11, color: '#8a97ac', marginTop: 4 },
  logout: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#f0f5ff' },
  logoutText: { fontSize: 12, color: '#2563eb', fontWeight: '600' },
  content: { flex: 1 }, contentInner: { padding: 24, paddingTop: 32, paddingBottom: 48 }, desktopContent: { padding: 44 },
  error: { backgroundColor: '#fff0f0', color: '#b42333', padding: 16, fontSize: 13 },
});
