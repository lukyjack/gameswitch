import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { readConfig } from '../server/config.mjs';
import { createDiagnostics } from '../server/diagnostics.mjs';
import { PufferRuntime } from '../server/runtime.mjs';
import { listenFixture } from './http-fixture.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const privateError = 'PRIVATE_ERROR_FIXTURE_2026';
const privateBody = 'PRIVATE_BODY_FIXTURE_2026';
const privateQuery = 'PRIVATE_QUERY_FIXTURE_2026';
const privateHeader = 'PRIVATE_HEADER_FIXTURE_2026';

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-http-diagnostics-'));
  const config = readConfig({ DATA_DIR: directory });
  const records = [];
  const diagnostics = options.diagnostics || createDiagnostics({ write: line => records.push(JSON.parse(line)) });
  const runtime = options.makeRuntime?.(config);
  const instance = await createApp({ config, diagnostics, ...(runtime ? { runtime } : {}), ...(options.providers ? { providers: options.providers } : {}) });
  let server = await listenFixture(instance.app);
  while (server.address().port === 27015) { await new Promise(resolve => server.close(resolve)); server = await listenFixture(instance.app); }
  config.port = server.address().port;
  config.origin = `http://127.0.0.1:${config.port}`;
  let cookie = '', csrf = '';
  const request = async (route, { method = 'GET', body, raw, headers = {} } = {}) => {
    const response = await fetch(config.origin + route, {
      method, headers: { Origin: config.origin, Cookie: cookie, 'X-CSRF-Token': csrf, ...(body === undefined && raw === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(raw === undefined ? body === undefined ? {} : { body: JSON.stringify(body) } : { body: raw }),
    });
    const data = await response.json();
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: response.status, headers: response.headers, data };
  };
  const post = (route, body = {}, headers) => request(route, { method: 'POST', body, headers });
  const setup = () => post('/api/setup', { token: instance.bootstrapToken, username: 'admin', password: 'Diagnostics-test-password-2026' });
  const createProfile = async () => {
    const created = await post('/api/profiles', { name: 'Diagnostics fixture', gameId: 'gmod', version: 'latest', loader: 'steam', port: 27015, memoryMb: 4096, maxPlayers: 12 });
    assert.equal(created.status, 201);
    return instance.store.state.profiles.find(profile => profile.id === created.data.profile.id);
  };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await instance.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { instance, config, directory, records, request, post, setup, createProfile };
}

function assertCorrelated(response) {
  const requestId = response.headers.get('x-request-id');
  assert.match(requestId, uuid);
  assert.equal(response.data.requestId, requestId);
  assert.equal(response.data.errorId, requestId);
  assert.ok(response.data.error.includes(requestId));
  return requestId;
}

function assertPrivate(value, extras = []) {
  const serialized = JSON.stringify(value);
  for (const secret of [privateError, privateBody, privateQuery, privateHeader, ...extras]) assert.ok(!serialized.includes(secret), 'Private fixture value was exposed');
}

test('request IDs are generated independently for success and rejected requests before auth, Origin or Host checks', async t => {
  const f = await fixture(t);
  const supplied = randomUUID();
  // Fetch normalizes Host; use the HTTP client to exercise the actual host guard.
  const foreignHost = await new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port: f.config.port, path: '/api/session', headers: { Host: 'untrusted.example', 'X-Request-ID': supplied } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => { try { resolve({ status: response.statusCode, headers: new Headers(response.headers), data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch (error) { reject(error); } });
    });
    request.on('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error('HTTP fixture timeout')));
    request.end();
  });
  const responses = [
    await f.request('/api/session', { headers: { 'X-Request-ID': supplied } }),
    await f.request('/api/state', { headers: { 'X-Request-ID': supplied } }),
    await f.post('/api/setup', {}, { Origin: 'https://untrusted.example', 'X-Request-ID': supplied }),
    foreignHost,
  ];
  assert.deepEqual(responses.map(response => response.status), [200, 401, 403, 403]);
  const generated = responses.map(response => response.headers.get('x-request-id'));
  for (const id of generated) { assert.match(id, uuid); assert.notEqual(id, supplied); }
  assert.equal(new Set(generated).size, generated.length);
  assert.equal(f.records.length, 0);
});

test('malformed JSON errors use a fixed safe response and never reflect raw submitted secrets', async t => {
  const f = await fixture(t);
  const response = await f.request('/api/setup', { method: 'POST', raw: privateBody, headers: { 'X-Request-ID': privateHeader } });
  assert.equal(response.status, 400);
  assert.match(response.headers.get('x-request-id'), uuid);
  assertPrivate(response.data);
  const oversized = await f.request('/api/setup', { method: 'POST', raw: JSON.stringify({ password: privateBody + 'x'.repeat(17000) }) });
  assert.equal(oversized.status, 413);
  assert.match(oversized.headers.get('x-request-id'), uuid);
  assertPrivate(oversized.data);
  assertPrivate(f.records);
});

