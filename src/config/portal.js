// Opciones visuales del alcance documentado; no otorgan permisos de servidor.
const inicio = { ruta: 'inicio', titulo: 'Inicio', simbolo: '⌂' };
const asistencia = { ruta: 'asistencia', titulo: 'Asistencia', simbolo: '▦' };
const solicitudes = { ruta: 'solicitudes', titulo: 'Solicitudes', simbolo: '≡' };

export function opciones_portal(rol) {
  if (rol === 'administrativo') return [
    inicio,
    { ruta: 'editar', titulo: 'Editar', simbolo: '✎' },
    asistencia, solicitudes,
    { ruta: 'servicios', titulo: 'Servicios', simbolo: '◇' },
  ];
  return rol === 'empleado' ? [inicio, asistencia, solicitudes] : [];
}
export const nombre_rol = (rol) => rol === 'administrativo' ? 'Administrativo' : 'Empleado';

export const modulos_edicion = [
  { titulo: 'Empleados', sigla: 'EM', descripcion: 'Datos del personal, rol, estado y asignación de horario y área.' },
  { titulo: 'Horarios', sigla: 'HO', descripcion: 'Turnos y horas de entrada y salida.' },
  { titulo: 'Áreas', sigla: 'ÁR', descripcion: 'Catálogo de áreas del centro de trabajo.' },
];
