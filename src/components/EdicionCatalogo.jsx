import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../use-session';
import { listar_catalogo_completo } from '../services/login';

const nombre = { campo: 'nombre', etiqueta: 'Nombre', required: true, maxLength: 100 };
const campos = {
  empleados: [
    nombre,
    { campo: 'apellido', etiqueta: 'Apellido', required: true, maxLength: 100 },
    { campo: 'correo', etiqueta: 'Correo electrónico', inputMode: 'email', maxLength: 150, autoComplete: 'off' },
    { campo: 'rol', etiqueta: 'Rol', opciones: [['empleado', 'Empleado'], ['administrativo', 'Administrativo']], inicial: 'empleado' },
    { campo: 'estado', etiqueta: 'Estado', opciones: [['true', 'Activo'], ['false', 'Inactivo']], inicial: 'true' },
    { campo: 'id_area', etiqueta: 'Área', referencia: 'areas', required: true },
    { campo: 'id_horario', etiqueta: 'Horario', referencia: 'horarios', required: true },
    { campo: 'password', etiqueta: 'Contraseña inicial', type: 'password', required: true,
      minLength: 8, maxLength: 128, autoComplete: 'new-password' },
  ],
  areas: [nombre],
  horarios: [
    nombre,
    { campo: 'hora1_e', etiqueta: 'Primera entrada', required: true, placeholder: '08:00' },
    { campo: 'hora1_s', etiqueta: 'Primera salida', required: true, placeholder: '13:00' },
    { campo: 'hora2_e', etiqueta: 'Segunda entrada (opcional)', placeholder: '14:00' },
    { campo: 'hora2_s', etiqueta: 'Segunda salida (opcional)', placeholder: '17:00' },
  ],
};

async function opciones_catalogo(gestionar_catalogo, catalogo, signal) {
  const registros = await listar_catalogo_completo(gestionar_catalogo, catalogo, signal);
  return registros.map(registro => [String(registro.id), `#${registro.id} · ${registro.nombre}`]);
}

