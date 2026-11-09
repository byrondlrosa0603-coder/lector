import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { modulos_edicion, nombre_rol } from '../config/portal';
import { useSession } from '../use-session';
import EdicionCatalogo from './EdicionCatalogo';
import PanelHuellas from './PanelHuellas';

const huellas = { catalogo: 'huellas', titulo: 'Huellas', sigla: 'HU', descripcion: 'Registro de huellas para el lector de asistencia.' };

export default function Catalogos() {
  const [catalogo, set_catalogo] = useState(modulos_edicion[0]);
  const web = Platform.OS === 'web';
  const Tarjeta = web ? Pressable : View;
  const modulos = web ? [...modulos_edicion, huellas] : modulos_edicion;

  return <View style={styles.dashboard}>
    <View style={styles.grid}>
      {modulos.map(modulo => {
        const activo = web && modulo === catalogo;
        return <Tarjeta key={modulo.catalogo}
          {...(web && {
            accessibilityRole: 'button',
            accessibilityState: { selected: activo },
            onPress: () => set_catalogo(modulo),
          })}
          style={[styles.card, web && styles.webCard, activo && styles.cardActive]}>
          <View style={styles.badge}><Text style={styles.badgeText}>{modulo.sigla}</Text></View>
          <Text accessibilityRole={web ? undefined : 'header'} style={[styles.cardTitle, activo && styles.cardTitleActive]}>{modulo.titulo}</Text>
          <Text style={styles.cardDescription}>{modulo.descripcion}</Text>
        </Tarjeta>;
      })}
    </View>
    {web && (catalogo === huellas ? <PanelHuellas /> : <ListaCatalogo key={catalogo.catalogo} modulo={catalogo} />)}
  </View>;
}

function ListaCatalogo({ modulo }) {
  const { gestionar_catalogo, empleado } = useSession();
  const [solicitud, set_solicitud] = useState({ despues_de: null });
  const [lista, set_lista] = useState({ registros: [], siguiente_id: null, cargando: true, error: '' });
  const [operacion, set_operacion] = useState(null);
  const [mensaje, set_mensaje] = useState('');
  const { registros, siguiente_id, cargando, error } = lista;

  useEffect(() => {
    const controller = new AbortController();
    const { despues_de } = solicitud;
    const consulta = { accion: 'listar', catalogo: modulo.catalogo, ...(despues_de === null ? {} : { despues_de }) };
    gestionar_catalogo(consulta, controller.signal).then(pagina => {
      if (controller.signal.aborted) return;
      set_lista(actual => {
        const registros = despues_de === null ? pagina.registros : combinar_registros(actual.registros, pagina.registros);
        return { registros, siguiente_id: pagina.siguiente_id, cargando: false, error: '' };
      });
    }).catch(fallo => {
      if (controller.signal.aborted) return;
      set_lista(actual => ({ ...actual, cargando: false, error: fallo.message || 'No se pudo consultar el catálogo.' }));
    });
    return () => controller.abort();
  }, [gestionar_catalogo, modulo.catalogo, solicitud]);

  function cargar(despues_de) {
    set_lista(actual => ({ ...actual, cargando: true, error: '' }));
    set_solicitud({ despues_de });
  }

  function abrir(accion, registro) {
    set_mensaje('');
    set_operacion({ accion, registro });
  }

  function aplicar_cambio(accion, resultado) {
    set_lista(actual => ({
      ...actual,
      registros: accion === 'borrar'
        ? actual.registros.filter(registro => registro.id !== resultado.id)
        : combinar_registros(actual.registros, [resultado.registro]),
    }));
    const id = accion === 'borrar' ? resultado.id : resultado.registro.id;
    const texto = { crear: 'Se creó', actualizar: 'Se actualizó', borrar: 'Se borró' };
    set_mensaje(`${texto[accion]} el registro #${id}.`);
    set_operacion(null);
  }

  return <View style={styles.panel}>
    <View style={styles.panelHeader}>
      <View>
        <Text style={styles.eyebrow}>CATÁLOGO</Text>
        <Text accessibilityRole="header" style={styles.panelTitle}>{modulo.titulo}</Text>
      </View>
      <View style={styles.panelActions}>
        {registros.length > 0 && <Text style={styles.count}>
          {registros.length === 1 ? '1 registro' : `${registros.length} registros`}
        </Text>}
        <Boton etiqueta="Actualizar lista" onPress={() => cargar(null)} disabled={cargando} />
        <Boton etiqueta={`Crear ${modulo.singular}`} onPress={() => abrir('crear')} disabled={cargando || Boolean(error)} primario />
      </View>
    </View>
    {mensaje ? <Text accessibilityLiveRegion="polite" style={styles.feedback}>{mensaje}</Text> : null}
    {registros.map(registro => <FilaCatalogo key={registro.id} catalogo={modulo.catalogo} registro={registro}
      editar={() => abrir('actualizar', registro)} borrar={() => abrir('borrar', registro)}
      bloqueado={cargando || Boolean(error)} cuenta_actual={modulo.catalogo === 'empleados' && registro.id === empleado.id} />)}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {cargando ? <View style={styles.notice} accessibilityLiveRegion="polite">
      <ActivityIndicator size="small" color="#2563eb" />
      <Text style={styles.description}>Cargando {modulo.titulo.toLowerCase()}…</Text>
    </View> : null}
    {!cargando && !error && registros.length === 0 ? <View style={styles.notice}>
      <Text style={styles.description}>Este catálogo todavía está vacío.</Text>
    </View> : null}
    {!cargando && (error || siguiente_id !== null) ? <View style={styles.actions}>
      <Boton etiqueta={error ? 'Reintentar' : 'Cargar más'} onPress={() => cargar(error ? solicitud.despues_de : siguiente_id)} />
    </View> : null}
    {operacion ? <EdicionCatalogo modulo={modulo} operacion={operacion}
      onCerrar={() => set_operacion(null)} onGuardado={aplicar_cambio} /> : null}
  </View>;
}

