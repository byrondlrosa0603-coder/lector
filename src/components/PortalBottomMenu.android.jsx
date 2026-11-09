import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const iconos_android = {
  inicio: 'home',
  editar: 'edit',
  asistencia: 'calendar_month',
  solicitudes: 'assignment',
  servicios: 'grid_view',
};

export default function PortalBottomMenu({ opciones, pathname, mostrar_etiquetas }) {
  return (
    <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
      <View style={styles.bottomMenu} accessibilityRole="tablist">
        {opciones.map(item => {
          const activo = pathname === `/${item.ruta}`;
          return (
            <Pressable key={item.ruta} accessibilityRole="tab" accessibilityLabel={item.titulo}
              accessibilityState={{ selected: activo }}
              onPress={() => router.navigate(`/${item.ruta}`)}
              android_ripple={{ color: '#dbeafe' }} style={styles.bottomItem}>
              <View style={[styles.iconSlot, activo && styles.activeItem]}>
                <SymbolView name={{ android: iconos_android[item.ruta] }} size={24}
                  tintColor={activo ? '#2563eb' : '#64748b'}
                  fallback={<Text style={[styles.navSymbol, activo && styles.activeText]}>{item.simbolo}</Text>} />
              </View>
              {mostrar_etiquetas ? <Text numberOfLines={1} style={[styles.bottomLabel, activo && styles.activeText]}>{item.titulo}</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  navSymbol: { width: 20, textAlign: 'center', color: '#718096', fontSize: 21 },
  bottomBar: { alignSelf: 'stretch', width: '100%', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e5ecf8' },
  bottomMenu: { width: '100%', flexDirection: 'row', paddingHorizontal: 8, paddingTop: 6, paddingBottom: 6 },
  bottomItem: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 2 },
  iconSlot: { width: '100%', maxWidth: 54, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  bottomLabel: { fontSize: 11, fontWeight: '600', color: '#64748b', textAlign: 'center' },
  activeItem: { backgroundColor: '#edf3ff' },
  activeText: { color: '#2563eb' },
});