test('unexpected API failures correlate each response and private diagnostic without logging URLs, query or headers', async t => {
  const sameError = Object.assign(new Error(`${privateError} https://example.invalid/?token=${privateQuery}`), {
    code: privateBody, cause: new Error(privateHeader), password: privateBody,
    stack: `${privateError}\n at secretFunction (/private/${privateBody}/server/runtime.mjs:12:9)\n at ${privateHeader}`,
  });
  const f = await fixture(t, { providers: { search: async () => { throw sameError; } } });
  await f.setup();
  const supplied = randomUUID(), generated = [];
  for (let index = 0; index < 2; index++) {
    const response = await f.request(`/api/catalog/modpacks?q=${privateQuery}`, { headers: { 'X-Request-ID': supplied, Authorization: `Bearer ${privateHeader}` } });
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    generated.push(assertCorrelated(response));
    assert.notEqual(generated.at(-1), supplied);
    assertPrivate(response.data);
  }
  assert.notEqual(generated[0], generated[1]);
  assert.equal(f.records.length, 2);
  for (let index = 0; index < f.records.length; index++) {
    const record = f.records[index];
    assert.equal(record.errorId, generated[index]);
    assert.equal(record.requestId, generated[index]);
    assert.equal(record.operation, 'http');
    assert.equal(record.method, 'GET');
    assert.equal(record.status, 500);
    assert.equal(record.reason, 'unknown');
    for (const key of ['message', 'stack', 'cause', 'url', 'path', 'query', 'body', 'headers', 'password', 'command']) assert.equal(Object.hasOwn(record, key), false);
  }
  assertPrivate(f.records);
});

test('handled uncertain command failures retain one dispatch and expose no console arguments in diagnostics or audit', async t => {
  const f = await fixture(t); await f.setup();
  const profile = await f.createProfile(); profile.installed = true;
  let calls = 0;
  f.instance.runtime.command = async () => { calls++; throw Object.assign(new Error(privateError), { code: 'CONSOLE_DELIVERY_UNCERTAIN', privateBody }); };
  const response = await f.post(`/api/profiles/${profile.id}/console?private=${privateQuery}`, { command: `say ${privateBody}` }, { Authorization: privateHeader });
  assert.equal(response.status, 502);
  const id = assertCorrelated(response);
  assert.equal(calls, 1);
  assert.match(response.data.error, /nicht automatisch/u);
  assert.equal(f.instance.controller.busy, false);
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0].errorId, id);
  assert.equal(f.records[0].reason, 'delivery_uncertain');
  assertPrivate(response.data);
  assertPrivate(f.records);
  assertPrivate(f.instance.store.state.events);
  assertPrivate(await fs.readFile(path.join(f.directory, 'state.json'), 'utf8'));
});

test('private upstream OAuth failure remains a correlated gateway error and does not invalidate panel login', async t => {
  const f = await fixture(t, { makeRuntime: config => {
    Object.assign(config, { pufferUrl: 'http://127.0.0.1:8080', clientId: 'fixture-client', clientSecret: privateBody });
    return new PufferRuntime(config, async () => new Response(JSON.stringify({ error: 'invalid_client', error_description: `${privateError} ${privateHeader}` }), { status: 401 }));
  } });
  await f.setup();
  const profile = await f.createProfile();
  const response = await f.request(`/api/profiles/${profile.id}/console`);
  assert.ok(response.status >= 500 && response.status <= 599, 'Private upstream auth must not become panel login401/403');
  assertCorrelated(response);
  assertPrivate(response.data);
  assertPrivate(f.records);
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0].reason, 'upstream_auth');
  assert.equal(f.records[0].upstreamStatus, 401);
  const session = await f.request('/api/session');
  assert.equal(session.status, 200);
  assert.equal(session.data.authenticated, true);
});

test('background lifecycle errors expose only a safe correlated job error and audit entry', async t => {
  const f = await fixture(t); await f.setup();
  const profile = await f.createProfile();
  f.instance.runtime.preflight = async () => { throw new Error(`${privateError} ${privateBody} ${privateQuery}`); };
  const activation = await f.post(`/api/profiles/${profile.id}/activate`);
  assert.equal(activation.status, 202);
  const requestId = activation.headers.get('x-request-id');
  await f.instance.controller.pending;
  const state = await f.request('/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.data.job.status, 'failed');
  assert.equal(state.data.job.requestId, requestId);
  assert.equal(state.data.job.errorId, requestId);
  assert.ok(state.data.job.error.includes(requestId));
  assertPrivate(state.data);
  assertPrivate(f.records);
  assertPrivate(await fs.readFile(path.join(f.directory, 'state.json'), 'utf8'));
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0].errorId, requestId);
  assert.equal(f.records[0].profileId, profile.id);
  assert.equal(f.records[0].operation, 'activate');
});

test('diagnostic sink failure cannot replace a safe correlated HTTP response', async t => {
  const diagnostics = createDiagnostics({ write: () => { throw new Error(privateError); } });
  const f = await fixture(t, { diagnostics, providers: { search: async () => { throw new Error(privateBody); } } });
  await f.setup();
  const response = await f.request('/api/catalog/modpacks');
  assert.equal(response.status, 500);
  assertCorrelated(response);
  assertPrivate(response.data);
});