function combinar_registros(anteriores, nuevos) {
  const por_id = new Map([...anteriores, ...nuevos].map(registro => [registro.id, registro]));
  return [...por_id.values()].sort((a, b) => a.id - b.id);
}

function Boton({ etiqueta, onPress, disabled, primario, peligro, descripcion }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={descripcion || etiqueta}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [
      styles.button, primario && styles.primaryButton, peligro && styles.dangerButton,
      (pressed || disabled) && styles.pressed,
    ]}>
    <Text style={[styles.buttonText, primario && styles.primaryText, peligro && styles.dangerText]}>{etiqueta}</Text>
  </Pressable>;
}

function FilaCatalogo({ catalogo, registro, editar, borrar, bloqueado, cuenta_actual }) {
  const empleado = catalogo === 'empleados';
  const horario = catalogo === 'horarios';
  return <View style={styles.row}>
    <Text style={styles.rowId}>#{registro.id}</Text>
    <View style={styles.rowMain}>
      <Text style={styles.rowTitle}>{registro.nombre}{empleado ? ` ${registro.apellido ?? ''}` : ''}</Text>
      {empleado && <Text style={styles.description}>{registro.correo || 'Sin correo registrado'}</Text>}
    </View>
    {empleado && <View style={styles.rowExtra}>
      <View style={styles.labels}>
        <Text style={styles.role}>{nombre_rol(registro.rol)}</Text>
        <Text style={[styles.status, registro.estado && styles.statusActive]}>{registro.estado ? 'Activo' : 'Inactivo'}</Text>
      </View>
      <Text style={styles.description}>Área #{registro.id_area} · Horario #{registro.id_horario}</Text>
    </View>}
    {horario && <View style={styles.rowExtra}>
      <Text style={styles.description}>Primer periodo · {periodo(registro.hora1_e, registro.hora1_s)}</Text>
      <Text style={styles.description}>{registro.hora2_e || registro.hora2_s
        ? `Segundo periodo · ${periodo(registro.hora2_e, registro.hora2_s)}`
        : 'Sin segundo periodo'}</Text>
    </View>}
    <View style={styles.rowActions}>
      <Boton etiqueta="Modificar" descripcion={`Modificar ${registro.nombre}, registro ${registro.id}`} onPress={editar} disabled={bloqueado} />
      {!cuenta_actual && <Boton etiqueta="Borrar" descripcion={`Borrar ${registro.nombre}, registro ${registro.id}`}
        onPress={borrar} disabled={bloqueado} peligro />}
    </View>
  </View>;
}

