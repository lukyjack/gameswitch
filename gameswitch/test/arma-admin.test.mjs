import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.mjs';
import { readConfig } from '../server/config.mjs';
import { PufferRuntime } from '../server/runtime.mjs';
import { createDiagnostics } from '../server/diagnostics.mjs';
import { buildAdminAction, mergeAdminFile } from '../server/game-admin.mjs';
import { listenFixture } from './http-fixture.mjs';

const id = '76561197960512641';
const legacyId = 'STEAM_0:1:123456';
const other = '76561198000000001';
const privatePassword = 'Arma_Private_Fixture_Password_2026';
const adminPath = 'arma/admins.cfg';
const action = (role = 'admin', steamId = legacyId) => buildAdminAction({ gameId: 'arma3' }, { steamId, role });
const invalid = callback => assert.throws(callback, error => error.status === 400);

async function fixture(t, makeRuntime) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-arma-admin-'));
  const config = readConfig({ DATA_DIR: directory });
  const records = [];
  const diagnostics = createDiagnostics({ write: line => records.push(JSON.parse(line)) });
  const instance = await createApp({ config, diagnostics, ...(makeRuntime ? { runtime: makeRuntime(config) } : {}) });
  const server = await listenFixture(instance.app);
  config.port = server.address().port;
  config.origin = `http://127.0.0.1:${config.port}`;
  let cookie = '', csrf = '';
  const post = async (route, body, headers = {}) => {
    const response = await fetch(config.origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: config.origin, Cookie: cookie, 'X-CSRF-Token': csrf, ...headers }, body: JSON.stringify(body) });
    const data = await response.json();
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: response.status, data };
  };
  const setup = () => post('/api/setup', { token: instance.bootstrapToken, username: 'admin', password: 'Arma-Admin-Test-Only-2026!' });
  const create = async (extra = {}) => {
    const response = await post('/api/profiles', { gameId: 'arma3', loader: 'steam', version: 'latest', name: 'Arma Prüfung', port: 2302, maxPlayers: 10, memoryMb: 6144, serverPassword: privatePassword, mission: 'MP_COOP_m01.Stratis', adminSteamIds: [], workshopIds: [], ...extra });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    const profile = instance.store.state.profiles.find(item => item.id === response.data.profile.id);
    profile.installed = true;
    await instance.store.save();
    return profile;
  };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await instance.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { instance, records, post, setup, create };
}

