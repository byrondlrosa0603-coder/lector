import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-session-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Valor = string | number | boolean | null;
type Validador = (valor: unknown) => Valor | undefined;

function es_objeto(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function es_id(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor > 0 && valor <= 2147483647;
}

function texto(valor: unknown, maximo: number) {
  if (typeof valor !== 'string') return undefined;
  const limpio = valor.trim();
  if (limpio && [...limpio].length <= maximo && !limpio.includes('\0')) return limpio;
}

function hora(valor: unknown) {
  if (typeof valor !== 'string') return undefined;
  const limpia = valor.trim();
  if (/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(limpia) ||
      /^24:00(?::00(?:\.0{1,6})?)?$/.test(limpia)) return limpia;
}

const nombre: Validador = (valor) => texto(valor, 100);
const id: Validador = (valor) => es_id(valor) ? valor : undefined;
const hora_opcional: Validador = (valor) => valor === null ? null : hora(valor);

const catalogos = {
  empleados: {
    tabla: 'empleado',
    campos: 'id,nombre,apellido,correo,rol,estado,id_horario,id_area',
    requeridos: ['nombre', 'apellido', 'id_area', 'id_horario'],
    editar: {
      nombre,
      apellido: nombre,
      correo: (valor) => {
        if (valor === null) return null;
        const correo = texto(valor, 150)?.toLowerCase();
        if (correo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return correo;
      },
      rol: (valor) => valor === 'empleado' || valor === 'administrativo' ? valor : undefined,
      estado: (valor) => typeof valor === 'boolean' ? valor : undefined,
      id_horario: id,
      id_area: id,
    },
  },
  areas: {
    tabla: 'areas',
    campos: 'id,nombre',
    requeridos: ['nombre'],
    editar: { nombre },
  },
  horarios: {
    tabla: 'horario',
    campos: 'id,nombre,hora1_e,hora1_s,hora2_e,hora2_s',
    requeridos: ['nombre', 'hora1_e', 'hora1_s'],
    editar: { nombre, hora1_e: hora, hora1_s: hora, hora2_e: hora_opcional, hora2_s: hora_opcional },
  },
} as const satisfies Record<string, {
  tabla: string;
  campos: string;
  requeridos: readonly string[];
  editar: Record<string, Validador>;
}>;

function responder(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function error(mensaje: string, status: number) {
  return responder({ ok: false, error: mensaje }, status);
}

// La sesión usa el mismo formato y hash que login-empleado y sesion-empleado.
async function hash_token(token: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Compatible con el formato de contraseña que valida login-empleado.
async function hash_password(password: string) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: 600_000 }, clave, 256,
  );
  const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  return `pbkdf2$600000$${base64(sal)}$${base64(new Uint8Array(bits))}`;
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

    const { data: sesion, error: error_sesion } = await db.from('sesion_empleado')
      .select('id_empleado,fecha_expiracion').eq('token_hash', await hash_token(token)).maybeSingle();
    if (error_sesion) return error('No se pudo validar la sesión', 500);
    if (!sesion || !(Date.parse(sesion.fecha_expiracion) > Date.now())) return error('Sesión inválida o vencida', 401);

    const { data: empleado, error: error_empleado } = await db.from('empleado')
      .select('rol,estado').eq('id', sesion.id_empleado).maybeSingle();
    if (error_empleado) return error('No se pudo validar el empleado', 500);
    if (!empleado?.estado) return error('Sesión inválida', 401);
    if (empleado.rol !== 'administrativo') return error('Se requiere el rol administrativo', 403);

    const body: unknown = await request.json().catch(() => null);
    if (!es_objeto(body)) return error('Se requiere un objeto JSON', 400);
    const { accion, catalogo } = body;
    if (catalogo !== 'empleados' && catalogo !== 'areas' && catalogo !== 'horarios') {
      return error('Catálogo inválido', 400);
    }
    const { tabla, campos, editar, requeridos } = catalogos[catalogo];

    if (accion === 'listar') {
      const { despues_de } = body;
      const por_pagina = 100;
      let consulta = db.from(tabla).select(campos).order('id').limit(por_pagina + 1);
      if (despues_de !== undefined) {
        if (!es_id(despues_de)) return error('Cursor inválido', 400);
        consulta = consulta.gt('id', despues_de);
      }
      const { data, error: error_lista } = await consulta;
      if (error_lista) return error('No se pudo consultar el catálogo', 500);
      const registros = data.slice(0, por_pagina);
      const siguiente_id = data.length > por_pagina ? registros[por_pagina - 1].id : null;
      return responder({ ok: true, registros, siguiente_id });
    }

    const id_registro = body.id;
    const es_cuenta_actual = catalogo === 'empleados' && id_registro === sesion.id_empleado;
    if (accion === 'borrar') {
      if (!es_id(id_registro)) return error('ID inválido', 400);
      if (es_cuenta_actual) return error('No puedes borrar la cuenta con la que iniciaste sesión', 409);
      const { error: error_borrar } = await db.from(tabla).delete().eq('id', id_registro);
      if (error_borrar?.code === '23503') {
        return error(catalogo === 'empleados'
          ? 'El empleado tiene registros vinculados. Puedes desactivarlo desde Editar.'
          : 'Hay empleados asignados a este registro. Reasígnalos antes de borrarlo.', 409);
      }
      if (error_borrar?.code === '42501') return error('Falta el permiso DELETE para service_role en Supabase', 500);
      if (error_borrar) return error('No se pudo borrar el registro', 500);
      return responder({ ok: true, id: id_registro });
    }

    if (accion !== 'actualizar' && accion !== 'crear') return error('Acción inválida', 400);
    if (accion === 'actualizar' && !es_id(id_registro)) return error('ID inválido', 400);
    if (!es_objeto(body.datos) || Object.keys(body.datos).length === 0) {
      return error('Indica al menos un campo en datos', 400);
    }
    const cambios: Record<string, Valor> = {};
    const validadores: Record<string, Validador> = editar;
    for (const [campo, valor] of Object.entries(body.datos)) {
      if (!Object.hasOwn(validadores, campo)) return error(`Campo no editable: ${campo}`, 400);
      const validado = validadores[campo](valor);
      if (validado === undefined) return error(`Valor inválido para ${campo}`, 400);
      cambios[campo] = validado;
    }

    if (catalogo === 'horarios' && (Object.hasOwn(cambios, 'hora2_e') || Object.hasOwn(cambios, 'hora2_s'))) {
      if (!Object.hasOwn(cambios, 'hora2_e') || !Object.hasOwn(cambios, 'hora2_s') ||
          (cambios.hora2_e === null) !== (cambios.hora2_s === null)) {
        return error('Envía ambas horas del segundo turno o ambas en null', 400);
      }
    }

    if (accion === 'crear') {
      const faltante = requeridos.find(campo => !Object.hasOwn(cambios, campo));
      if (faltante) return error(`El campo ${faltante} es obligatorio`, 400);
      if (catalogo === 'empleados') {
        const password = body.password;
        if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
          return error('La contraseña inicial debe tener entre 8 y 128 caracteres', 400);
        }
        cambios.contrasena_hash = await hash_password(password);
      }
    } else if (es_cuenta_actual && (cambios.estado === false || cambios.rol === 'empleado')) {
      return error('No puedes desactivar ni quitar el rol administrativo a tu propia cuenta', 409);
    }

    const consulta = accion === 'crear' ? db.from(tabla).insert(cambios) : db.from(tabla).update(cambios).eq('id', id_registro);
    const { data, error: error_guardar } = await consulta.select(campos).maybeSingle();
    if (error_guardar?.code === '23505') {
      return error(catalogo === 'empleados' ? 'Ese correo ya está registrado'
        : catalogo === 'areas' ? 'Ese nombre de área ya está registrado' : 'Ya existe un registro con esos datos', 409);
    }
    if (error_guardar?.code === '23503') return error('El área o el horario indicado no existe', 409);
    if (error_guardar?.code === '42501') {
      return error(`Falta el permiso ${accion === 'crear' ? 'INSERT' : 'UPDATE'} para service_role en Supabase`, 500);
    }
    if (error_guardar) return error('No se pudo guardar el registro', 500);
    if (!data) return error('Registro no encontrado', 404);
    return responder({ ok: true, registro: data }, accion === 'crear' ? 201 : 200);
  } catch {
    return error('Error interno del servidor', 500);
  }
});
