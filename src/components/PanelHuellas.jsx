import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { listar_catalogo_completo } from '../services/login';
import { direccion_lector, enviar_orden_lector, estado_lector } from '../services/lector-wifi';
import { useSession } from '../use-session';

const estados = {
  pendiente: ['Solicitud pendiente', 'Conecta el lector para continuar.'],
  capturando: ['Captura en curso', 'Coloca el dedo, retíralo y vuelve a colocarlo en el AS608 cuando lo indique el lector.'],
  completada: ['Huella registrada', 'Supabase confirmó el registro.'],
  fallida: ['La captura falló', 'Puedes volver a intentarlo.'],
  vencida: ['Solicitud vencida', 'Puedes crear una nueva solicitud.'],
};
const pasos = {
  preparando: 'Preparando el AS608…',
  primer_dedo: 'Coloca el dedo en el AS608.',
  retirar: 'Retira el dedo del sensor.',
  segundo_dedo: 'Coloca otra vez el mismo dedo.',
  procesando: 'Guardando la plantilla…',
};
const fecha_huella = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });

function nombre_empleado(empleados, id) {
  const empleado = empleados.find(item => item.id === id);
  return empleado ? [empleado.nombre, empleado.apellido].filter(Boolean).join(' ') : `Empleado #${id}`;
}

