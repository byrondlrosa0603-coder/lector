import { createClient } from 'npm:@supabase/supabase-js@2';
import { timingSafeEqual } from 'jsr:@std/crypto/timing-safe-equal';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-device-id, x-device-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const motivos: Record<string, string> = {
  captura_fallida: 'El lector no pudo capturar la huella',
  lector_no_disponible: 'El sensor de huellas no está disponible',
  sin_espacio: 'El sensor no tiene posiciones libres',
  plantilla_no_exportable: 'El lector no pudo exportar la plantilla',
  huella_duplicada: 'El lector ya reconoce esa huella',
};

function responder(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
const error = (mensaje: string, status: number) => responder({ ok: false, error: mensaje }, status);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return error('Método no permitido', 405);
  const identificador = request.headers.get('x-device-id') ?? '';
  const clave_lector = request.headers.get('x-device-key') ?? '';
  if (!identificador || identificador.length > 100 || !/^[a-f0-9]{64}$/.test(clave_lector)) {
    return error('Credenciales de lector inválidas', 401);
  }

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const claves = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    const clave = claves.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !clave) return error('Configuración incompleta', 500);
    const db = createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: lector, error: error_lector } = await db.from('dispositivo')
      .select('id,clave_hash,estado').eq('identificador', identificador).maybeSingle();
    if (error_lector) return error('No se pudo validar el lector', 500);
    if (!lector?.estado || !/^[a-f0-9]{64}$/.test(lector.clave_hash ?? '')) {
      return error('Credenciales de lector inválidas', 401);
    }
    const encoder = new TextEncoder();
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(clave_lector)));
    const hash = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    if (!timingSafeEqual(encoder.encode(hash), encoder.encode(lector.clave_hash))) {
      return error('Credenciales de lector inválidas', 401);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return error('Se requiere un objeto JSON', 400);
    if (!['tomar', 'confirmar', 'fallar'].includes(body.accion)) return error('Acción inválida', 400);
    const params = { p_id_dispositivo: lector.id, p_accion: body.accion };
    if (body.accion !== 'tomar' && (typeof body.id_solicitud !== 'string' || !uuid.test(body.id_solicitud))) {
      return error('Solicitud inválida', 400);
    }

    let resultado;
    if (body.accion === 'confirmar') {
      if (!Number.isInteger(body.id_plantilla) || body.id_plantilla < 0 || body.id_plantilla > 65535 ||
          typeof body.plantilla_hex !== 'string' || !/^(?:[a-f0-9]{2}){128,2048}$/.test(body.plantilla_hex)) {
        return error('Posición o plantilla inválida', 400);
      }
      resultado = await db.rpc('operar_lector_huella', {
        ...params, p_id_solicitud: body.id_solicitud,
        p_id_plantilla: body.id_plantilla, p_plantilla_hex: body.plantilla_hex,
      });
    } else if (body.accion === 'fallar') {
      if (typeof body.motivo !== 'string' || !Object.hasOwn(motivos, body.motivo)) return error('Motivo inválido', 400);
      resultado = await db.rpc('operar_lector_huella', {
        ...params, p_id_solicitud: body.id_solicitud, p_error: motivos[body.motivo],
      });
    } else {
      resultado = await db.rpc('operar_lector_huella', params);
    }

    const status_por_codigo: Record<string, number> = { PT400: 400, PT403: 403, PT404: 404, PT409: 409 };
    const fallo = resultado.error;
    if (fallo?.code === 'PGRST202') return error('Ejecuta registro-huellas.sql en Supabase', 500);
    if (fallo && Object.hasOwn(status_por_codigo, fallo.code)) return error(fallo.message, status_por_codigo[fallo.code]);
    if (fallo) return error('No se pudo procesar la solicitud del lector', 500);
    return responder({ ok: true, solicitud: resultado.data });
  } catch {
    return error('Error interno del servidor', 500);
  }
});
