const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto, timingSafeEqual, pbkdf2Sync } = require('node:crypto');
const babel = require('@babel/core');

test('server: PBKDF2 login, hashed token, restore, revoke, replay, expiry and inactive employee', async () => {
  const salt = Buffer.alloc(16, 5);
  const hash = pbkdf2Sync('Test-password', salt, 600000, 32, 'sha256');
  const employee = { id: 1, nombre: 'Test', rol: 'empleado', estado: true,
    contrasena_hash: `pbkdf2$600000$${salt.toString('base64')}$${hash.toString('base64')}` };
  const sessions = new Map();
  const db = { from(table) {
    let filter;
    return {
      select() { return this; }, eq(key, value) { filter = value; return this; },
      async maybeSingle() {
        return { data: table === 'empleado' ? employee : sessions.get(filter) ?? null, error: null };
      },
      async insert(row) { sessions.set(row.token_hash, row); return { error: null }; },
      delete() { return { eq: async (key, value) => { sessions.delete(value); return { error: null }; } }; },
    };
  } };
  const source = fs.readFileSync('supabase/functions/sesion/index.ts', 'utf8').replace(/^import .*;\r?\n/gm, '');
  const code = babel.transformSync(source, { configFile: false, babelrc: false,
    plugins: ['@babel/plugin-transform-typescript'], filename: 'session.ts' }).code;
  let handler;
  vm.runInNewContext(code, {
    createClient: () => db, timingSafeEqual, crypto: webcrypto,
    Uint8Array, TextEncoder, Response, btoa, atob,
    Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://example.com' : key === 'SUPABASE_SECRET_KEYS' ? '{"default":"test"}' : undefined }, serve: fn => { handler = fn; } },
  });
  const call = (body, token) => handler(new Request('https://example.com', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-session-token': token } : {}) }, body: JSON.stringify(body),
  }));
  assert.equal((await call({ identificador: '1', password: 'wrong' })).status, 401);
  const response = await call({ identificador: '1', password: 'Test-password' });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.empleado.contrasena_hash, undefined);
  assert.match(data.session.token, /^[a-f0-9]{64}$/);
  assert.equal(sessions.has(data.session.token), false);
  assert.equal(sessions.size, 1);
  const token = data.session.token;
  assert.equal((await call({ accion: 'validar' }, token)).status, 200);
  employee.estado = false;
  assert.equal((await call({ accion: 'validar' }, token)).status, 401);
  employee.estado = true;
  const row = [...sessions.values()][0];
  const expiry = row.fecha_expiracion;
  row.fecha_expiracion = '2000-01-01T00:00:00Z';
  assert.equal((await call({ accion: 'validar' }, token)).status, 401);
  row.fecha_expiracion = expiry;
  assert.equal((await call({ accion: 'cerrar' }, token)).status, 200);
  assert.equal(sessions.size, 0);
  assert.equal((await call({ accion: 'validar' }, token)).status, 401);
  assert.equal((await call({ accion: 'cerrar' }, token)).status, 200);
  assert.equal((await call({ accion: 'validar' }, 'invalid')).status, 401);
});

test('client: session contract, token header, endpoint and failures', async () => {
  const source = fs.readFileSync('src/services/login.js', 'utf8').replace(
    "import { LOGIN_URL, PUBLIC_API_KEY } from '../config/login.js';",
    "const LOGIN_URL = 'https://example.com/functions/v1/login-empleado'; const PUBLIC_API_KEY = 'public-test';",
  );
  const service = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const token = 'a'.repeat(64);
  const payload = { ok: true, empleado: { id: 1, nombre: 'Test', rol: 'empleado' },
    session: { token, expires_at: new Date(Date.now() + 60000).toISOString() } };
  let last;
  global.fetch = async (url, options) => { last = { url, options }; return { ok: true, json: async () => payload }; };
  assert.equal((await service.verificar_credenciales(' 1 ', ' password ')).token, token);
  assert.deepEqual(JSON.parse(last.options.body), { identificador: '1', password: ' password ', accion: 'login' });
  payload.expires_at = payload.session.expires_at;
  await service.validar_sesion(token);
  assert.match(last.url, /\/sesion-empleado$/);
  assert.equal(last.options.headers['x-session-token'], token);
  global.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
  await service.cerrar_sesion(token);
  await assert.rejects(() => service.verificar_credenciales('1', 'test'), /inesperada/);
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(() => service.validar_sesion(token), error => error.status === 401);
  global.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(() => service.validar_sesion(token), /No se pudo conectar/);
});