test('Arma admin actions canonicalize Steam identities and target only the managed config fragment', () => {
  const granted = action();
  assert.equal(granted.kind, 'file'); assert.equal(granted.path, adminPath); assert.equal(granted.identity, id); assert.equal(granted.role, 'admin');
  assert.match(granted.notice, /#login/); assert.match(granted.notice, /kein Neustart/);
  assert.equal(action('user', id).identity, id);
  for (const body of [{ steamId: id, role: 'superadmin' }, { steamId: '76561197960265728', role: 'admin' }, { steamId: `${id};#shutdown`, role: 'admin' }, { steamId: id, role: 'admin', command: '#shutdown' }]) invalid(() => buildAdminAction({ gameId: 'arma3' }, body));
  invalid(() => buildAdminAction({ gameId: 'dayz' }, { steamId: id, role: 'admin' }));
});

test('Arma managed admin changes preserve unrelated accounts and removal removes only the selected ID', () => {
  const initial = `admins[] = {"${other}"};\n`;
  assert.equal(mergeAdminFile(action(), initial), `admins[] = {"${other}","${id}"};\n`);
  assert.equal(mergeAdminFile(action('user'), `admins[] = {"${id}","${other}","${id}"};\n`), initial);
  assert.equal(mergeAdminFile(action('user'), initial), initial);
  const canonicalExisting = `admins[] = {"${other}","${id}"};\n`;
  assert.equal(mergeAdminFile(action(), canonicalExisting), canonicalExisting);
  assert.equal(mergeAdminFile(action(), ' \n admins[] = { };\r\n'), `admins[] = {"${id}"};\n`);
});

test('Arma admin parser refuses unknown config, include directives, malformed identities, oversized files and more than20 unique administrators', () => {
  for (const original of ['', 'admins[] = {}; passwordAdmin="unsafe";', '#include "another.cfg"\nadmins[] = {};', '// managed\nadmins[] = {};', `admins[] = {"${id}"};\nadmins[] = {};`, `admins[] = {${id}};`, 'admins[] = {"76561197960265728"};', `admins[] = {"${id}\n"};`, 'admins[] = {};' + '\0', ' '.repeat(256 * 1024 + 1)]) invalid(() => mergeAdminFile(action(), original));
  const twenty = Array.from({ length: 20 }, (_, index) => String(76561198000000001n + BigInt(index)));
  const original = `admins[] = {${twenty.map(value => `"${value}"`).join(',')}};\n`;
  invalid(() => mergeAdminFile(action(), original));
  assert.equal((mergeAdminFile(action('user', twenty[0]), original).match(/[0-9]{17}/g) || []).length, 19);
  invalid(() => mergeAdminFile({ ...action(), path: 'arma/../server.cfg' }, 'admins[] = {};'));
});

test('Arma admin HTTP endpoint inherits auth, CSRF and Origin checks and keeps target IDs and passwords out of audit', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('/api/profiles/unknown/admin', { steamId: id, role: 'admin' })).status, 401);
  await f.setup(); const profile = await f.create();
  const state = await f.instance.runtime.read(profile);
  state.running = false; state.adminFiles = { [adminPath]: `admins[] = {"${other}"};\n` };
  await f.instance.runtime.write(profile, state);
  const route = `/api/profiles/${profile.id}/admin`;
  assert.equal((await f.post(route, { steamId: id, role: 'admin' }, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await f.post(route, { steamId: id, role: 'admin' }, { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await f.post(route, { steamId: id, role: 'superadmin' })).status, 400);
  for (const method of ['start', 'stop', 'install', 'backup', 'restore', 'save']) f.instance.runtime[method] = async () => { throw new Error('No lifecycle mutation allowed'); };
  const granted = await f.post(route, { steamId: legacyId, role: 'admin' });
  assert.equal(granted.status, 200); assert.equal(granted.data.requiresRestart, true); assert.equal(granted.data.simulated, true);
  assert.match(granted.data.notice, /Sandbox/);
  assert.equal((await f.instance.runtime.read(profile)).adminFiles[adminPath], `admins[] = {"${other}","${id}"};\n`);
  const serialized = JSON.stringify({ events: f.instance.store.state.events, diagnostics: f.records });
  for (const value of [id, legacyId, other, privatePassword]) assert.ok(!serialized.includes(value), 'Private target or join secret reached audit/diagnostics');
  assert.equal(f.instance.store.state.job, null);
  assert.equal((await f.post(`/api/profiles/${profile.id}/console`, { command: '#login' })).status, 400, 'Arma chat commands must not be sent to a nonexistent stdin admin console');
});

test('unseeded Arma Sandbox initializes its admin fragment from the profile and preserves those initial administrators', async t => {
  const f = await fixture(t); await f.setup(); const profile = await f.create({ adminSteamIds: [other] });
  const before = await f.instance.runtime.read(profile);
  assert.equal(before.adminFiles, undefined);
  const granted = await f.post(`/api/profiles/${profile.id}/admin`, { steamId: id, role: 'admin' });
  assert.equal(granted.status, 200); assert.equal(granted.data.simulated, true);
  const after = await f.instance.runtime.read(profile);
  assert.equal(after.adminFiles[adminPath], `admins[] = {"${other}","${id}"};\n`);
  assert.equal(after.running, false); assert.equal(f.instance.store.state.job, null);
});

test('Arma runtime refuses running and unknown state before reading or writing an admin file', async () => {
  for (const running of [true, null, undefined]) {
    const runtime = new PufferRuntime({}); let reads = 0, writes = 0;
    runtime.status = async () => ({ running });
    runtime.readAdminFile = async () => { reads++; return 'admins[] = {};\n'; };
    runtime.request = async () => { writes++; };
    await assert.rejects(runtime.admin({ gameId: 'arma3' }, action()), error => error.status === 409);
    assert.equal(reads, 0); assert.equal(writes, 0);
  }
});

test('Arma runtime persists the original fragment before a second stopped check and rejects concurrent starts or unknown state', async () => {
  for (const secondState of [true, null, undefined]) {
    const runtime = new PufferRuntime({}); let statusCalls = 0; const writes = [];
    const original = `admins[] = {"${other}"};\n`;
    runtime.status = async () => ({ running: statusCalls++ === 0 ? false : secondState });
    runtime.readAdminFile = async (profile, file) => { assert.equal(file, adminPath); return original; };
    runtime.request = async (endpoint, options) => { writes.push({ endpoint, ...options }); };
    await assert.rejects(runtime.admin({ gameId: 'arma3', serverId: 'fixture' }, action()), error => error.status === 409);
    assert.equal(statusCalls, 2); assert.equal(writes.length, 1);
    assert.match(writes[0].endpoint, /\/arma\/admins\.cfg\.gameswitch-[a-f0-9-]+\.bak$/);
    assert.equal(writes[0].body, original);
  }
});

test('Arma runtime writes backup then canonical target exactly once and reports uncertainty without retry', async () => {
  for (const uncertain of [false, true]) {
    const runtime = new PufferRuntime({}); let stoppedChecks = 0; const writes = [];
    runtime.status = async () => { stoppedChecks++; return { running: false }; };
    runtime.readAdminFile = async () => 'admins[] = {};\n';
    runtime.request = async (endpoint, options) => { writes.push({ endpoint, ...options }); if (uncertain && endpoint.endsWith('/arma/admins.cfg')) throw new Error('Private gateway detail'); };
    const operation = runtime.admin({ gameId: 'arma3', serverId: 'fixture' }, action());
    if (uncertain) await assert.rejects(operation, error => error.code === 'ADMIN_WRITE_UNCERTAIN' && !error.message.includes('Private gateway'));
    else assert.deepEqual(await operation, { requiresRestart: true });
    assert.equal(stoppedChecks, 2); assert.equal(writes.length, 2);
    assert.match(writes[0].endpoint, /\.bak$/); assert.equal(writes[0].body, 'admins[] = {};\n');
    assert.ok(writes[1].endpoint.endsWith('/arma/admins.cfg'));
    assert.equal(writes[1].body, `admins[] = {"${id}"};\n`);
  }
});

test('Arma admin gateway failure diagnostic and HTTP body never expose target IDs or passwords', async t => {
  const f = await fixture(t); await f.setup(); const profile = await f.create();
  f.instance.runtime.admin = async () => { throw Object.assign(new Error(`${id} ${privatePassword}`), { status: 502 }); };
  const response = await f.post(`/api/profiles/${profile.id}/admin`, { steamId: id, role: 'admin' });
  assert.equal(response.status, 502); assert.ok(response.data.errorId);
  const serialized = JSON.stringify({ response: response.data, events: f.instance.store.state.events, diagnostics: f.records });
  for (const value of [id, privatePassword]) assert.ok(!serialized.includes(value));
  assert.equal(f.records.length, 1); assert.equal(f.instance.controller.busy, false);
});
