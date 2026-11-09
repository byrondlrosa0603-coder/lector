-- Ejecutar después de preparar dispositivo, solicitud_huella y credencial_huella.
BEGIN;

ALTER TABLE public.solicitud_huella
  ADD COLUMN IF NOT EXISTS operacion text NOT NULL DEFAULT 'registrar'
    CHECK (operacion IN ('registrar', 'reemplazar', 'borrar')),
  ADD COLUMN IF NOT EXISTS id_credencial_anterior integer,
  ADD COLUMN IF NOT EXISTS posicion_anterior integer,
  ADD COLUMN IF NOT EXISTS hash_anterior text;

CREATE OR REPLACE FUNCTION public.iniciar_registro_huella(
  p_id_empleado integer, p_id_dispositivo integer, p_id_administrativo integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  solicitud public.solicitud_huella%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.dispositivo
  WHERE id = p_id_dispositivo AND estado IS TRUE AND clave_hash IS NOT NULL
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE SQLSTATE 'PT404' USING MESSAGE = 'El lector no está disponible';
  END IF;

  PERFORM 1 FROM public.empleado WHERE id = p_id_empleado AND estado IS TRUE FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE SQLSTATE 'PT404' USING MESSAGE = 'El empleado no está activo';
  END IF;

  IF EXISTS (SELECT 1 FROM public.credencial_huella WHERE id_empleado = p_id_empleado) THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'El empleado ya tiene una huella registrada';
  END IF;

  UPDATE public.solicitud_huella SET estado = 'vencida'
  WHERE (id_empleado = p_id_empleado OR id_dispositivo = p_id_dispositivo)
    AND estado IN ('pendiente', 'capturando') AND expira_en <= clock_timestamp();

  SELECT * INTO solicitud FROM public.solicitud_huella
  WHERE id_empleado = p_id_empleado AND id_dispositivo = p_id_dispositivo
    AND id_administrativo = p_id_administrativo AND operacion = 'registrar'
    AND estado IN ('pendiente', 'capturando');
  IF FOUND THEN
    RETURN to_jsonb(solicitud) - 'id_administrativo';
  END IF;

  INSERT INTO public.solicitud_huella (id_empleado, id_dispositivo, id_administrativo, expira_en)
  VALUES (p_id_empleado, p_id_dispositivo, p_id_administrativo, clock_timestamp() + interval '2 minutes')
  ON CONFLICT DO NOTHING RETURNING * INTO solicitud;
  IF NOT FOUND THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'El lector o el empleado ya tiene una captura en curso';
  END IF;
  RETURN to_jsonb(solicitud) - 'id_administrativo';
END;
$$;

CREATE OR REPLACE FUNCTION public.iniciar_cambio_huella(
  p_id_credencial integer, p_id_dispositivo integer, p_id_administrativo integer, p_operacion text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  anterior public.credencial_huella%ROWTYPE;
  solicitud public.solicitud_huella%ROWTYPE;
BEGIN
  IF p_operacion IS NULL OR p_operacion NOT IN ('reemplazar', 'borrar') THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Operación de huella inválida';
  END IF;

  PERFORM 1 FROM public.dispositivo
  WHERE id = p_id_dispositivo AND estado IS TRUE AND clave_hash IS NOT NULL
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE SQLSTATE 'PT404' USING MESSAGE = 'El lector no está disponible';
  END IF;

  SELECT * INTO anterior FROM public.credencial_huella
  WHERE id = p_id_credencial AND id_dispositivo = p_id_dispositivo;
  IF NOT FOUND OR anterior.id_plantilla IS NULL OR anterior.id_plantilla NOT BETWEEN 0 AND 65535 THEN
    RAISE SQLSTATE 'PT404' USING MESSAGE = 'La huella no está vinculada a una posición de este lector';
  END IF;
  PERFORM 1 FROM public.empleado WHERE id = anterior.id_empleado FOR NO KEY UPDATE;

  UPDATE public.solicitud_huella SET estado = 'vencida'
  WHERE (id_empleado = anterior.id_empleado OR id_dispositivo = p_id_dispositivo)
    AND estado IN ('pendiente', 'capturando') AND expira_en <= clock_timestamp();

  SELECT * INTO solicitud FROM public.solicitud_huella
  WHERE id_credencial_anterior = p_id_credencial AND id_dispositivo = p_id_dispositivo
    AND id_administrativo = p_id_administrativo AND operacion = p_operacion
    AND estado IN ('pendiente', 'capturando');
  IF NOT FOUND THEN
    INSERT INTO public.solicitud_huella (
      id_empleado, id_dispositivo, id_administrativo, expira_en, operacion,
      id_credencial_anterior, posicion_anterior, hash_anterior
    )
    VALUES (
      anterior.id_empleado, p_id_dispositivo, p_id_administrativo, clock_timestamp() + interval '2 minutes',
      p_operacion, anterior.id, anterior.id_plantilla, encode(sha256(anterior.plantilla), 'hex')
    )
    ON CONFLICT DO NOTHING RETURNING * INTO solicitud;
    IF NOT FOUND THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'El lector o el empleado ya tiene una captura en curso';
    END IF;
  END IF;
  RETURN to_jsonb(solicitud) - 'id_administrativo';
END;
$$;

CREATE OR REPLACE FUNCTION public.operar_lector_huella(
  p_id_dispositivo integer, p_accion text, p_id_solicitud uuid DEFAULT NULL,
  p_id_plantilla integer DEFAULT NULL, p_plantilla_hex text DEFAULT NULL, p_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  solicitud public.solicitud_huella%ROWTYPE;
  empleado_activo boolean;
  aplicado boolean := false;
  bytes_plantilla bytea;
  motivo text := p_error;
BEGIN
  IF p_accion IS NULL OR p_accion NOT IN ('tomar', 'confirmar', 'fallar', 'borrar') THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Acción inválida';
  END IF;
  IF p_accion = 'confirmar' THEN
    IF p_id_plantilla IS NULL OR p_id_plantilla NOT BETWEEN 0 AND 65535
       OR p_plantilla_hex IS NULL OR length(p_plantilla_hex) NOT BETWEEN 256 AND 4096
       OR length(p_plantilla_hex) % 2 <> 0 OR p_plantilla_hex !~ '^[0-9a-f]+$' THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'Posición o plantilla inválida';
    END IF;
    bytes_plantilla := decode(p_plantilla_hex, 'hex');
  END IF;

  PERFORM 1 FROM public.dispositivo
  WHERE id = p_id_dispositivo AND estado IS TRUE AND clave_hash IS NOT NULL
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Lector inactivo';
  END IF;

  UPDATE public.dispositivo SET ultima_conexion = clock_timestamp()
  WHERE id = p_id_dispositivo
    AND (ultima_conexion IS NULL OR ultima_conexion < clock_timestamp() - interval '30 seconds');

  IF p_accion = 'tomar' THEN
    UPDATE public.solicitud_huella SET estado = 'vencida'
    WHERE id_dispositivo = p_id_dispositivo AND estado IN ('pendiente', 'capturando')
      AND expira_en <= clock_timestamp();

    UPDATE public.solicitud_huella SET estado = 'capturando'
    WHERE id_dispositivo = p_id_dispositivo AND estado = 'pendiente' AND operacion = 'registrar'
      AND expira_en > clock_timestamp();

    SELECT * INTO solicitud FROM public.solicitud_huella
    WHERE id_dispositivo = p_id_dispositivo AND estado = 'capturando' AND operacion = 'registrar'
      AND expira_en > clock_timestamp();
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN to_jsonb(solicitud) - 'id_administrativo';
  END IF;

  SELECT * INTO solicitud FROM public.solicitud_huella
  WHERE id = p_id_solicitud AND id_dispositivo = p_id_dispositivo;
  IF NOT FOUND THEN
    RAISE SQLSTATE 'PT404' USING MESSAGE = 'Solicitud no encontrada';
  END IF;

  -- Mismo orden de bloqueo que al iniciar: lector, empleado y solicitud.
  SELECT estado INTO empleado_activo FROM public.empleado
  WHERE id = solicitud.id_empleado FOR NO KEY UPDATE;

  SELECT * INTO solicitud FROM public.solicitud_huella
  WHERE id = p_id_solicitud AND id_dispositivo = p_id_dispositivo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE SQLSTATE 'PT404' USING MESSAGE = 'Solicitud no encontrada';
  END IF;
  IF (p_accion = 'borrar' AND solicitud.operacion <> 'borrar') OR
     (p_accion = 'confirmar' AND solicitud.operacion = 'borrar') THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'El resultado no corresponde al tipo de solicitud';
  END IF;

  IF solicitud.estado = 'completada' THEN
    IF p_accion = 'borrar' AND solicitud.operacion = 'borrar' THEN
      RETURN to_jsonb(solicitud) - ARRAY['id_administrativo', 'hash_anterior'];
    END IF;
    IF p_accion = 'confirmar' AND EXISTS (
      SELECT 1 FROM public.credencial_huella
      WHERE id_empleado = solicitud.id_empleado AND id_dispositivo = p_id_dispositivo
        AND id_plantilla = p_id_plantilla AND plantilla = bytes_plantilla
    ) THEN
      RETURN to_jsonb(solicitud) - ARRAY['id_administrativo', 'hash_anterior'];
    END IF;
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'La captura ya fue confirmada con otro resultado';
  END IF;

  IF solicitud.estado IN ('vencida', 'fallida') THEN
    RETURN to_jsonb(solicitud) - ARRAY['id_administrativo', 'hash_anterior'];
  END IF;

  IF solicitud.expira_en <= clock_timestamp() THEN
    UPDATE public.solicitud_huella SET estado = 'vencida'
    WHERE id = p_id_solicitud RETURNING * INTO solicitud;
    RETURN to_jsonb(solicitud) - ARRAY['id_administrativo', 'hash_anterior'];
  END IF;
  IF solicitud.estado <> 'capturando' THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'El lector debe tomar la solicitud primero';
  END IF;

  IF p_accion = 'confirmar' AND solicitud.operacion = 'registrar' AND empleado_activo IS TRUE THEN
    INSERT INTO public.credencial_huella (id_empleado, id_dispositivo, id_plantilla, plantilla)
    VALUES (solicitud.id_empleado, p_id_dispositivo, p_id_plantilla, bytes_plantilla)
    ON CONFLICT DO NOTHING;
    aplicado := FOUND;
    motivo := 'El empleado o la posición del lector ya tiene una huella registrada';
  ELSIF p_accion = 'confirmar' AND solicitud.operacion = 'registrar' THEN
    motivo := 'El empleado ya no está activo';
  ELSIF p_accion = 'confirmar' AND solicitud.operacion = 'reemplazar' THEN
    motivo := 'La huella anterior cambió durante el registro';
    IF p_id_plantilla = solicitud.posicion_anterior THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'Usa una posición libre para la nueva huella';
    END IF;
    BEGIN
      UPDATE public.credencial_huella
      SET id_plantilla = p_id_plantilla, plantilla = bytes_plantilla, fecha_registro = clock_timestamp()
      WHERE id = solicitud.id_credencial_anterior AND id_empleado = solicitud.id_empleado
        AND id_dispositivo = p_id_dispositivo AND id_plantilla = solicitud.posicion_anterior
        AND sha256(plantilla) = decode(solicitud.hash_anterior, 'hex');
      aplicado := FOUND;
    EXCEPTION WHEN unique_violation THEN
      motivo := 'La nueva posición del lector ya está asignada';
    END;
  ELSIF p_accion = 'borrar' THEN
    DELETE FROM public.credencial_huella
    WHERE id = solicitud.id_credencial_anterior AND id_empleado = solicitud.id_empleado
      AND id_dispositivo = p_id_dispositivo AND id_plantilla = solicitud.posicion_anterior
      AND sha256(plantilla) = decode(solicitud.hash_anterior, 'hex');
    aplicado := FOUND;
    motivo := 'La huella anterior cambió antes de borrarse';
  END IF;

  UPDATE public.solicitud_huella
  SET estado = CASE WHEN aplicado THEN 'completada' ELSE 'fallida' END,
      error = CASE WHEN aplicado THEN NULL ELSE coalesce(motivo, 'Falló la captura') END
  WHERE id = p_id_solicitud RETURNING * INTO solicitud;
  RETURN to_jsonb(solicitud) - ARRAY['id_administrativo', 'hash_anterior'];
END;
$$;

REVOKE ALL ON FUNCTION public.iniciar_registro_huella(integer, integer, integer)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.iniciar_cambio_huella(integer, integer, integer, text)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.operar_lector_huella(integer, text, uuid, integer, text, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.iniciar_registro_huella(integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.iniciar_cambio_huella(integer, integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.operar_lector_huella(integer, text, uuid, integer, text, text) TO service_role;
GRANT UPDATE, DELETE ON TABLE public.credencial_huella TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
