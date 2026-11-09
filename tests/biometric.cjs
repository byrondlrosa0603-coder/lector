const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
function cargar(file, modules, extra = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const code = babel.transformSync(source, { configFile: false, babelrc: false,
    plugins: [['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }], '@babel/plugin-transform-modules-commonjs'] }).code;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => modules[name] ?? require(name), setTimeout, clearTimeout, queueMicrotask, ...extra });
  return exports;
}

test('native storage: no automatic protected read; biometric key is gated; password removes old biometric enrollment', async () => {
  const values = new Map([['lector.session', 'test-token']]);
  const reads = [];
  const secure = {
    getItemAsync: async (key, options) => { reads.push({ key, options }); return values.get(key) ?? null; },
    setItemAsync: async (key, value, options) => {
      if (key.endsWith('.biometric') || key === 'lector.login.credentials') assert.equal(options.requireAuthentication, true);
      values.set(key, value);
    },
    deleteItemAsync: async key => { values.delete(key); },
    canUseBiometricAuthentication: () => true,
  };
  let enrolled = true;
  const local = { hasHardwareAsync: async () => true, isEnrolledAsync: async () => enrolled,
    supportedAuthenticationTypesAsync: async () => [1], AuthenticationType: { FINGERPRINT: 1 } };
  const storage = cargar('src/services/session-storage.js', { 'expo-secure-store': secure, 'expo-local-authentication': local });
  await storage.activar_biometria('test-token');
  assert.equal(values.has('lector.session'), false);
  assert.equal(await storage.leer_biometria(), true);
  assert.equal(await storage.leer_token(), null);
  assert.equal(reads.some(read => read.key.endsWith('.biometric')), false);
  assert.equal(await storage.leer_token(true), 'test-token');
  assert.equal(reads.at(-1).options.requireAuthentication, true);
  await storage.desactivar_biometria('test-token');
  assert.equal(await storage.leer_biometria(), false);
  assert.equal(await storage.leer_token(), 'test-token');
  await storage.activar_biometria('test-token');
  await storage.guardar_token('password-session', true);
  assert.equal(await storage.leer_biometria(), false);
  assert.equal(values.has('lector.session.biometric'), false);
  assert.equal(await storage.leer_token(), 'password-session');
  await storage.guardar_token('memory-only');
  assert.equal(await storage.leer_token(), null);
  assert.equal(values.size, 0);
  await storage.guardar_credenciales_huella(1, ' 1 ', 'test-only');
  await storage.borrar_token();
  assert.equal(await storage.leer_cuenta_huella(), 1);
  assert.equal(reads.some(read => read.key === 'lector.login.credentials'), false);
  assert.equal((await storage.leer_credenciales_huella()).password, 'test-only');
  assert.equal(reads.at(-1).options.requireAuthentication, true);
  assert.equal(values.get('lector.login.account'), '1');
  await storage.borrar_credenciales_huella();
  assert.equal(await storage.leer_credenciales_huella(), null);
  enrolled = false;
  assert.equal((await storage.capacidad_biometrica()).disponible, false);
});

test('session: locked startup, cancellation, unlock, stale restore cannot bypass background lock, password fallback', async () => {
  const slots = [];
  const effects = [];
  let cursor = 0, first = true, listener, platformState = 'active';
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useState: initial => { const index = cursor++; if (first) slots[index] = initial; return [slots[index], value => { slots[index] = value; }]; },
    useRef: initial => { const index = cursor++; if (first) slots[index] = { current: initial }; return slots[index]; },
    useCallback: fn => fn,
    useEffect: fn => { if (first) effects.push(fn); },
  };
  const state = { get currentState() { return platformState; }, addEventListener: (name, fn) => { listener = fn; return { remove() {} }; } };
  let protectedMode = true, cancel = false, reads = 0, validate, savedToken = null;
  let credenciales = null, cancelar_huella = false, accesos = 0, invalida = false;
  const session = { token: 'token', empleado: { id: 1, nombre: 'Test', rol: 'empleado' } };
  const storage = {
    leer_biometria: async () => protectedMode,
    leer_cuenta_huella: async () => credenciales?.id ?? null,
    guardar_credenciales_huella: async (id, identificador, password) => { credenciales = { id, identificador, password }; },
    leer_credenciales_huella: async () => {
      if (cancelar_huella) throw new Error('cancelled');
      return credenciales;
    },
    borrar_credenciales_huella: async () => { credenciales = null; },
    leer_persistencia: async () => protectedMode || savedToken != null,
    capacidad_biometrica: async () => ({ disponible: true }),
    leer_token: async auth => {
      reads++;
      if (cancel) throw new Error('cancelled');
      if (protectedMode) { assert.equal(auth, true); return 'token'; }
      return savedToken;
    },
    guardar_token: async (token, mantener) => { protectedMode = false; savedToken = mantener ? token : null; },
    borrar_token: async () => { protectedMode = false; savedToken = null; },
  };
  validate = async () => session;
  const service = { validar_sesion: async token => validate(token), verificar_credenciales: async (id, password) => {
    assert.equal(id, '1');
    assert.equal(password, 'password');
    accesos++;
    if (invalida) { const error = new Error('Credenciales inválidas'); error.status = 401; throw error; }
    return session;
  }, cerrar_sesion: async () => {} };
  const hook = cargar('src/use-session.js', { react, 'react-native': { AppState: state, Platform: { OS: 'android' } }, './services/login': service, './services/session-storage': storage }, { setInterval: () => 1, clearInterval() {} });
  function render() { cursor = 0; const value = hook.SessionProvider({ children: null }).props.value; first = false; return value; }
  const flush = () => new Promise(resolve => setImmediate(resolve));
  render(); effects.forEach(effect => effect()); await flush();
  assert.equal(render().bloqueada, true);
  assert.equal(render().empleado, null);
  assert.equal(reads, 0);
  cancel = true;
  await assert.rejects(() => render().desbloquear(), /contraseña/);
  assert.equal(render().empleado, null);
  cancel = false;
  await render().desbloquear();
  assert.equal(render().empleado.id, 1);
  let finish;
  validate = () => new Promise(resolve => { finish = resolve; });
  listener('active'); await flush();
  platformState = 'background'; listener('background');
  platformState = 'active'; listener('active');
  finish(session); await flush();
  assert.equal(render().empleado, null);
  assert.equal(render().bloqueada, true);
  await render().entrar('1', 'password');
  assert.equal(render().empleado.id, 1);
  assert.equal(render().biometria, false);
  assert.equal(render().persistente, false);
  assert.equal(savedToken, null);
  await assert.rejects(() => render().cambiar_biometria(true), /Mantener sesión/);

  // Segundo plano no finaliza la ejecución: una sesión temporal sigue en memoria.
  validate = async () => session;
  platformState = 'background'; listener('background');
  platformState = 'active'; listener('active'); await flush();
  assert.equal(render().empleado.id, 1);
  assert.equal(render().persistente, false);

  // Reiniciar el proveedor simula un proceso nuevo sin acceso al token en memoria.
  async function reiniciar() {
    slots.length = 0; effects.length = 0; cursor = 0; first = true;
    render(); effects.forEach(effect => effect()); await flush();
    return render();
  }
  assert.equal((await reiniciar()).empleado, null);
  await render().entrar('1', 'password', true);
  assert.equal(render().persistente, true);
  assert.equal(savedToken, 'token');
  assert.equal((await reiniciar()).empleado.id, 1);
  assert.equal(render().persistente, true);
  await render().salir();
  assert.equal(savedToken, null);
  assert.equal(render().persistente, false);
  assert.equal((await reiniciar()).empleado, null);

  // Un token perdido o revocado no elimina las credenciales protegidas.
  await render().entrar('1', 'password', false, true);
  assert.equal(render().acceso_huella, true);
  await render().salir();
  assert.equal(savedToken, null);
  const reiniciada = await reiniciar();
  assert.equal(reiniciada.empleado, null);
  assert.equal(reiniciada.acceso_huella, true);
  const antes = accesos;
  cancelar_huella = true;
  await assert.rejects(() => render().entrar_con_huella(), /confirmar la huella/);
  assert.equal(accesos, antes);
  assert.equal(render().acceso_huella, true);
  cancelar_huella = false;
  await render().entrar_con_huella();
  assert.equal(accesos, antes + 1);
  assert.equal(render().empleado.id, 1);
  assert.equal(render().persistente, false);
  await render().salir();
  invalida = true;
  await assert.rejects(() => render().entrar_con_huella(), /ya no son válidas/);
  assert.equal(credenciales, null);
  assert.equal(render().acceso_huella, false);
  invalida = false;
  await render().entrar('1', 'password', false, true);
  await render().quitar_acceso_huella();
  assert.equal(credenciales, null);
  assert.equal(render().empleado.id, 1);

  await render().entrar('1', 'password', false, true);
  await render().salir();
  service.verificar_credenciales = async (id, password) => {
    if (id === '1') { assert.equal(password, 'password'); return session; }
    assert.equal(id, '2');
    assert.equal(password, 'otra-password');
    return { token: 'otro-token', empleado: { id: 2, nombre: 'Otra cuenta', rol: 'empleado' } };
  };
  let avisos = 0;
  const confirmar = respuesta => async () => { avisos++; return respuesta; };
  await render().entrar('2', 'otra-password', false, false, confirmar(true));
  assert.equal(render().empleado.id, 2);
  assert.equal(credenciales.id, 1);
  assert.equal(avisos, 0);
  await render().salir();
  await render().entrar('2', 'otra-password', false, true, confirmar(false));
  assert.equal(render().empleado.id, 2);
  assert.equal(credenciales.id, 1);
  assert.equal(avisos, 1);
  await render().salir();
  await render().entrar_con_huella();
  assert.equal(render().empleado.id, 1);
  await render().salir();
  await render().entrar('2', 'otra-password', false, true, confirmar(true));
  assert.equal(render().empleado.id, 2);
  assert.equal(credenciales.id, 2);
  assert.equal(avisos, 2);
});

function mundo_web() {
  const compartido = new Map(), pestañas = [];
  let ahora = 1000000;
  class Reloj extends Date { static now() { return ahora; } }
  const service = {
    validar_sesion: async token => ({ token, empleado: { id: 1, nombre: 'Test', rol: 'empleado' } }),
    verificar_credenciales: async () => ({ token: 'token-compartido', empleado: { id: 1, nombre: 'Test', rol: 'empleado' } }),
    cerrar_sesion: async () => {},
  };
  function nueva_pestaña() {
    const eventos = {}, temporales = new Map(), timers = new Map();
    const tab = { eventos, timers };
    pestañas.push(tab);
    const notificar = (key, oldValue, newValue) => pestañas.filter(other => other !== tab).forEach(other => {
      queueMicrotask(() => other.eventos.storage?.({ type: 'storage', key, oldValue, newValue }));
    });
    const window = {
      document: { visibilityState: 'visible' },
      localStorage: {
        getItem: key => compartido.get(key) ?? null,
        setItem: (key, value) => {
          const anterior = compartido.get(key) ?? null;
          if (anterior !== value) { compartido.set(key, value); notificar(key, anterior, value); }
        },
        removeItem: key => {
          const anterior = compartido.get(key) ?? null;
          if (compartido.delete(key)) notificar(key, anterior, null);
        },
      },
      sessionStorage: {
        getItem: key => temporales.get(key) ?? null,
        setItem: (key, value) => temporales.set(key, value),
        removeItem: key => temporales.delete(key),
      },
      addEventListener: (name, callback) => { eventos[name] = callback; },
      removeEventListener: name => { delete eventos[name]; },
    };
    const storage = cargar('src/services/session-storage.web.js', {}, { window, Date: Reloj });
    Object.assign(tab, { storage, window, temporales });
    tab.iniciar = () => {
      const slots = [], effects = [];
      let cursor = 0, first = true;
      const react = {
        createContext: () => ({ Provider: 'provider' }),
        useState: initial => { const index = cursor++; if (first) slots[index] = initial; return [slots[index], value => { slots[index] = value; }]; },
        useRef: initial => { const index = cursor++; if (first) slots[index] = { current: initial }; return slots[index]; },
        useCallback: fn => fn, useEffect: fn => { if (first) effects.push(fn); },
      };
      let timerId = 0;
      const hook = cargar('src/use-session.js', { react,
        'react-native': { Platform: { OS: 'web' }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
        './services/login': service, './services/session-storage': storage,
      }, {
        window, Date: Reloj, setInterval: () => 1, clearInterval() {},
        setTimeout: (callback, delay) => { timers.set(++timerId, { callback, hasta: ahora + delay }); return timerId; },
        clearTimeout: id => timers.delete(id),
      });
      function render() { cursor = 0; const value = hook.SessionProvider({ children: null }).props.value; first = false; return value; }
      render(); effects.forEach(effect => effect());
      tab.render = render;
      return render;
    };
    return tab;
  }
  function avanzar(ms) {
    ahora += ms;
    for (const tab of pestañas) for (const [id, timer] of tab.timers) {
      if (timer.hasta <= ahora) { tab.timers.delete(id); timer.callback(); }
    }
  }
  return { compartido, nueva_pestaña, avanzar, service };
}
const estabilizar = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

test('web: activity in any tab renews the shared 5-minute deadline without revalidation; idle tabs expire together', async () => {
  const mundo = mundo_web();
  const validar = mundo.service.validar_sesion;
  let validaciones = 0;
  mundo.service.validar_sesion = async token => { validaciones++; return validar(token); };
  const a = mundo.nueva_pestaña(); a.iniciar();
  const b = mundo.nueva_pestaña(); b.iniciar();
  await estabilizar();
  await a.render().entrar('1', 'password', false); await estabilizar();
  assert.equal(a.render().empleado.id, 1);
  assert.equal(b.render().empleado.id, 1);
  assert.equal(a.render().persistente, false);
  assert.equal(b.render().persistente, false);
  const original = mundo.compartido.get('lector.session.web');
  mundo.avanzar(4 * 60000);
  const c = mundo.nueva_pestaña(); c.iniciar(); await estabilizar();
  assert.equal(c.render().empleado.id, 1);
  await c.render().restaurar(); await estabilizar();
  c.eventos.focus({ type: 'focus' }); await estabilizar();
  c.eventos.keydown({ isTrusted: false });
  c.window.document.visibilityState = 'hidden';
  c.eventos.pointerdown({ isTrusted: true });
  assert.equal(mundo.compartido.get('lector.session.web'), original);
  const validaciones_antes = validaciones;
  b.eventos.wheel({ isTrusted: true }); await estabilizar();
  const renovada = JSON.parse(mundo.compartido.get('lector.session.web'));
  assert.equal(renovada.hasta - JSON.parse(original).hasta, 4 * 60000);
  assert.equal(validaciones, validaciones_antes);
  mundo.avanzar(4 * 60000); await estabilizar();
  assert.equal(a.render().empleado.id, 1);
  assert.equal(b.render().empleado.id, 1);
  assert.equal(c.render().empleado.id, 1);
  mundo.avanzar(60000); await estabilizar();
  assert.equal(a.render().empleado, null);
  assert.equal(b.render().empleado, null);
  assert.equal(c.render().empleado, null);
  assert.equal(await c.storage.leer_token(), null);
  assert.equal(mundo.compartido.size, 0);
});

test('web: persistent mode ignores the idle limit; logout synchronizes without reviving another tab memory token', async () => {
  const mundo = mundo_web();
  const a = mundo.nueva_pestaña(); a.iniciar(); await estabilizar();
  await a.render().entrar('1', 'password', true);
  const b = mundo.nueva_pestaña(); b.iniciar(); await estabilizar();
  assert.equal(b.render().persistente, true);
  mundo.avanzar(6 * 60000); await b.render().restaurar();
  assert.equal(b.render().empleado.id, 1);
  await a.render().salir(); await estabilizar();
  assert.equal(a.render().empleado, null);
  assert.equal(b.render().empleado, null);
  await b.render().restaurar();
  assert.equal(b.render().empleado, null);
  assert.equal(mundo.compartido.size, 0);
});

test('web: legacy temporary sessions are discarded; legacy persistent sessions migrate; malformed or server-expired sessions clear', async () => {
  const mundo = mundo_web();
  const a = mundo.nueva_pestaña();
  a.temporales.set('lector.session', 'legacy-tab');
  assert.equal(await a.storage.leer_token(), null);
  mundo.compartido.set('lector.session', 'legacy-saved');
  assert.equal(await a.storage.leer_token(), 'legacy-saved');
  assert.equal(await a.storage.leer_persistencia(), true);
  assert.equal(mundo.compartido.has('lector.session'), false);
  await a.storage.guardar_token('legacy-deadline', false);
  const original = JSON.parse(mundo.compartido.get('lector.session.web'));
  mundo.compartido.set('lector.session.web', JSON.stringify({ ...original, hasta: original.hasta + 25 * 60000 }));
  assert.equal(await a.storage.leer_expiracion(), original.hasta);
  mundo.compartido.set('lector.session.web', '{"token":"bad","mantener":false}');
  assert.equal(await a.storage.leer_token(), null);
  await a.storage.guardar_token('expired-server', false);
  mundo.service.validar_sesion = async () => { const error = new Error('expired'); error.status = 401; throw error; };
  a.iniciar(); await estabilizar();
  assert.equal(a.render().empleado, null);
  assert.equal(mundo.compartido.size, 0);
});

test('web: stale 401 cannot erase a new login performed in another tab', async () => {
  const mundo = mundo_web();
  const a = mundo.nueva_pestaña(); a.iniciar(); await estabilizar();
  await a.render().entrar('1', 'password', false);
  const b = mundo.nueva_pestaña(); b.iniciar(); await estabilizar();
  let rejectOld, slow = true;
  mundo.service.validar_sesion = async token => {
    if (slow) { slow = false; return new Promise((resolve, reject) => { rejectOld = reject; }); }
    return { token, empleado: { id: 2, nombre: 'Otro', rol: 'empleado' } };
  };
  const pendiente = a.render().restaurar(); await estabilizar();
  mundo.service.verificar_credenciales = async () => ({ token: 'new-token', empleado: { id: 2, nombre: 'Otro', rol: 'empleado' } });
  await b.render().entrar('2', 'password', true); await estabilizar();
  assert.equal(a.render().empleado, null);
  assert.equal(a.render().checking, true);
  const error = new Error('old token expired'); error.status = 401;
  rejectOld(error); await pendiente; await estabilizar();
  assert.equal(await a.storage.leer_token(), 'new-token');
  assert.equal(a.render().empleado.id, 2);
  assert.equal(b.render().empleado.id, 2);
});

test('web: a new tab waits for validation and refocusing keeps the verified portal visible', async () => {
  const mundo = mundo_web();
  const a = mundo.nueva_pestaña(); a.iniciar(); await estabilizar();
  await a.render().entrar('1', 'password', false);

  const validar = mundo.service.validar_sesion;
  let completar;
  mundo.service.validar_sesion = token => new Promise(resolve => {
    completar = () => resolve(validar(token));
  });
  const b = mundo.nueva_pestaña(); b.iniciar(); await estabilizar();
  assert.equal(b.render().checking, true);
  assert.equal(b.render().empleado, null);
  completar(); await estabilizar();
  assert.equal(b.render().checking, false);
  assert.equal(b.render().empleado.id, 1);

  b.eventos.focus({ type: 'focus' }); await estabilizar();
  assert.equal(b.render().checking, false);
  assert.equal(b.render().empleado.id, 1);
  completar(); await estabilizar();
  assert.equal(b.render().empleado.id, 1);
});