export default function EdicionCatalogo({ modulo, operacion, onCerrar, onGuardado }) {
  const { gestionar_catalogo, empleado } = useSession();
  const { accion, registro } = operacion;
  const catalogo = modulo.catalogo;
  const crear = accion === 'crear';
  const borrar = accion === 'borrar';
  const formulario = campos[catalogo].filter(campo => crear || campo.campo !== 'password');
  const [inicial] = useState(() => Object.fromEntries(formulario.map(({ campo, inicial }) =>
    [campo, String(registro?.[campo] ?? inicial ?? '')])));
  const [valores, set_valores] = useState(inicial);
  const [error, set_error] = useState('');
  const [guardando, set_guardando] = useState(false);
  const [resultado_incierto, set_resultado_incierto] = useState(false);
  const pendiente = useRef(false);
  const necesita_referencias = catalogo === 'empleados' && !borrar;
  const [referencias, set_referencias] = useState(null);
  const [error_referencias, set_error_referencias] = useState('');
  const [intento, set_intento] = useState(0);
  const cuenta_actual = catalogo === 'empleados' && registro?.id === empleado.id;

  useEffect(() => {
    if (!necesita_referencias) return;
    const controller = new AbortController();
    Promise.all([
      opciones_catalogo(gestionar_catalogo, 'areas', controller.signal),
      opciones_catalogo(gestionar_catalogo, 'horarios', controller.signal),
    ]).then(([areas, horarios]) => {
      if (!controller.signal.aborted) set_referencias({ areas, horarios });
    }).catch(fallo => {
      if (!controller.signal.aborted) set_error_referencias(fallo.message);
    });
    return () => controller.abort();
  }, [gestionar_catalogo, intento, necesita_referencias]);

  const referencias_vacias = referencias && (!referencias.areas.length || !referencias.horarios.length);
  const faltan_referencias = necesita_referencias && (!referencias || referencias_vacias);
  const impedir_envio = guardando || faltan_referencias || resultado_incierto;
  const nombre_registro = registro && [registro.nombre, registro.apellido].filter(Boolean).join(' ');

  function cerrar() {
    if (!pendiente.current) onCerrar();
  }

  async function enviar(event) {
    event.preventDefault();
    if (pendiente.current || impedir_envio) return;
    const solicitud = { accion, catalogo, ...(registro ? { id: registro.id } : {}) };
    if (!borrar) {
      const datos = {};
      const cambio_segundo = valores.hora2_e !== inicial.hora2_e || valores.hora2_s !== inicial.hora2_s;
      for (const { campo } of formulario) {
        if (campo === 'password') continue;
        const valor = valores[campo].trim();
        const es_segundo = campo === 'hora2_e' || campo === 'hora2_s';
        if (!crear && valores[campo] === inicial[campo] && !(es_segundo && cambio_segundo)) continue;
        if (campo === 'id_area' || campo === 'id_horario') datos[campo] = Number(valor);
        else if (campo === 'estado') datos[campo] = valor === 'true';
        else datos[campo] = valor || null;
      }
      if (!Object.keys(datos).length) { cerrar(); return; }
      solicitud.datos = datos;
      if (crear && catalogo === 'empleados') solicitud.password = valores.password;
    }
    pendiente.current = true;
    set_guardando(true);
    set_error('');
    try {
      const resultado = await gestionar_catalogo(solicitud);
      onGuardado(accion, resultado);
    } catch (fallo) {
      set_error(fallo.message || 'No se pudo confirmar la operación. Revisa la lista antes de repetirla.');
      if (fallo.resultado_incierto) set_resultado_incierto(true);
    } finally {
      pendiente.current = false;
      set_guardando(false);
    }
  }

  const titulo = `${borrar ? 'Borrar' : crear ? 'Crear' : 'Modificar'} ${modulo.singular}`;
  return <Modal transparent visible animationType="fade" onRequestClose={cerrar}>
    <View style={styles.overlay}>
      <ScrollView style={styles.dialog} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <Text style={styles.eyebrow}>ADMINISTRACIÓN</Text>
          <Text accessibilityRole="header" style={styles.title}>{titulo}</Text>
          {borrar ? <Text style={styles.help}>
            ¿Quieres borrar «{nombre_registro}» (#{registro.id})? Esta acción es permanente.
          </Text> : null}
          {!borrar && catalogo === 'horarios' ? <Text style={styles.help}>
            Usa horas en formato de 24 horas. Para un solo periodo, deja vacías ambas horas del segundo.
          </Text> : null}
          {faltan_referencias ? <Text accessibilityRole={error_referencias ? 'alert' : undefined} style={styles.help}>
            {error_referencias || (referencias_vacias ? 'Primero registra al menos un área y un horario.' : 'Cargando áreas y horarios…')}
          </Text> : null}
          {error_referencias ? <button type="button" style={html.secondary} onClick={() => {
            set_error_referencias('');
            set_intento(actual => actual + 1);
          }}>Reintentar listas</button> : null}
          <form onSubmit={enviar} style={html.form} autoComplete="off">
            {!borrar && <div style={html.grid}>
              {formulario.map(({ campo, etiqueta, opciones, referencia, ...definicion }) => {
                const lista = referencia ? referencias?.[referencia] ?? [] : opciones;
                const bloqueado = guardando || (referencia && !referencias) || (cuenta_actual && ['rol', 'estado'].includes(campo));
                const cambiar = (event) => {
                  const { value } = event.target;
                  set_valores(actual => ({ ...actual, [campo]: value }));
                };
                return <label key={campo} style={html.label}>
                  {etiqueta}
                  {lista ? <select style={html.input} value={valores[campo]} onChange={cambiar}
                    required={definicion.required} disabled={bloqueado}>
                    {referencia && <option value="">Seleccionar</option>}
                    {lista.map(([valor, nombre_opcion]) => <option key={valor} value={valor}>{nombre_opcion}</option>)}
                  </select> : <input {...definicion} style={html.input} value={valores[campo]} onChange={cambiar}
                    disabled={bloqueado} autoFocus={campo === 'nombre'} />}
                </label>;
              })}
            </div>}
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <div style={html.actions}>
              <button type="button" style={html.secondary} disabled={guardando} onClick={cerrar}>Cancelar</button>
              <button type="submit" disabled={impedir_envio}
                style={{ ...html.primary, backgroundColor: borrar ? '#b42333' : '#2563eb',
                  opacity: impedir_envio ? 0.55 : 1 }}>
                {guardando ? 'Procesando…' : borrar ? 'Borrar definitivamente' : 'Guardar'}
              </button>
            </div>
          </form>
        </View>
      </ScrollView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(20,39,69,0.40)', padding: 16, alignItems: 'center', justifyContent: 'center' },
  dialog: { flexGrow: 0, width: '100%', maxWidth: 660, maxHeight: '94%', backgroundColor: '#fff', borderRadius: 22 },
  content: { padding: 24, gap: 12 },
  eyebrow: { color: '#2563eb', fontSize: 10, fontWeight: '700', letterSpacing: 1.3 },
  title: { color: '#142745', fontSize: 24, fontWeight: '800' },
  help: { color: '#51627a', fontSize: 14, lineHeight: 21 },
  error: { borderRadius: 10, padding: 12, backgroundColor: '#fef1f1', color: '#a61b30', fontSize: 13 },
});

const boton = { border: '1px solid transparent', borderRadius: 10, padding: '10px 14px', font: 'inherit', fontWeight: 600, cursor: 'pointer' };
const html = {
  form: { display: 'flex', flexDirection: 'column', gap: 16, marginTop: 4 },
  grid: { display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' },
  label: { display: 'flex', flexDirection: 'column', gap: 6, color: '#33435c', fontSize: 13, fontWeight: 600 },
  input: { boxSizing: 'border-box', width: '100%', minHeight: 42, borderRadius: 10, border: '1px solid #dbe5f5',
    backgroundColor: '#f8faff', color: '#142745', padding: '8px 10px', font: 'inherit', fontWeight: 400 },
  actions: { display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  secondary: { ...boton, backgroundColor: '#edf4ff', color: '#2458c0' },
  primary: { ...boton, color: '#fff' },
};
