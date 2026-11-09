import { useRef, useState } from 'react';
import { Link, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSession } from '../use-session';
import PortalBottomMenu from './PortalBottomMenu';
import { nombre_rol, opciones_portal } from '../config/portal';

export default function PortalShell({ children }) {
  const { empleado, salir } = useSession();
  const { width, fontScale } = useWindowDimensions();
  const pathname = usePathname();
  const android = Platform.OS === 'android';
  const wide = !android && width >= 900;
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState('');
  const pending = useRef(false);
  if (!empleado) return null;
  const opciones = opciones_portal(empleado.rol);
  const mostrar_etiquetas = width >= 16 + opciones.length * 72 * Math.max(1, fontScale);
  async function cerrar() {
    if (pending.current) return;
    pending.current = true;
    set_loading(true);
    set_error('');
    try { await salir(); }
    catch { set_error('No se pudo cerrar sesión. Revisa tu conexión e inténtalo de nuevo.'); }
    finally { pending.current = false; set_loading(false); }
  }
  return <SafeAreaView style={styles.safe} edges={android ? ['top', 'left', 'right'] : undefined}>
    <StatusBar style="dark" />
    <View style={[styles.layout, wide && styles.desktop]}>
      {!android ? <View style={[styles.navigation, wide && styles.sidebar]}>
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
      </View> : null}
      <View style={styles.body}>
        <View style={[styles.topbar, !wide && styles.mobileTopbar, android && styles.androidTopbar]}>
          {android ? <View style={[styles.logo, styles.androidLogo]}><Text style={styles.androidLogoText}>L</Text></View> : null}
          <View style={styles.identity}><Text style={styles.userName} numberOfLines={1}>{empleado.nombre} {empleado.apellido}</Text><Text style={styles.userRole}>{nombre_rol(empleado.rol)}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar sesión" disabled={loading} accessibilityState={{ disabled: loading, busy: loading }} onPress={cerrar} style={({ pressed }) => [styles.logout, pressed && styles.pressed]}>
            {loading ? <ActivityIndicator size="small" color="#2563eb" /> : null}<Text style={styles.logoutText}>{loading ? 'Cerrando…' : android ? 'Salir' : 'Cerrar sesión'}</Text>
          </Pressable>
        </View>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <ScrollView style={styles.content} contentContainerStyle={[styles.contentInner, wide && styles.desktopContent, android && styles.androidContent]}>{children}</ScrollView>
      </View>
    </View>
    {android ? <PortalBottomMenu opciones={opciones} pathname={pathname} mostrar_etiquetas={mostrar_etiquetas} /> : null}
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
  androidTopbar: { paddingHorizontal: 16, minHeight: 64, gap: 12 },
  androidLogo: { width: 34, height: 34, borderRadius: 11 },
  androidLogoText: { color: '#fff', fontSize: 22, fontWeight: '800' },
  identity: { flex: 1, minWidth: 0 },
  userName: { fontSize: 14, fontWeight: '600', color: '#33435c' }, userRole: { fontSize: 11, color: '#8a97ac', marginTop: 4 },
  logout: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#f0f5ff' },
  logoutText: { fontSize: 12, color: '#2563eb', fontWeight: '600' },
  content: { flex: 1 }, contentInner: { padding: 24, paddingTop: 32, paddingBottom: 48 }, desktopContent: { padding: 44 },
  androidContent: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 24 },
  error: { backgroundColor: '#fff0f0', color: '#b42333', padding: 16, fontSize: 13 },
});
