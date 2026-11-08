import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { verificar_credenciales, validar_sesion, cerrar_sesion } from './services/login';
import { leer_token, leer_persistencia, leer_expiracion, guardar_token, borrar_token, leer_biometria, capacidad_biometrica, activar_biometria, desactivar_biometria } from './services/session-storage';

const SessionContext = createContext(null);
export function SessionProvider({ children }) {
  const session = useSessionState();
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession requiere SessionProvider.');
  return session;
}
function useSessionState() {
  const [empleado, set_empleado] = useState(null);
  const [checking, set_checking] = useState(true);
  const [session_error, set_session_error] = useState('');
  const [biometria, set_biometria] = useState(false);
  const [persistente, set_persistente] = useState(false);
  const [bloqueada, set_bloqueada] = useState(false);
  const [capacidad, set_capacidad] = useState({ disponible: false, motivo: 'Comprobando compatibilidad…' });
  const busy = useRef(false);
  const token_ref = useRef(null);
  const enabled = useRef(false);
  const mantener_ref = useRef(false);
  const revision = useRef(0);
  const expiracion_timer = useRef(null);
  const revalidar = useRef(false);
  const es_web = Platform.OS === 'web';
  const foreground = () => AppState.currentState == null || AppState.currentState === 'active';

  function bloquear() {
    revision.current += 1;
    token_ref.current = null;
    set_empleado(null);
    set_bloqueada(true);
  }
  async function aceptar(session) {
    if (enabled.current && !foreground()) { bloquear(); return; }
    if (es_web) {
      const version = revision.current;
      if (await leer_token() !== session.token) {
        token_ref.current = null;
        set_empleado(null);
        revalidar.current = true;
        return;
      }
      clearTimeout(expiracion_timer.current);
      const hasta = await leer_expiracion();
      if (version !== revision.current) return;
      if (hasta != null) expiracion_timer.current = setTimeout(restaurar, Math.max(0, hasta - Date.now()));
    }
    token_ref.current = session.token;
    set_empleado(session.empleado);
    set_bloqueada(false);
    set_session_error('');
  }
  async function limpiar() {
    clearTimeout(expiracion_timer.current);
    await borrar_token();
    token_ref.current = null;
    enabled.current = false;
    mantener_ref.current = false;
    set_persistente(false);
    set_biometria(false);
    set_bloqueada(false);
    set_empleado(null);
  }
  const restaurar = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const version = revision.current;
    let token_consultado = null;
    set_session_error('');
    try {
      enabled.current = await leer_biometria();
      set_biometria(enabled.current);
      if (enabled.current) {
        mantener_ref.current = true;
        set_persistente(true);
      }
      if (enabled.current && !token_ref.current) { bloquear(); return; }
      const desde_storage = es_web || !token_ref.current;
      const token = es_web ? await leer_token() : token_ref.current ?? await leer_token();
      token_consultado = token;
      if (!token) {
        clearTimeout(expiracion_timer.current);
        token_ref.current = null;
        mantener_ref.current = false;
        set_persistente(false);
        set_empleado(null);
        return;
      }
      if (desde_storage) {
        mantener_ref.current = await leer_persistencia();
        set_persistente(mantener_ref.current);
      }
      const actual = revision.current;
      const session = await validar_sesion(token);
      if (actual !== revision.current) return;
      await aceptar(session);
    } catch (error) {
      if (version !== revision.current) return;
      set_empleado(null);
      if (error.status === 401) {
        if (es_web && await leer_token() !== token_consultado) {
          revalidar.current = true;
          return;
        }
        try { await limpiar(); }
        catch { set_session_error('No se pudo eliminar la sesión vencida. Inténtalo de nuevo.'); }
      } else set_session_error(error.message || 'No se pudo restaurar tu sesión.');
    } finally {
      busy.current = false;
      set_checking(false);
      if (revalidar.current) { revalidar.current = false; queueMicrotask(restaurar); }
    }
  }, []);

  useEffect(() => {
    capacidad_biometrica().then(set_capacidad).catch(() => set_capacidad({ disponible: false, motivo: 'No se pudo detectar el lector. Puedes usar tu contraseña.' }));
    restaurar();
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && enabled.current) bloquear();
      if (state === 'active') restaurar();
    });
    const timer = setInterval(() => { if (foreground()) restaurar(); }, 60000);
    const sincronizar = (event) => {
      if (event.type === 'storage' && event.key != null && !['lector.session.web', 'lector.session'].includes(event.key)) return;
      revision.current += 1;
      token_ref.current = null;
      set_empleado(null);
      if (busy.current) revalidar.current = true;
      else restaurar();
    };
    if (es_web) {
      window.addEventListener('storage', sincronizar);
      window.addEventListener('focus', sincronizar);
    }
    return () => {
      listener.remove(); clearInterval(timer); clearTimeout(expiracion_timer.current);
      if (es_web) {
        window.removeEventListener('storage', sincronizar);
        window.removeEventListener('focus', sincronizar);
      }
    };
  }, [restaurar]);

  async function entrar(identificador, password, mantener = false) {
    if (busy.current) throw new Error('Espera un momento e inténtalo de nuevo.');
    busy.current = true;
    try {
      const session = await verificar_credenciales(identificador, password);
      // Revoca la sesión anterior solo si ya estaba desbloqueada en memoria.
      const anterior = token_ref.current;
      try { await guardar_token(session.token, mantener === true); }
      catch {
        await cerrar_sesion(session.token).catch(() => {});
        throw new Error('No se pudo guardar tu sesión. Revisa los permisos de almacenamiento.');
      }
      enabled.current = false;
      set_biometria(false);
      mantener_ref.current = mantener === true;
      set_persistente(mantener_ref.current);
      await aceptar(session);
      if (anterior && anterior !== session.token) cerrar_sesion(anterior).catch(() => {});
    } finally {
      busy.current = false;
      if (revalidar.current) { revalidar.current = false; queueMicrotask(restaurar); }
    }
  }
  async function desbloquear() {
    if (busy.current) throw new Error('Espera un momento e inténtalo de nuevo.');
    busy.current = true;
    try {
      const token = await leer_token(true);
      if (!token) {
        await limpiar();
        throw new Error('La sesión guardada ya no está disponible. Ingresa con tu contraseña.');
      }
      await aceptar(await validar_sesion(token));
    } catch (error) {
      if (error.status === 401) {
        await limpiar();
        throw new Error('Tu sesión venció. Ingresa con tu contraseña.');
      }
      if (error.message?.includes('contraseña')) throw error;
      throw new Error('No se pudo desbloquear. Reintenta la huella o ingresa con tu contraseña.');
    } finally { busy.current = false; }
  }
  async function cambiar_biometria(activar) {
    if (busy.current || !token_ref.current) throw new Error('Espera un momento e inténtalo de nuevo.');
    if (!mantener_ref.current) throw new Error('Para configurar la huella, ingresa marcando Mantener sesión iniciada.');
    busy.current = true;
    try {
      if (activar) await activar_biometria(token_ref.current);
      else await desactivar_biometria(token_ref.current);
      enabled.current = activar;
      set_biometria(activar);
      if (activar && !foreground()) bloquear();
    } finally { busy.current = false; }
  }
  async function salir() {
    if (busy.current) throw new Error('Espera un momento e inténtalo de nuevo.');
    busy.current = true;
    try {
      const token = token_ref.current;
      if (token) await cerrar_sesion(token);
      if (es_web) {
        const actual = await leer_token();
        if (actual && actual !== token) {
          token_ref.current = null;
          set_empleado(null);
          revalidar.current = true;
          return;
        }
      }
      await limpiar();
      set_session_error('');
    } finally {
      busy.current = false;
      if (revalidar.current) { revalidar.current = false; queueMicrotask(restaurar); }
    }
  }
  const usar_password = () => set_session_error('');
  return { empleado, checking, session_error, restaurar, entrar, salir, bloqueada, biometria, capacidad, desbloquear, cambiar_biometria, usar_password, persistente };
}
