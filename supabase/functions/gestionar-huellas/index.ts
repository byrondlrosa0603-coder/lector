import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-session-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const campos_solicitud = 'id,id_empleado,id_dispositivo,estado,fecha_creacion,expira_en,error,operacion';
const campos_orden = `${campos_solicitud},posicion_anterior,hash_anterior`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nonce_wifi = /^[0-9a-f]{32}$/;
const encoder = new TextEncoder();
const motivos_wifi: Record<string, string> = {
  captura_fallida: 'El lector no pudo capturar la huella',
  lector_no_disponible: 'El sensor de huellas no está disponible',
  sin_espacio: 'El sensor no tiene posiciones libres',
  plantilla_no_exportable: 'El lector no pudo exportar la plantilla',
  huella_duplicada: 'El lector ya reconoce esa huella',
  posicion_anterior_no_verificable: 'El lector no pudo verificar la plantilla anterior',
};

function hex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function desde_hex(valor: string) {
  const bytes = new Uint8Array(valor.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(valor.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function clave_gcm(clave: string, direccion: 'orden' | 'resultado') {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(`lector-wifi:v1:${direccion}:${clave}`));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function cifrar_orden(clave: string, orden: object) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, await clave_gcm(clave, 'orden'), encoder.encode(JSON.stringify(orden)),
  );
  return { iv: hex(iv), datos: hex(new Uint8Array(datos)) };
}

async function leer_resultado(clave: string, sobre: unknown) {
  if (!sobre || typeof sobre !== 'object' || !('iv' in sobre) || !('datos' in sobre) ||
      typeof sobre.iv !== 'string' || !/^[0-9a-f]{24}$/.test(sobre.iv) ||
      typeof sobre.datos !== 'string' || sobre.datos.length > 10000 ||
      !/^(?:[0-9a-f]{2}){17,5000}$/.test(sobre.datos)) return null;
  try {
    const datos = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: desde_hex(sobre.iv) }, await clave_gcm(clave, 'resultado'), desde_hex(sobre.datos),
    );
    const resultado = JSON.parse(new TextDecoder().decode(datos));
    return resultado && typeof resultado === 'object' && !Array.isArray(resultado) ? resultado : null;
  } catch {
    return null;
  }
}

