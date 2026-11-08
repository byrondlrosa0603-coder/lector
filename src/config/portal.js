// Opciones visuales del alcance documentado; no otorgan permisos de servidor.
const inicio = { ruta: 'inicio', titulo: 'Inicio', simbolo: '⌂' };
const asistencia = { ruta: 'asistencia', titulo: 'Asistencia', simbolo: '▦' };
const solicitudes = { ruta: 'solicitudes', titulo: 'Solicitudes', simbolo: '≡' };

export function opciones_portal(rol) {
  if (rol === 'administrativo') return [
    inicio,
    { ruta: 'empleados', titulo: 'Empleados', simbolo: '♙' },
    asistencia, solicitudes,
    { ruta: 'servicios', titulo: 'Servicios', simbolo: '◇' },
  ];
  return rol === 'empleado' ? [inicio, asistencia, solicitudes] : [];
}
export const nombre_rol = (rol) => rol === 'administrativo' ? 'Administrativo' : 'Empleado';