function periodo(entrada, salida) {
  const hora = valor => typeof valor === 'string' ? valor.replace(/^(\d{2}:\d{2}):00(?:\.0+)?$/, '$1') : '—';
  return `${hora(entrada)} – ${hora(salida)}`;
}

const styles = StyleSheet.create({
  dashboard: { gap: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  card: { flexGrow: 1, flexShrink: 1, flexBasis: 240, minWidth: 0, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3eafa', borderRadius: 20, padding: 20 },
  webCard: { flexBasis: 160 },
  cardActive: { borderColor: '#7aa5ff', backgroundColor: '#f0f5ff' },
  badge: { alignSelf: 'flex-start', minWidth: 40, padding: 10, borderRadius: 12, backgroundColor: '#edf4ff', alignItems: 'center' },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#2563eb' },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#142745', marginTop: 14 },
  cardTitleActive: { color: '#1d4ed8' },
  cardDescription: { fontSize: 13, lineHeight: 21, color: '#64748b', marginTop: 8 },
  description: { fontSize: 13, lineHeight: 20, color: '#51627a' },
  panel: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3eafa', borderRadius: 20, overflow: 'hidden' },
  panelHeader: { padding: 20, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  panelActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.3, color: '#2563eb', marginBottom: 6 },
  panelTitle: { fontSize: 21, fontWeight: '700', color: '#142745' },
  count: { fontSize: 12, fontWeight: '600', color: '#2458c0', backgroundColor: '#edf4ff', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12, paddingHorizontal: 20, paddingVertical: 15, borderTopWidth: 1, borderTopColor: '#edf1f7' },
  rowId: { minWidth: 40, color: '#2458c0', fontSize: 12, fontWeight: '600', paddingTop: 2 },
  rowMain: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 0, gap: 3 },
  rowTitle: { fontSize: 14, fontWeight: '700', color: '#142745' },
  rowExtra: { minWidth: 0, flexBasis: 240, flexGrow: 1, flexShrink: 1, gap: 4 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  labels: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  role: { color: '#33435c', fontSize: 12, fontWeight: '600' },
  status: { fontSize: 11, fontWeight: '600', color: '#51627a', backgroundColor: '#edf1f7', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 12 },
  statusActive: { color: '#2059c6', backgroundColor: '#eaf1ff' },
  notice: { padding: 20, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: '#edf1f7' },
  error: { marginHorizontal: 20, marginBottom: 8, padding: 14, borderRadius: 12, backgroundColor: '#fef1f1', color: '#a61b30', fontSize: 13, lineHeight: 20 },
  feedback: { marginHorizontal: 20, marginBottom: 12, padding: 12, borderRadius: 10, backgroundColor: '#edf4ff', color: '#2458c0', fontSize: 13 },
  actions: { alignItems: 'flex-start', padding: 20 },
  button: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 15, borderRadius: 10, backgroundColor: '#edf4ff' },
  primaryButton: { backgroundColor: '#2563eb' },
  dangerButton: { backgroundColor: '#fef1f1' },
  buttonText: { color: '#1d4ed8', fontWeight: '600', fontSize: 13 },
  primaryText: { color: '#fff' },
  dangerText: { color: '#a61b30' },
  pressed: { opacity: 0.7 },
});
