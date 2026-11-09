export function direccion_lector(ip) {
  const partes = ip.trim().split('.');
  if (partes.length !== 4 || partes.some(p => !/^(0|[1-9]\d{0,2})$/.test(p) || Number(p) > 255)) {
    throw new Error('Escribe la IP que muestra el ESP32, por ejemplo 192.168.1.25.');
  }
  const [a, b] = partes.map(Number);
  if (a !== 10 && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168)) {
    throw new Error('Usa una dirección IP privada de la misma red Wi-Fi.');
  }
  return `http://${partes.join('.')}`;
}

async function consultar_lector(direccion, ruta, signal, orden) {
  const controller = new AbortController();
  const cancelar = () => controller.abort();
  if (signal.aborted) cancelar();
  else signal.addEventListener('abort', cancelar, { once: true });
  const timer = setTimeout(cancelar, 9000);
  try {
    const respuesta = await fetch(direccion + ruta, {
      targetAddressSpace: 'local',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      ...(orden ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orden) } : {}),
    });
    const datos = await respuesta.json().catch(() => null);
    if (!respuesta.ok || !datos) throw new Error(datos?.error || 'El ESP32 respondió con un formato inesperado.');
    return datos;
  } catch (error) {
    if (signal.aborted) throw error;
    if (controller.signal.aborted || error instanceof TypeError) {
      throw new Error('No se pudo contactar al ESP32. Revisa la IP, la red Wi-Fi y el permiso de red local del navegador.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancelar);
  }
}

export async function estado_lector(direccion, signal) {
  const estado = await consultar_lector(direccion, '/estado', signal);
  if (typeof estado.identificador !== 'string' || !/^[0-9a-f]{32}$/.test(estado.nonce) ||
      (estado.id_solicitud !== null && typeof estado.id_solicitud !== 'string')) {
    throw new Error('La dirección no respondió como lector de huellas. Revisa el firmware del ESP32.');
  }
  return estado;
}

export async function enviar_orden_lector(direccion, orden, signal, plazo, informar_paso) {
  if (!orden?.iv || !orden?.datos) throw new Error('Supabase no devolvió una orden válida para el lector.');
  while (!signal.aborted && Date.now() < plazo) {
    const respuesta = await consultar_lector(direccion, '/orden', signal, orden);
    if (respuesta.estado === 'resultado' && respuesta.resultado?.iv && respuesta.resultado?.datos) return respuesta.resultado;
    if (respuesta.estado === 'cerrada') return null;
    if (!['capturando', 'cerrando'].includes(respuesta.estado)) throw new Error('Estado desconocido del ESP32.');
    if (respuesta.estado === 'capturando') informar_paso?.(respuesta.paso);
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  throw new Error('Terminó el tiempo de espera. Conecta el lector y sincroniza la solicitud.');
}