function responder(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
const error = (mensaje: string, status: number) => responder({ ok: false, error: mensaje }, status);

function error_rpc_huellas(fallo: { code: string; message: string } | null, mensaje: string) {
  const codigo = fallo ? (/^[A-Z0-9]{5,8}$/.test(fallo.code) ? fallo.code : 'SIN_CODIGO') : 'SIN_DATOS';
  console.error(`[RPC_HUELLAS] ${codigo} - ${mensaje}`);
  if (!fallo) return error(`${mensaje}. Supabase respondió sin datos.`, 500);
  if (fallo.code === 'PT400') return error(fallo.message, 400);
  if (fallo.code === 'PT403') return error(fallo.message, 403);
  if (fallo.code === 'PT404') return error(fallo.message, 404);
  if (fallo.code === 'PT409') return error(fallo.message, 409);
  if (fallo.code === 'PGRST202' || fallo.code === '42883') {
    return error(`Ejecuta registro-huellas.sql en Supabase y recarga el esquema (${fallo.code}).`, 500);
  }
  if (fallo.code === '42501') {
    return error('Faltan permisos de service_role para las funciones o tablas de huellas (42501).', 500);
  }
  if (fallo.code === '42P01' || fallo.code === '42703') {
    return error(`Falta una tabla o columna del esquema de huellas (${fallo.code}).`, 500);
  }
  const detalle = codigo === 'SIN_CODIGO' ? '' : ` (${codigo})`;
  return error(`${mensaje}${detalle}.`, 500);
}

function es_id(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor > 0 && valor <= 2147483647;
}

function estado_vigente<T extends { estado: string; expira_en: string }>(solicitud: T | null) {
  if (solicitud && ['pendiente', 'capturando'].includes(solicitud.estado) &&
      Date.parse(solicitud.expira_en) <= Date.now()) {
    return { ...solicitud, estado: 'vencida' };
  }
  return solicitud;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return error('Método no permitido', 405);
  const token = request.headers.get('x-session-token') ?? '';
  if (!/^[a-f0-9]{64}$/.test(token)) return error('Sesión inválida', 401);

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const claves = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    const clave = claves.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !clave) return error('Configuración incompleta', 500);
    const db = createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });

    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
    const hash = hex(bytes);
    const { data: sesion, error: error_sesion } = await db.from('sesion_empleado')
      .select('id_empleado,fecha_expiracion').eq('token_hash', hash).maybeSingle();
    if (error_sesion) return error('No se pudo validar la sesión', 500);
    if (!sesion || !(Date.parse(sesion.fecha_expiracion) > Date.now())) return error('Sesión inválida o vencida', 401);

    const { data: admin, error: error_admin } = await db.from('empleado')
      .select('rol,estado').eq('id', sesion.id_empleado).maybeSingle();
    if (error_admin) return error('No se pudo validar el empleado', 500);
    if (!admin?.estado) return error('Sesión inválida', 401);
    if (admin.rol !== 'administrativo') return error('Se requiere el rol administrativo', 403);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return error('Se requiere un objeto JSON', 400);
    const solicitudes = () => db.from('solicitud_huella').select(campos_solicitud)
      .eq('id_administrativo', sesion.id_empleado);

    if (body.accion === 'preparar') {
      const [lectores, ultima] = await Promise.all([
        db.from('dispositivo').select('id,nombre,identificador,ubicacion,ultima_conexion')
          .eq('estado', true).not('clave_hash', 'is', null).order('nombre'),
        solicitudes().order('fecha_creacion', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (lectores.error || ultima.error) return error('No se pudo cargar el panel de huellas', 500);
      const huellas = [];
      let despues_de = 0;
      for (;;) {
        const { data, error: fallo } = await db.from('credencial_huella')
          .select('id,id_empleado,id_dispositivo,id_plantilla,fecha_registro,estado')
          .gt('id', despues_de).order('id').limit(500);
        if (fallo || !data) return error('No se pudo consultar la lista de huellas', 500);
        if (!data.length) break;
        huellas.push(...data);
        despues_de = data[data.length - 1].id;
      }
      return responder({ ok: true, lectores: lectores.data, huellas, solicitud: estado_vigente(ultima.data) });
    }

    if (body.accion === 'consultar') {
      if (typeof body.id_solicitud !== 'string' || !uuid.test(body.id_solicitud)) return error('Solicitud inválida', 400);
      const { data, error: error_consulta } = await solicitudes().eq('id', body.id_solicitud).maybeSingle();
      if (error_consulta) return error('No se pudo consultar la solicitud', 500);
      if (!data) return error('Solicitud no encontrada', 404);
      return responder({ ok: true, solicitud: estado_vigente(data) });
    }

    if (['iniciar_wifi', 'continuar_wifi', 'finalizar_wifi'].includes(body.accion)) {
      const iniciar = body.accion === 'iniciar_wifi';
      const finalizar = body.accion === 'finalizar_wifi';
      const operacion = body.operacion ?? 'registrar';
      if (!es_id(body.id_dispositivo) || (iniciar && (!['registrar', 'reemplazar', 'borrar'].includes(operacion) ||
          !(operacion === 'registrar' ? es_id(body.id_empleado) : es_id(body.id_credencial)))) ||
          (!iniciar && (typeof body.id_solicitud !== 'string' || !uuid.test(body.id_solicitud))) ||
          (!finalizar && (typeof body.nonce !== 'string' || !nonce_wifi.test(body.nonce)))) {
        return error('Faltan datos válidos del lector Wi-Fi', 400);
      }

      const { data: lector, error: error_lector } = await db.from('dispositivo')
        .select('id,identificador,clave_hash').eq('id', body.id_dispositivo).eq('estado', true).maybeSingle();
      if (error_lector) return error('No se pudo consultar el lector', 500);
      if (!lector) return error('El lector no está disponible', 404);

      let claves_wifi;
      try {
        claves_wifi = JSON.parse(Deno.env.get('HUELLAS_WIFI_CLAVES') ?? '{}');
      } catch {
        return error('HUELLAS_WIFI_CLAVES debe contener un objeto JSON', 500);
      }
      const clave_wifi = claves_wifi?.[lector.identificador];
      if (typeof clave_wifi !== 'string' || !/^[0-9a-f]{64}$/.test(clave_wifi) ||
          hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(clave_wifi)))) !== lector.clave_hash) {
        return error('Configura la clave original de este lector en HUELLAS_WIFI_CLAVES', 500);
      }

      let captura;
      let propietario = sesion.id_empleado;
      if (iniciar) {
        const destino = { p_id_dispositivo: lector.id, p_id_administrativo: sesion.id_empleado };
        const { data, error: fallo } = operacion === 'registrar'
          ? await db.rpc('iniciar_registro_huella', { ...destino, p_id_empleado: body.id_empleado })
          : await db.rpc('iniciar_cambio_huella', {
            ...destino, p_id_credencial: body.id_credencial, p_operacion: operacion,
          });
        if (fallo || !data) return error_rpc_huellas(fallo, 'No se pudo iniciar el registro');
        captura = data;
      } else {
        const { data, error: fallo } = await db.from('solicitud_huella')
          .select(`${campos_orden},id_administrativo`).eq('id', body.id_solicitud).eq('id_dispositivo', lector.id).maybeSingle();
        if (fallo) return error('No se pudo consultar la solicitud', 500);
        if (!data) return error('Solicitud no encontrada para este lector', 404);
        const { id_administrativo, ...campos } = data;
        captura = campos;
        propietario = id_administrativo;
      }

      // Una orden de cierre destructiva requiere un estado terminal persistido.
      // El UPDATE se serializa con el bloqueo que usa la confirmación en SQL.
      if (['pendiente', 'capturando'].includes(captura.estado) && Date.parse(captura.expira_en) <= Date.now()) {
        const { data, error: fallo } = await db.from('solicitud_huella').update({ estado: 'vencida' })
          .eq('id', captura.id).eq('id_dispositivo', lector.id).in('estado', ['pendiente', 'capturando'])
          .lte('expira_en', new Date().toISOString()).select(campos_orden).maybeSingle();
        if (fallo) return error('No se pudo cerrar la solicitud vencida', 500);
        if (data) captura = data;
        else {
          const vigente = await db.from('solicitud_huella').select(campos_orden)
            .eq('id', captura.id).eq('id_dispositivo', lector.id).maybeSingle();
          if (vigente.error || !vigente.data) return error('Vuelve a consultar la captura', 409);
          captura = vigente.data;
        }
      }
      if (propietario !== sesion.id_empleado &&
          (finalizar || ['pendiente', 'capturando'].includes(captura.estado))) {
        return error('Otro administrativo inició esta captura. Espera a que termine o venza.', 403);
      }

      if (finalizar) {
        const resultado = await leer_resultado(clave_wifi, body.resultado);
        if (!resultado || resultado.id_solicitud !== captura.id || resultado.identificador !== lector.identificador) {
          return error('El resultado no corresponde a la solicitud y al lector', 400);
        }
        const confirmar = resultado.accion === 'confirmar';
        const borrar = resultado.accion === 'borrar';
        const fallo_lector = resultado.accion === 'fallar' &&
          typeof resultado.motivo === 'string' && Object.hasOwn(motivos_wifi, resultado.motivo);
        if (!fallo_lector && !(captura.operacion === 'borrar' ? borrar : confirmar)) {
          return error('Resultado de captura inválido', 400);
        }
        if (confirmar && (!Number.isInteger(resultado.id_plantilla) || resultado.id_plantilla < 1 ||
            resultado.id_plantilla > 65535 || typeof resultado.plantilla_hex !== 'string' ||
            !/^(?:[0-9a-f]{2}){128,2048}$/.test(resultado.plantilla_hex))) {
          return error('La plantilla del lector es inválida', 400);
        }
        const { data, error: fallo } = await db.rpc('operar_lector_huella', {
          p_id_dispositivo: lector.id, p_id_solicitud: captura.id, p_accion: resultado.accion,
          ...(confirmar ? { p_id_plantilla: resultado.id_plantilla, p_plantilla_hex: resultado.plantilla_hex }
            : fallo_lector ? { p_error: motivos_wifi[resultado.motivo] } : {}),
        });
        if (fallo || !data) return error_rpc_huellas(fallo, 'No se pudo guardar el resultado del lector');
        captura = { ...captura, ...data };
      } else if (captura.estado === 'pendiente') {
        const { data, error: fallo } = await db.from('solicitud_huella').update({ estado: 'capturando' })
          .eq('id', captura.id).eq('id_administrativo', sesion.id_empleado)
          .eq('estado', 'pendiente').gt('expira_en', new Date().toISOString()).select(campos_orden).maybeSingle();
        if (fallo) return error('No se pudo preparar la captura', 500);
        if (data) captura = data;
        else {
          const vigente = await db.from('solicitud_huella').select(campos_orden)
            .eq('id', captura.id).eq('id_administrativo', sesion.id_empleado).maybeSingle();
          if (vigente.error || !vigente.data) return error('Vuelve a consultar la captura', 409);
          captura = vigente.data;
        }
      }

      const { hash_anterior, ...publica } = captura;
      const base = { identificador: lector.identificador, id_solicitud: captura.id };
      const cambio = captura.operacion === 'borrar' || captura.operacion === 'reemplazar';
      const anterior = cambio ? { posicion: captura.posicion_anterior, hash: hash_anterior } : null;
      if (anterior && (!Number.isInteger(anterior.posicion) || anterior.posicion < 0 || anterior.posicion > 65535 ||
          typeof anterior.hash !== 'string' || !/^[0-9a-f]{64}$/.test(anterior.hash))) {
        return error('No se pudo verificar la posición de la huella anterior', 500);
      }
      if (captura.estado === 'capturando' && !finalizar) {
        const vigencia_ms = Math.max(0, Math.min(120000, Date.parse(captura.expira_en) - Date.now() - 4000));
        if (vigencia_ms < 1000) return error('La solicitud está por vencer. Espera para iniciar otra.', 409);
        const orden_wifi = await cifrar_orden(clave_wifi, {
          ...base, accion: 'capturar', nonce: body.nonce, vigencia_ms, operacion: captura.operacion, anterior,
        });
        return responder({ ok: true, solicitud: publica, orden_wifi });
      }
      if (!['completada', 'fallida', 'vencida'].includes(captura.estado)) {
        return error('La captura aún está en curso', 409);
      }
      const orden_wifi = await cifrar_orden(clave_wifi, {
        ...base, accion: 'cerrar', confirmada: captura.estado === 'completada',
        ...(captura.estado === 'completada' && anterior ? { retiro: anterior } : {}),
      });
      return responder({ ok: true, solicitud: publica, orden_wifi });
    }

    if (body.accion !== 'iniciar') return error('Acción inválida', 400);
    if (!es_id(body.id_empleado) || !es_id(body.id_dispositivo)) return error('Selecciona un empleado y un lector', 400);
    const { data, error: error_inicio } = await db.rpc('iniciar_registro_huella', {
      p_id_empleado: body.id_empleado,
      p_id_dispositivo: body.id_dispositivo,
      p_id_administrativo: sesion.id_empleado,
    });
    if (error_inicio || !data) return error_rpc_huellas(error_inicio, 'No se pudo iniciar el registro');
    return responder({ ok: true, solicitud: data });
  } catch {
    return error('Error interno del servidor', 500);
  }
});
