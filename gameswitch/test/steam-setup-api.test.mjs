import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { readConfig } from '../server/config.mjs';
import { createDiagnostics } from '../server/diagnostics.mjs';
import { listenFixture } from './http-fixture.mjs';

const privateInput = 'Fixture_Steam_Password_and_Guard_2026';
const privateFailure = 'Fixture_Private_Broker_Error_2026';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

class FakeSetup {
  constructor() {
    this.calls = { start: [], input: [], cancel: [], subscribe: [], close: [] };
    this.listeners = new Set();
    this.session = null;
    this.fail = {};
    this.streamEvents = null;
  }
  async status() {
    return { enabled: true, active: Boolean(this.session && this.session.state === 'running'), ...(this.session ? { session: { ...this.session } } : {}) };
  }
  async start(input) {
    this.calls.start.push(structuredClone(input));
    if (this.fail.start) throw this.fail.start;
    this.session = { id: randomUUID(), gameId: input.gameId, startedAt: new Date().toISOString(), state: 'running' };
    return { ...this.session };
  }
  subscribe(id, callback) {
    this.calls.subscribe.push(id);
    if (this.fail.subscribe) throw this.fail.subscribe;
    if (id !== this.session?.id) throw Object.assign(new Error('Steam-Einrichtung nicht gefunden.'), { status: 404 });
    this.listeners.add(callback);
    if (this.streamEvents) queueMicrotask(() => {
      for (const event of this.streamEvents) if (this.listeners.has(callback)) callback(event);
    });
    return () => this.listeners.delete(callback);
  }
  async input(id, input) {
    this.calls.input.push({ id, input });
    if (this.fail.input) throw this.fail.input;
  }
  async cancel(id) {
    this.calls.cancel.push(id);
    if (this.fail.cancel) throw this.fail.cancel;
    if (this.session) this.session.state = 'cancelled';
    for (const callback of [...this.listeners]) callback({ type: 'exit', code: 130 });
  }
  async close() {
    this.calls.close.push(true);
    for (const callback of [...this.listeners]) callback({ type: 'exit', code: 130 });
    this.listeners.clear();
  }
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-steam-http-'));
  const config = readConfig({ DATA_DIR: directory });
  const records = [], lifecycleCalls = [];
  const steamSetup = new FakeSetup();
  const sourceId = randomUUID();
  const runtime = { status: async profile => ({ running: profile.id === sourceId }) };
  for (const method of ['preflight', 'save', 'stop', 'backup', 'install', 'start', 'restore', 'command']) runtime[method] = async () => lifecycleCalls.push(method);
  const instance = await createApp({ config, steamSetup, runtime, diagnostics: createDiagnostics({ write: line => records.push(JSON.parse(line)) }) });
  const server = await listenFixture(instance.app);
  config.port = server.address().port;
  config.origin = `http://127.0.0.1:${config.port}`;
  instance.store.state.profiles.push({ id: sourceId, name: 'Evolution2', gameId: 'minecraft', installed: true, status: 'running', serverId: 'fixture-minecraft' });
  instance.store.state.activeProfileId = sourceId;
  let cookie = '', csrf = '';
  const request = async (route, { method = 'GET', body, headers = {}, stream = false } = {}) => {
    const response = await fetch(config.origin + route, {
      method,
      headers: { Origin: config.origin, Cookie: cookie, 'X-CSRF-Token': csrf, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
    if (stream) return response;
    const data = await response.json();
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: response.status, data, headers: response.headers };
  };
  const post = (route, body = {}, headers) => request(route, { method: 'POST', body, headers });
  const setup = () => post('/api/setup', { token: instance.bootstrapToken, username: 'admin', password: 'Steam-HTTP-Fixture-Only-2026!' });
  const start = async (gameId = 'arma3', workshopIds = []) => {
    const response = await post('/api/steam/setup/start', { gameId, workshopIds });
    assert.ok([200, 201, 202].includes(response.status), JSON.stringify(response.data));
    assert.match(response.data.session.id, uuid);
    return response.data.session;
  };
  t.after(async () => {
    await instance.close();
    await steamSetup.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { instance, config, directory, records, lifecycleCalls, sourceId, steamSetup, request, post, setup, start };
}

const assertNoPrivate = value => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.ok(!text.includes(privateInput));
  assert.ok(!text.includes(privateFailure));
};

test('Steam setup endpoints require panel login, mutation Origin and CSRF before broker access', async t => {
  const f = await fixture(t), id = randomUUID();
  assert.equal((await f.request('/api/steam/setup/status')).status, 401);
  assert.equal((await f.post('/api/steam/setup/start', { gameId: 'arma3' })).status, 401);
  assert.equal((await f.request(`/api/steam/setup/${id}/events`)).status, 401);
  assert.equal((await f.post(`/api/steam/setup/${id}/input`, { input: privateInput })).status, 401);
  assert.equal((await f.post(`/api/steam/setup/${id}/cancel`)).status, 401);
  assert.deepEqual(Object.values(f.steamSetup.calls).flat(), []);
  await f.setup();
  for (const headers of [{ Origin: 'https://foreign.example' }, { 'X-CSRF-Token': '' }]) {
    assert.equal((await f.post('/api/steam/setup/start', { gameId: 'dayz' }, headers)).status, 403);
    assert.equal((await f.post(`/api/steam/setup/${id}/input`, { input: privateInput }, headers)).status, 403);
    assert.equal((await f.post(`/api/steam/setup/${id}/cancel`, {}, headers)).status, 403);
  }
  assert.deepEqual(Object.values(f.steamSetup.calls).flat(), []);
});

test('Steam start accepts only fixed games and bounded numeric Workshop IDs; credentials never belong to the start payload', async t => {
  const f = await fixture(t); await f.setup();
  for (const input of [
    {}, { gameId: 'gmod' }, { gameId: '../arma3' }, { gameId: 'arma3;sh' },
    { gameId: 'arma3', command: 'anything' }, { gameId: 'arma3', socketPath: '/private' },
    { gameId: 'arma3', username: privateInput }, { gameId: 'arma3', password: privateInput },
    { gameId: 'dayz', workshopIds: '1559212036' }, { gameId: 'dayz', workshopIds: [1559212036] },
    { gameId: 'dayz', workshopIds: ['12345;quit'] }, { gameId: 'dayz', workshopIds: ['../12345'] },
    { gameId: 'dayz', workshopIds: ['012345'] }, { gameId: 'dayz', workshopIds: ['12345', '12345'] },
    { gameId: 'dayz', workshopIds: Array.from({ length: 31 }, (_, i) => String(10000 + i)) },
  ]) {
    const response = await f.post('/api/steam/setup/start', input);
    assert.equal(response.status, 400, JSON.stringify(input));
    assertNoPrivate(response.data);
  }
  assert.equal(f.steamSetup.calls.start.length, 0);
  const session = await f.start('dayz', ['1559212036', '1564026768']);
  assert.equal(session.gameId, 'dayz');
  assert.deepEqual(f.steamSetup.calls.start, [{ gameId: 'dayz', workshopIds: ['1559212036', '1564026768'] }]);
  assert.deepEqual(f.lifecycleCalls, []);
  assert.equal(f.instance.store.state.activeProfileId, f.sourceId);
  assert.equal(f.instance.store.state.job, null);
  assert.equal(f.instance.store.state.pendingSafetyBackupProfileId, null);
});

test('Steam input preserves password whitespace and empty Enter, rejects command framing and never persists credentials', async t => {
  const f = await fixture(t); await f.setup(); const session = await f.start();
  const route = `/api/steam/setup/${session.id}/input`;
  for (const body of [
    {}, { input: 123 }, { input: null }, { input: privateInput, command: 'quit' },
    { input: `${privateInput}\nquit` }, { input: `${privateInput}\r` }, { input: '\u0000' },
    { input: '\u001b[31m' }, { input: '\u0085' }, { input: '\u2028' },
    { input: 'x'.repeat(513) }, { input: '🙂'.repeat(129) },
  ]) {
    const response = await f.post(route, body);
    assert.equal(response.status, 400);
    assertNoPrivate(response.data);
  }
  assert.equal(f.steamSetup.calls.input.length, 0);
  for (const input of [`  ${privateInput}  `, '']) assert.ok([200, 202].includes((await f.post(route, { input })).status));
  assert.deepEqual(f.steamSetup.calls.input, [{ id: session.id, input: `  ${privateInput}  ` }, { id: session.id, input: '' }]);
  assertNoPrivate(f.instance.store.state);
  assertNoPrivate(await fs.readFile(path.join(f.directory, 'state.json'), 'utf8'));
  assertNoPrivate(f.records);
  assert.deepEqual(f.lifecycleCalls, []);
});

test('input confirmation failures dispatch only once and return a safe correlated error without credentials', async t => {
  const f = await fixture(t); await f.setup(); const session = await f.start();
  f.steamSetup.fail.input = Object.assign(new Error(`${privateFailure}: ${privateInput}`), { status: 502 });
  const response = await f.post(`/api/steam/setup/${session.id}/input`, { input: privateInput });
  assert.equal(response.status, 502);
  assert.match(response.data.errorId, uuid);
  assert.equal(response.data.errorId, response.headers.get('x-request-id'));
  assert.equal(f.steamSetup.calls.input.length, 1);
  assertNoPrivate(response.data);
  assertNoPrivate(f.instance.store.state);
  assertNoPrivate(f.records);
  assert.deepEqual(f.lifecycleCalls, []);
});

test('Steam setup does not begin during a game lifecycle job or unhealthy persistence', async t => {
  const f = await fixture(t); await f.setup();
  f.instance.controller.busy = true;
  const busy = await f.post('/api/steam/setup/start', { gameId: 'arma3', workshopIds: [] });
  assert.equal(busy.status, 409);
  f.instance.controller.busy = false;
  f.instance.store.healthy = false;
  const unhealthy = await f.post('/api/steam/setup/start', { gameId: 'dayz', workshopIds: [] });
  assert.equal(unhealthy.status, 503);
  assert.equal(f.steamSetup.calls.start.length, 0);
  assert.deepEqual(f.lifecycleCalls, []);
  // This fixture injected unhealthy state without a failed disk write.
  f.instance.store.healthy = true;
});

test('Steam event streams reject foreign Origin and cross-site fetches before subscribing', async t => {
  const f = await fixture(t); await f.setup(); const session = await f.start();
  for (const headers of [{ Origin: 'https://foreign.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await f.request(`/api/steam/setup/${session.id}/events`, { headers });
    assert.equal(response.status, 403);
  }
  assert.equal(f.steamSetup.calls.subscribe.length, 0);
});

test('authorized Steam output uses uncached SSE with escaped JSON frames and closes on completion', async t => {
  const f = await fixture(t); await f.setup(); const session = await f.start();
  const output = 'Steam fixture output <script>alert(1)</script>\n';
  f.steamSetup.streamEvents = [{ type: 'output', data: Buffer.from(output).toString('base64') }, { type: 'exit', code: 0 }];
  const response = await f.request(`/api/steam/setup/${session.id}/events`, { stream: true });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const text = await response.text();
  const frames = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim()));
  assert.ok(frames.some(event => event.type === 'output' && Buffer.from(event.data, 'base64').toString('utf8') === output));
  assert.ok(frames.some(event => event.type === 'exit' && event.code === 0));
  assert.equal(f.steamSetup.listeners.size, 0);
  assertNoPrivate(f.instance.store.state);
  assertNoPrivate(f.records);
});

test('Steam session paths and cancel payloads are strict and cancellation never invokes game lifecycle methods', async t => {
  const f = await fixture(t); await f.setup(); const session = await f.start();
  for (const route of ['/api/steam/setup/not-a-uuid/input', '/api/steam/setup/not-a-uuid/cancel']) assert.equal((await f.post(route, route.endsWith('/input') ? { input: '' } : {})).status, 400);
  assert.equal((await f.post(`/api/steam/setup/${session.id}/cancel`, { command: 'stop Minecraft' })).status, 400);
  assert.equal(f.steamSetup.calls.cancel.length, 0);
  assert.ok([200, 202].includes((await f.post(`/api/steam/setup/${session.id}/cancel`)).status));
  assert.deepEqual(f.steamSetup.calls.cancel, [session.id]);
  assert.deepEqual(f.lifecycleCalls, []);
  assert.equal(f.instance.store.state.activeProfileId, f.sourceId);
  assert.equal(f.instance.store.state.pendingSafetyBackupProfileId, null);
});

test('active Steam setup prevents every game lifecycle request, including backup restoration', async t => {
  const f = await fixture(t); await f.setup(); await f.start();
  const backupId = randomUUID();
  f.instance.store.state.backups.push({ id: backupId, profileId: f.sourceId, status: 'completed', runtimeId: 'fixture-backup' });
  for (const action of ['activate', 'restart', 'stop', 'backup']) assert.equal((await f.post(`/api/profiles/${f.sourceId}/${action}`)).status, 409);
  assert.equal((await f.post(`/api/backups/${backupId}/restore`)).status, 409);
  assert.deepEqual(f.lifecycleCalls, []);
  assert.equal(f.instance.store.state.job, null);
  assert.equal(f.instance.store.state.activeProfileId, f.sourceId);
});

test('logout and renewed administrator login immediately close already authenticated Steam event streams', async t => {
  const f = await fixture(t); await f.setup(); const session = await f.start();
  const first = await f.request(`/api/steam/setup/${session.id}/events`, { stream: true });
  const firstReader = first.body.getReader();
  const firstEnded = firstReader.read();
  assert.equal(f.steamSetup.listeners.size, 1);
  assert.equal((await f.post('/api/logout')).status, 200);
  assert.equal((await firstEnded).done, true);
  assert.equal(f.steamSetup.listeners.size, 0);
  assert.equal((await f.request('/api/steam/setup/status')).status, 401);
  await f.post('/api/login', { username: 'admin', password: 'Steam-HTTP-Fixture-Only-2026!' });
  const second = await f.request(`/api/steam/setup/${session.id}/events`, { stream: true });
  const secondReader = second.body.getReader();
  const secondEnded = secondReader.read();
  assert.equal(f.steamSetup.listeners.size, 1);
  assert.equal((await f.post('/api/login', { username: 'admin', password: 'Steam-HTTP-Fixture-Only-2026!' })).status, 200);
  assert.equal((await secondEnded).done, true);
  assert.equal(f.steamSetup.listeners.size, 0);
  assert.deepEqual(f.lifecycleCalls, []);
});

test('the cancel action remains available when the separate Steam input rate limit is exhausted', async t => {
  const f = await fixture(t); await f.setup(); const session = await f.start();
  let limited = false;
  for (let attempt = 0; attempt < 35; attempt++) {
    const response = await f.post(`/api/steam/setup/${session.id}/input`, { input: '' });
    if (response.status === 429) { limited = true; break; }
    assert.equal(response.status, 200);
  }
  assert.equal(limited, true);
  assert.equal((await f.post(`/api/steam/setup/${session.id}/cancel`)).status, 200);
  assert.deepEqual(f.steamSetup.calls.cancel, [session.id]);
  assert.deepEqual(f.lifecycleCalls, []);
});