export default function PanelHuellas() {
  const { gestionar_catalogo, gestionar_huellas } = useSession();
  const [datos, set_datos] = useState(null);
  const [seleccion, set_seleccion] = useState('');
  const [cambio, set_cambio] = useState(null);
  const [ip, set_ip] = useState('');
  const [lector, set_lector] = useState(null);
  const [solicitud, set_solicitud] = useState(null);
  const [paso, set_paso] = useState(null);
  const [cargando, set_cargando] = useState(true);
  const [operacion, set_operacion] = useState('');
  const [intento, set_intento] = useState(0);
  const [error, set_error] = useState('');
  const pendiente = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      listar_catalogo_completo(gestionar_catalogo, 'empleados', controller.signal),
      gestionar_huellas({ accion: 'preparar' }, controller.signal),
    ]).then(([empleados, panel]) => {
      if (controller.signal.aborted) return;
      set_datos({ empleados, lectores: panel.lectores, huellas: panel.huellas });
      set_solicitud(panel.solicitud);
    }).catch(fallo => {
      if (!controller.signal.aborted) set_error(fallo.message);
    }).finally(() => {
      if (!controller.signal.aborted) set_cargando(false);
    });
    return () => controller.abort();
  }, [gestionar_catalogo, gestionar_huellas, intento]);

  useEffect(() => () => pendiente.current?.abort(), []);

  async function ejecutar(accion, trabajo) {
    if (pendiente.current) return;
    const controller = new AbortController();
    pendiente.current = controller;
    set_operacion(accion);
    set_error('');
    try {
      await trabajo(controller.signal);
    } catch (fallo) {
      if (!controller.signal.aborted) set_error(fallo.message);
    } finally {
      pendiente.current = null;
      if (!controller.signal.aborted) set_operacion('');
    }
  }

  function conectar() {
    ejecutar('conectando', async signal => {
      set_lector(null);
      const direccion = direccion_lector(ip);
      const estado = await estado_lector(direccion, signal);
      const registrado = datos.lectores.find(item => item.identificador === estado.identificador);
      if (!registrado) throw new Error('Este ESP32 no corresponde a un lector activo registrado en Supabase.');
      set_lector({ ...registrado, direccion, pendiente: estado.id_solicitud,
        gestiona_credenciales: estado.gestiona_credenciales === true });
    });
  }

  const abierta = solicitud && ['pendiente', 'capturando'].includes(solicitud.estado);
  const por_sincronizar = lector?.pendiente || (abierta && solicitud.id_dispositivo === lector?.id ? solicitud.id : null);
  const registrados = new Set(datos?.huellas.map(huella => huella.id_empleado));
  const elegibles = datos?.empleados.filter(empleado => empleado.estado === true && !registrados.has(empleado.id)) ?? [];
  const elegido = elegibles.some(empleado => String(empleado.id) === seleccion);
  const lector_correcto = cambio && lector?.id === cambio.huella.id_dispositivo && lector.gestiona_credenciales;
  const borrando = cambio?.operacion === 'borrar';

  function recargar() {
    set_error('');
    set_cargando(true);
    set_intento(actual => actual + 1);
  }

  function registrar(event) {
    event.preventDefault();
    if (!lector || (!por_sincronizar && !(cambio ? lector_correcto : elegido))) return;
    ejecutar('capturando', async signal => {
      set_paso(null);
      const estado = await estado_lector(lector.direccion, signal);
      if (estado.identificador !== lector.identificador) throw new Error('La IP corresponde a otro lector. Conéctalo de nuevo.');
      const id_solicitud = estado.id_solicitud || por_sincronizar;
      if (!id_solicitud && cambio && !estado.gestiona_credenciales) {
        throw new Error('Carga el sketch actualizado en el ESP32 para modificar o borrar huellas.');
      }
      let respuesta = await gestionar_huellas({
        accion: id_solicitud ? 'continuar_wifi' : 'iniciar_wifi',
        id_dispositivo: lector.id, nonce: estado.nonce,
        ...(id_solicitud ? { id_solicitud } : cambio
          ? { operacion: cambio.operacion, id_credencial: cambio.huella.id }
          : { id_empleado: Number(seleccion) }),
      }, signal);
      set_solicitud(respuesta.solicitud);
      set_lector({ ...lector, pendiente: respuesta.solicitud.id });
      if (['reemplazar', 'borrar'].includes(respuesta.solicitud.operacion) && !estado.gestiona_credenciales) {
        throw new Error('Carga el sketch actualizado en el ESP32 para sincronizar este cambio.');
      }

      if (respuesta.solicitud.estado === 'capturando') {
        const resultado = await enviar_orden_lector(
          lector.direccion, respuesta.orden_wifi, signal, Date.parse(respuesta.solicitud.expira_en) + 8000, set_paso,
        );
        if (!resultado) throw new Error('El lector cerró la captura. Sincroniza para consultar su estado.');
        respuesta = await gestionar_huellas({
          accion: 'finalizar_wifi', id_dispositivo: lector.id, id_solicitud: respuesta.solicitud.id, resultado,
        }, signal);
        set_solicitud(respuesta.solicitud);
      }
      const cierre = await enviar_orden_lector(lector.direccion, respuesta.orden_wifi, signal, Date.now() + 15000);
      if (cierre) throw new Error('El lector aún tiene un resultado pendiente. Sincroniza la captura.');
      set_lector({ ...lector, pendiente: null });
      set_cambio(null);
      set_seleccion('');
      recargar();
    });
  }

  const ocupado = cargando || Boolean(operacion);
  const puede_capturar = !ocupado && lector && Boolean(por_sincronizar || (cambio ? lector_correcto : elegido));
  let [titulo_estado, descripcion_estado] = solicitud ? estados[solicitud.estado] : [];
  if (solicitud?.estado === 'completada') {
    if (lector?.pendiente === solicitud.id) {
      titulo_estado = 'Sincronizando el lector';
      descripcion_estado = 'Supabase confirmó el cambio. Sincroniza el lector si se interrumpe la conexión.';
    } else if (solicitud.operacion !== 'registrar' && lector?.id !== solicitud.id_dispositivo) {
      titulo_estado = 'Cambio guardado en Supabase';
      descripcion_estado = 'Conecta el lector de esta huella para comprobar si queda una sincronización pendiente.';
    } else if (solicitud.operacion === 'borrar') titulo_estado = 'Huella borrada';
    else if (solicitud.operacion === 'reemplazar') titulo_estado = 'Huella reemplazada';
  } else if (solicitud?.operacion === 'borrar' && solicitud.estado === 'capturando') {
    titulo_estado = 'Borrado en curso';
    descripcion_estado = 'El lector está verificando la posición de la huella.';
  }
  return <View style={styles.panel}>
    <Text style={styles.eyebrow}>ASISTENCIA</Text>
    <Text accessibilityRole="header" style={styles.titulo}>Huellas registradas</Text>
    <Text style={styles.descripcion}>Conecta el ESP32 a la misma red Wi-Fi que esta computadora.</Text>
    {cargando ? <View style={styles.cargando} accessibilityLiveRegion="polite">
      <ActivityIndicator size="small" color="#2563eb" />
      <Text style={styles.descripcion}>Cargando empleados y lectores…</Text>
    </View> : null}
    {datos && <>
      <View style={styles.lista}>
        {datos.huellas.length ? datos.huellas.map(huella => {
          const dispositivo = datos.lectores.find(item => item.id === huella.id_dispositivo);
          const vinculada = huella.id_dispositivo != null && Number.isInteger(huella.id_plantilla);
          const fecha = Date.parse(huella.fecha_registro);
          const seleccionada = cambio?.huella.id === huella.id;
          return <View key={huella.id} style={[styles.fila, seleccionada && styles.filaSeleccionada]}>
            <View style={styles.datosFila}>
              <Text style={styles.estadoTitulo}>{nombre_empleado(datos.empleados, huella.id_empleado)}</Text>
              <Text style={styles.detalle}>
                {vinculada ? `${dispositivo?.nombre ?? `Lector #${huella.id_dispositivo}`} · Posición ${huella.id_plantilla}`
                  : 'Sin posición de lector vinculada'}
                {Number.isFinite(fecha) ? ` · ${fecha_huella.format(fecha)}` : ''}
                {huella.estado === false ? ' · Inactiva' : ''}
              </Text>
            </View>
            <div style={html.acciones}>
              <button type="button" disabled={ocupado || Boolean(por_sincronizar) || !vinculada} style={html.secundario}
                onClick={() => { set_error(''); set_cambio({ operacion: 'reemplazar', huella }); }}>Modificar</button>
              <button type="button" disabled={ocupado || Boolean(por_sincronizar) || !vinculada} style={html.peligro}
                onClick={() => { set_error(''); set_cambio({ operacion: 'borrar', huella }); }}>Borrar</button>
            </div>
          </View>;
        }) : <Text style={styles.detalle}>Todavía no hay huellas registradas.</Text>}
      </View>
      <div style={html.acciones}>
        <label style={html.etiqueta}>
          IP del lector
          <input value={ip} disabled={ocupado} placeholder="192.168.1.25" inputMode="decimal" style={html.selector}
            onChange={event => { set_ip(event.target.value); set_lector(null); }} />
        </label>
        <button type="button" disabled={ocupado || !ip.trim()} style={html.secundario} onClick={conectar}>
          {operacion === 'conectando' ? 'Conectando…' : 'Conectar lector'}
        </button>
      </div>
      {lector ? <Text style={styles.detalle}>Conectado a {lector.nombre} · {lector.identificador}</Text> : null}
      {cambio && !por_sincronizar ? <View style={styles.estado}>
        <Text style={styles.estadoTitulo}>{borrando ? 'Borrar' : 'Reemplazar'} huella de {nombre_empleado(datos.empleados, cambio.huella.id_empleado)}</Text>
        <Text style={styles.descripcion}>{borrando ? 'Confirma el borrado de la plantilla en Supabase y en el lector.'
          : 'El lector pedirá dos capturas para reemplazar la huella anterior.'}</Text>
        {!lector_correcto ? <Text style={styles.detalle}>
          {lector?.id === cambio.huella.id_dispositivo ? 'Carga el sketch actualizado para gestionar las huellas.'
            : `Conecta el lector ${datos.lectores.find(item => item.id === cambio.huella.id_dispositivo)?.nombre ?? `#${cambio.huella.id_dispositivo}`}.`}
        </Text> : null}
      </View> : null}
      <form onSubmit={registrar} style={html.acciones}>
        {!por_sincronizar && !cambio && <label style={html.etiqueta}>
          Empleado
          <select value={seleccion} disabled={ocupado || !lector} required style={html.selector}
            onChange={event => set_seleccion(event.target.value)}>
            <option value="">Selecciona a un empleado</option>
            {elegibles.map(empleado => <option key={empleado.id} value={empleado.id}>
              #{empleado.id} · {[empleado.nombre, empleado.apellido].filter(Boolean).join(' ')}
            </option>)}
          </select>
        </label>}
        {cambio && !por_sincronizar && <button type="button" style={html.secundario} disabled={ocupado}
          onClick={() => { set_cambio(null); set_error(''); }}>Cancelar</button>}
        <button type="submit" disabled={!puede_capturar} style={{ ...(borrando && !por_sincronizar ? html.confirmarBorrado : html.primario),
          opacity: puede_capturar ? 1 : 0.55 }}>
          {operacion === 'capturando' ? 'Procesando…' : por_sincronizar ? 'Sincronizar captura'
            : borrando ? 'Confirmar borrado' : cambio ? 'Reemplazar huella' : 'Solicitar captura'}
        </button>
      </form>
      {!datos.lectores.length ? <Text style={styles.descripcion}>Da de alta un lector activo en Supabase.</Text> : null}
      {!elegibles.length && !cambio && !por_sincronizar
        ? <Text style={styles.descripcion}>No hay empleados activos pendientes de registrar.</Text> : null}
    </>}
    {error ? <View style={styles.error}>
      <Text accessibilityRole="alert" style={styles.errorTexto}>{error}</Text>
      <button type="button" disabled={ocupado} style={html.secundario} onClick={recargar}>Actualizar lista</button>
    </View> : null}
    {solicitud ? <View accessibilityLiveRegion="polite" style={styles.estado}>
      <Text style={styles.estadoTitulo}>{titulo_estado}</Text>
      <Text style={styles.descripcion}>{solicitud.error ||
        (solicitud.operacion !== 'borrar' && solicitud.estado === 'capturando' && operacion === 'capturando' && Object.hasOwn(pasos, paso)
          ? pasos[paso] : descripcion_estado)}</Text>
      <Text style={styles.detalle}>Empleado #{solicitud.id_empleado} · Lector #{solicitud.id_dispositivo}</Text>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { padding: 24, gap: 12, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#e3eafa' },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.3, color: '#2563eb' },
  titulo: { fontSize: 23, fontWeight: '800', color: '#142745' },
  descripcion: { fontSize: 13, lineHeight: 21, color: '#51627a' },
  cargando: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 6 },
  estado: { padding: 16, borderRadius: 12, backgroundColor: '#edf4ff', gap: 5 },
  estadoTitulo: { fontSize: 16, color: '#1d4ed8', fontWeight: '700' },
  detalle: { color: '#51627a', fontSize: 12, lineHeight: 18 },
  lista: { borderWidth: 1, borderColor: '#e3eafa', borderRadius: 12, padding: 10, gap: 8 },
  fila: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
    gap: 8, padding: 10, borderRadius: 8, backgroundColor: '#f7faff' },
  filaSeleccionada: { backgroundColor: '#eaf2ff' },
  datosFila: { gap: 4, flex: 1, minWidth: 180 },
  error: { padding: 12, borderRadius: 10, backgroundColor: '#fef1f1', gap: 8, alignItems: 'flex-start' },
  errorTexto: { fontSize: 13, lineHeight: 20, color: '#a61b30' },
});

const boton = { border: 0, borderRadius: 10, minHeight: 42, padding: '10px 14px', font: 'inherit', fontWeight: 600, cursor: 'pointer' };
const html = {
  etiqueta: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: '1 1 230px', color: '#33435c', fontSize: 13, fontWeight: 600 },
  selector: { minWidth: 0, minHeight: 42, borderRadius: 10, border: '1px solid #dbe5f5',
    backgroundColor: '#f8faff', color: '#142745', padding: '8px 10px', font: 'inherit', fontWeight: 400 },
  acciones: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10 },
  primario: { ...boton, color: '#fff', backgroundColor: '#2563eb' },
  secundario: { ...boton, color: '#2458c0', backgroundColor: '#edf4ff' },
  peligro: { ...boton, color: '#a61b30', backgroundColor: '#fef1f1' },
  confirmarBorrado: { ...boton, color: '#fff', backgroundColor: '#a61b30' },
};
