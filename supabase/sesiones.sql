-- Ejecutar UNA VEZ en el SQL Editor del mismo proyecto que public.empleado.
-- Nueva tabla para sesiones propias; no modifica empleados ni contraseñas.
BEGIN;
CREATE TABLE public.sesion_empleado (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  id_empleado INTEGER NOT NULL REFERENCES public.empleado(id) ON DELETE CASCADE,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_expiracion TIMESTAMPTZ NOT NULL,
  CHECK (fecha_expiracion > fecha_creacion)
);
CREATE INDEX sesion_empleado_expiracion ON public.sesion_empleado(fecha_expiracion);
ALTER TABLE public.sesion_empleado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sesion_empleado FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.sesion_empleado TO service_role;
COMMIT;
