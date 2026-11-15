import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { readConfig } from '../server/config.mjs';
import { PufferRuntime } from '../server/runtime.mjs';
import { writeProfileSecrets } from '../server/profile-secrets.mjs';
import { listenFixture } from './http-fixture.mjs';

const steamId = 'STEAM_0:1:123456';
const steamId64 = '76561197960512641';
const otherSteamId = '76561198000000000';
const valheimPassword = 'Private_fixture_password_2026';
const factorioPassword = 'Factorio_fixture_password_2026';
const profileInput = (gameId, extra = {}) => ({
  name: `Test ${gameId}`, gameId, version: ({ terraria: '1.4.5.8', factorio: '2.1.24' })[gameId] || 'latest',
  loader: ['terraria', 'factorio', 'fs25'].includes(gameId) ? 'native' : 'steam',
  port: ({ gmod: 27015, squad: 7787, valheim: 2456, terraria: 7777, factorio: 34197, fs25: 10823 })[gameId],
  memoryMb: gameId === 'squad' ? 12288 : gameId === 'fs25' ? 8192 : 4096,
  maxPlayers: gameId === 'valheim' ? 10 : gameId === 'squad' ? 20 : 12,
  ...(gameId === 'valheim' ? { serverPassword: valheimPassword, worldName: 'Friends' } : {}),
  ...(gameId === 'factorio' ? { serverPassword: factorioPassword, worldName: 'Factory' } : {}),
  ...(gameId === 'gmod' ? { collectionId: '123456789', gamemode: 'terrortown' } : {}),
  ...extra,
});

async function fixture(t, makeRuntime) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-admin-api-'));
  const config = readConfig({ DATA_DIR: directory });
  const instance = await createApp({ config, ...(makeRuntime ? { runtime: makeRuntime(config) } : {}) });
  let server = await listenFixture(instance.app);
  // Keep the randomly chosen HTTP fixture port separate from tested game ports.
  while ([21114, 27015, 27165, 27166, 34197].includes(server.address().port)) {
    await new Promise(resolve => server.close(resolve));
    server = await listenFixture(instance.app);
  }
  config.port = server.address().port;
  config.origin = `http://127.0.0.1:${config.port}`;
  let cookie = '', csrf = '';
  const request = async (route, method = 'GET', body, headers = {}) => {
    const response = await fetch(config.origin + route, {
      method, headers: { Origin: config.origin, Cookie: cookie, 'X-CSRF-Token': csrf, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: response.status, data };
  };
  const post = (route, body = {}, headers) => request(route, 'POST', body, headers);
  const setup = () => post('/api/setup', { token: instance.bootstrapToken, username: 'admin', password: 'Admin-API-fixture-password-2026' });
  const create = async (gameId, extra = {}) => {
    const response = await post('/api/profiles', profileInput(gameId, extra));
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return instance.store.state.profiles.find(profile => profile.id === response.data.profile.id);
  };
  // Public Squad creation is blocked after the failed host readiness test.
  // Existing installed profiles still need safe secret projection and file admin tests.
  const seedSquad = async () => {
    const profile = { ...profileInput('squad'), id: randomUUID(), serverId: randomUUID().replaceAll('-', '').slice(0, 16), installed: true, status: 'stopped', createdAt: new Date().toISOString() };
    Object.assign(profile, await writeProfileSecrets(config, profile.id, { rconPassword: randomBytes(32).toString('base64url') }));
    instance.store.state.profiles.push(profile);
    await instance.store.save();
    return profile;
  };
  const prepare = async (profile, running = true, additions = {}) => {
    profile.installed = true;
    profile.status = running ? 'running' : 'stopped';
    const state = await instance.runtime.read(profile);
    await instance.runtime.write(profile, { ...state, installed: true, running, ...additions });
    await instance.store.save();
  };
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await instance.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { instance, config, directory, request, post, setup, create, seedSquad, prepare };
}

function forbidLifecycle(runtime) {
  for (const method of ['save', 'stop', 'start', 'install', 'backup', 'restore']) runtime[method] = async () => { throw new Error(`Unexpected lifecycle action: ${method}`); };
}

test('Valheim and Factorio creation and legacy Squad secret flags keep secrets out of public state and audit', async t => {
  const f = await fixture(t); await f.setup();
  const created = await f.post('/api/profiles', profileInput('valheim'));
  assert.equal(created.status, 201);
  assert.equal(created.data.profile.serverPasswordSet, true);
  const valheim = f.instance.store.state.profiles.find(profile => profile.id === created.data.profile.id);
  const valheimFile = path.join(f.directory, 'profile-secrets', `${valheim.id}.json`);
  assert.deepEqual(JSON.parse(await fs.readFile(valheimFile, 'utf8')), { serverPassword: valheimPassword });
  if (process.platform !== 'win32') assert.equal((await fs.stat(valheimFile)).mode & 0o077, 0);
  const factorioCreated = await f.post('/api/profiles', profileInput('factorio'));
  assert.equal(factorioCreated.status, 201);
  assert.equal(factorioCreated.data.profile.serverPasswordSet, true);
  const factorioFile = path.join(f.directory, 'profile-secrets', `${factorioCreated.data.profile.id}.json`);
  assert.deepEqual(JSON.parse(await fs.readFile(factorioFile, 'utf8')), { serverPassword: factorioPassword });
  const squad = await f.seedSquad();
  assert.equal(squad.rconPasswordSet, true);
  const squadFile = path.join(f.directory, 'profile-secrets', `${squad.id}.json`);
  const { rconPassword } = JSON.parse(await fs.readFile(squadFile, 'utf8'));
  assert.match(rconPassword, /^[A-Za-z0-9_-]{43}$/u);
  const publicState = await f.request('/api/state');
  assert.equal(publicState.status, 200);
  const disk = await fs.readFile(path.join(f.directory, 'state.json'), 'utf8');
  assert.equal(publicState.data.profiles.find(profile => profile.id === squad.id).rconPasswordSet, true);
  for (const output of [created.data, factorioCreated.data, publicState.data, f.instance.store.state, f.instance.store.state.events, disk]) {
    const text = typeof output === 'string' ? output : JSON.stringify(output);
    assert.ok(!text.includes(valheimPassword), 'Valheim password was exposed');
    assert.ok(!text.includes(factorioPassword), 'Factorio password was exposed');
    assert.ok(!text.includes(rconPassword), 'Squad RCON password was exposed');
  }
  for (const profile of [valheim, squad, ...publicState.data.profiles, factorioCreated.data.profile]) {
    assert.equal(Object.hasOwn(profile, 'serverPassword'), false);
    assert.equal(Object.hasOwn(profile, 'rconPassword'), false);
  }
});

test('public profile projection excludes unexpected and legacy secret fields', async t => {
  const f = await fixture(t); await f.setup();
  const profile = await f.create('gmod');
  Object.assign(profile, { serverPassword: 'legacy-fixture-secret', rconPassword: 'legacy-rcon-fixture-secret', unexpectedSecret: 'unlisted-fixture-secret' });
  const response = await f.request('/api/state');
  assert.equal(response.status, 200);
  const visible = response.data.profiles.find(item => item.id === profile.id);
  for (const key of ['serverPassword', 'rconPassword', 'unexpectedSecret']) assert.equal(Object.hasOwn(visible, key), false);
  assert.equal(visible.consoleInput, true);
  assert.equal(visible.adminKind, 'ulx');
});

test('blocked Squad and FS25 and reserved game port ranges are refused before profile creation', async t => {
  const f = await fixture(t); await f.setup();
  for (const input of [profileInput('squad'), profileInput('fs25'), profileInput('gmod', { port: 5657 }), profileInput('valheim', { port: 5656 }), profileInput('squad', { queryPort: 5656 }), profileInput('squad', { beaconPort: 5657 }), profileInput('valheim', { port: 65535 })]) {
    assert.equal((await f.post('/api/profiles', input)).status, 400);
  }
  assert.equal(f.instance.store.state.profiles.length, 0);
  await assert.rejects(fs.access(path.join(f.directory, 'profile-secrets')), error => error.code === 'ENOENT');
});

test('GMod admin endpoint requires login, Origin, CSRF and strict role/identity payloads', async t => {
  const f = await fixture(t); await f.setup();
  const profile = await f.create('gmod'); await f.prepare(profile);
  const route = `/api/profiles/${profile.id}/admin`;
  let calls = 0;
  f.instance.runtime.admin = async () => { calls++; return {}; };
  assert.equal((await f.post(route, { steamId, role: 'admin' }, { Cookie: '' })).status, 401);
  assert.equal((await f.post(route, { steamId, role: 'admin' }, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await f.post(route, { steamId, role: 'admin' }, { 'X-CSRF-Token': '' })).status, 403);
  for (const payload of [{ steamId, role: 'owner' }, { steamId: `${steamId};quit`, role: 'admin' }, { steamId: `${steamId}\nquit`, role: 'admin' }, { steamId: Number(steamId64), role: 'admin' }, { steamId, role: 'admin', command: 'quit' }, { steamId, role: 'admin', path: '../users.txt' }, { steamId }, {}]) assert.equal((await f.post(route, payload)).status, 400);
  profile.installed = false;
  assert.equal((await f.post(route, { steamId, role: 'admin' })).status, 409);
  assert.equal(calls, 0);
});

test('GMod helper canonicalizes identities and emits only native ULX commands without target arguments in audit', async t => {
  const f = await fixture(t); await f.setup();
  const profile = await f.create('gmod'); await f.prepare(profile);
  const commands = [], original = f.instance.runtime.command.bind(f.instance.runtime);
  f.instance.runtime.command = async (target, command) => { commands.push([target.id, command]); return original(target, command); };
  forbidLifecycle(f.instance.runtime);
  for (const role of ['admin', 'superadmin', 'user']) {
    const response = await f.post(`/api/profiles/${profile.id}/admin`, { steamId: steamId64, role });
    assert.equal(response.status, 200);
    assert.equal(response.data.simulated, true);
    assert.equal(response.data.requiresRestart, false);
    assert.match(response.data.notice, /Sandbox.*simuliert/u);
  }
  assert.deepEqual(commands, [[profile.id, `ulx adduserid ${steamId} admin`], [profile.id, `ulx adduserid ${steamId} superadmin`], [profile.id, `ulx removeuserid ${steamId}`]]);
  const audit = JSON.stringify(f.instance.store.state.events);
  assert.ok(audit.includes('Admin-Einstellung'));
  for (const value of [steamId, steamId64, 'ulx adduserid', 'ulx removeuserid']) assert.ok(!audit.includes(value), `Audit contains target or command: ${value}`);
  assert.equal(f.instance.store.state.job, null);
});

test('GMod helper refuses missing ULX and stopped server without dispatching commands', async t => {
  const f = await fixture(t); await f.setup();
  const profile = await f.create('gmod'); await f.prepare(profile, true, { ulxAvailable: false });
  const route = `/api/profiles/${profile.id}/admin`;
  let calls = 0;
  const command = f.instance.runtime.command.bind(f.instance.runtime);
  f.instance.runtime.command = async (...args) => { calls++; return command(...args); };
  assert.equal((await f.post(route, { steamId, role: 'admin' })).status, 409);
  assert.equal(calls, 0);
  await f.prepare(profile, false, { ulxAvailable: true });
  assert.equal((await f.post(route, { steamId, role: 'admin' })).status, 409);
  assert.equal((await f.instance.runtime.read(profile)).running, false);
  assert.equal(f.instance.store.state.job, null);
});

test('admin dispatch shares the global gate with duplicate requests, console and lifecycle actions', async t => {
  const f = await fixture(t); await f.setup();
  const profile = await f.create('gmod'); await f.prepare(profile);
  let release, entered;
  const held = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  f.instance.runtime.admin = async () => { calls++; entered(); await held; return { requiresRestart: false, simulated: true }; };
  const route = `/api/profiles/${profile.id}`;
  const pending = f.post(`${route}/admin`, { steamId, role: 'admin' });
  try {
    await ready;
    assert.equal(f.instance.controller.busy, true);
    for (const [endpoint, body] of [['admin', { steamId, role: 'superadmin' }], ['console', { command: 'status' }], ['activate', {}], ['restart', {}], ['stop', {}]]) assert.equal((await f.post(`${route}/${endpoint}`, body)).status, 409);
    assert.equal(calls, 1);
  } finally { release(); }
  assert.equal((await pending).status, 200);
  assert.equal(f.instance.controller.busy, false);
});

test('an active lifecycle job blocks admin and console requests before either can dispatch', async t => {
  const f = await fixture(t); await f.setup();
  const profile = await f.create('gmod'); await f.prepare(profile);
  const status = f.instance.runtime.status.bind(f.instance.runtime);
  let release, entered, hold = true;
  const held = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  f.instance.runtime.status = async target => { if (hold) { entered(); await held; } return status(target); };
  let commands = 0;
  f.instance.runtime.admin = async () => { commands++; return {}; };
  f.instance.runtime.command = async () => { commands++; };
  const route = `/api/profiles/${profile.id}`;
  assert.equal((await f.post(`${route}/activate`)).status, 202);
  try {
    await ready;
    assert.equal((await f.post(`${route}/admin`, { steamId, role: 'admin' })).status, 409);
    assert.equal((await f.post(`${route}/console`, { command: 'status' })).status, 409);
    assert.equal(commands, 0);
  } finally { hold = false; release(); }
  await f.instance.controller.pending;
  assert.equal(f.instance.controller.busy, false);
  assert.equal(f.instance.store.state.job.status, 'failed'); // The selected profile was already running.
  assert.equal((await f.instance.runtime.read(profile)).running, true);
});

test('admin audit persistence failures and unhealthy store prevent dispatch and release the gate', async t => {
  const f = await fixture(t); await f.setup();
  const profile = await f.create('gmod'); await f.prepare(profile);
  let calls = 0;
  f.instance.runtime.admin = async () => { calls++; return {}; };
  const originalSave = f.instance.store.save;
  f.instance.store.save = async () => { throw new Error('Synthetic persistence failure'); };
  assert.equal((await f.post(`/api/profiles/${profile.id}/admin`, { steamId, role: 'admin' })).status, 500);
  assert.equal(calls, 0);
  assert.equal(f.instance.controller.busy, false);
  f.instance.store.save = originalSave;
  f.instance.store.healthy = false;
  assert.equal((await f.post(`/api/profiles/${profile.id}/admin`, { steamId, role: 'admin' })).status, 503);
  assert.equal(calls, 0);
  f.instance.store.healthy = true;
});

test('uncertain admin command or file writes return 502 and are never automatically repeated', async t => {
  const f = await fixture(t); await f.setup();
  const profile = await f.create('gmod'); await f.prepare(profile);
  let calls = 0;
  for (const code of ['CONSOLE_DELIVERY_UNCERTAIN', 'ADMIN_WRITE_UNCERTAIN']) {
    f.instance.runtime.admin = async () => { calls++; throw Object.assign(new Error('fixture internal data must not be returned'), { code }); };
    const before = calls;
    const response = await f.post(`/api/profiles/${profile.id}/admin`, { steamId, role: 'admin' });
    assert.equal(response.status, 502);
    assert.match(response.data.error, /nicht automatisch/u);
    assert.ok(!response.data.error.includes('fixture internal data'));
    assert.equal(calls, before + 1);
    assert.equal(f.instance.controller.busy, false);
  }
});

test('stopped Valheim and Squad admin helpers preserve other rights and explicitly report simulated next-start changes', async t => {
  const f = await fixture(t); await f.setup();
  const valheim = await f.create('valheim');
  await f.prepare(valheim, false, { adminFiles: { 'saves/adminlist.txt': `// Freunde\nSteam_${otherSteamId}\nPlayFab_ABCDEF123456\n` } });
  const squad = await f.seedSquad();
  await f.prepare(squad, false, { adminFiles: { 'SquadGame/ServerConfig/Admins.cfg': `// Besitzer\nGroup=Owner:config,manageserver\nAdmin=${otherSteamId}:Owner\nAdmin=${steamId64}:Owner // Unverwaltet\n` } });
  forbidLifecycle(f.instance.runtime);
  for (const profile of [valheim, squad]) {
    const granted = await f.post(`/api/profiles/${profile.id}/admin`, { steamId, role: 'admin' });
    assert.equal(granted.status, 200);
    assert.equal(granted.data.requiresRestart, true);
    assert.equal(granted.data.simulated, true);
    assert.match(granted.data.notice, /Sandbox.*simuliert/u);
    assert.equal((await f.instance.runtime.read(profile)).running, false);
  }
  const valheimFile = (await f.instance.runtime.read(valheim)).adminFiles['saves/adminlist.txt'];
  assert.equal(valheimFile, `// Freunde\nSteam_${otherSteamId}\nPlayFab_ABCDEF123456\nSteam_${steamId64}\n`);
  const squadGranted = (await f.instance.runtime.read(squad)).adminFiles['SquadGame/ServerConfig/Admins.cfg'];
  assert.ok(squadGranted.includes(`Admin=${steamId64}:GameSwitch_Admin\n`));
  assert.ok(squadGranted.includes(`Admin=${steamId64}:Owner // Unverwaltet\n`));
  const removed = await f.post(`/api/profiles/${squad.id}/admin`, { steamId, role: 'user' });
  assert.equal(removed.status, 200);
  const squadRemoved = (await f.instance.runtime.read(squad)).adminFiles['SquadGame/ServerConfig/Admins.cfg'];
  assert.ok(!squadRemoved.includes(`Admin=${steamId64}:GameSwitch_Admin`));
  assert.ok(squadRemoved.includes(`Admin=${steamId64}:Owner // Unverwaltet\n`));
  assert.ok(squadRemoved.includes(`Admin=${otherSteamId}:Owner\n`));
  assert.equal(f.instance.store.state.job, null);
});

test('file admin helpers reject running profiles without altering the file or invoking lifecycle methods', async t => {
  const f = await fixture(t); await f.setup();
  for (const gameId of ['valheim', 'squad']) {
    const profile = gameId === 'squad' ? await f.seedSquad() : await f.create(gameId); await f.prepare(profile, true);
    const before = await f.instance.runtime.read(profile);
    assert.equal((await f.post(`/api/profiles/${profile.id}/admin`, { steamId, role: 'admin' })).status, 409);
    assert.deepEqual(await f.instance.runtime.read(profile), before);
  }
  assert.equal(f.instance.store.state.job, null);
});

test('generic console accepts supported and legacy game commands and rejects Source chaining and lifecycle commands', async t => {
  const f = await fixture(t); await f.setup();
  const profiles = {};
  for (const gameId of ['gmod', 'squad', 'terraria', 'valheim']) { profiles[gameId] = gameId === 'squad' ? await f.seedSquad() : await f.create(gameId); await f.prepare(profiles[gameId]); }
  const commands = [], original = f.instance.runtime.command.bind(f.instance.runtime);
  f.instance.runtime.command = async (profile, command) => { commands.push([profile.gameId, command]); return original(profile, command); };
  forbidLifecycle(f.instance.runtime);
  for (const [gameId, command] of [['gmod', 'status'], ['squad', 'ListPlayers'], ['terraria', 'help']]) assert.equal((await f.post(`/api/profiles/${profiles[gameId].id}/console`, { command })).status, 200);
  for (const command of ['"quit"', 'status;quit', '_restart', 'changelevel gm_construct', 'AdminKillServer', 'exit-nosave', 'status\nquit']) assert.equal((await f.post(`/api/profiles/${profiles.gmod.id}/console`, { command })).status, 400);
  assert.equal((await f.post(`/api/profiles/${profiles.gmod.id}/console`, { command: 'status', gameId: 'minecraft' })).status, 400);
  assert.equal((await f.post(`/api/profiles/${profiles.valheim.id}/console`, { command: 'help' })).status, 400);
  assert.deepEqual(commands, [['gmod', 'status'], ['squad', 'ListPlayers'], ['terraria', 'help']]);
});

test('Puffer file admin fails closed for an unconfirmed stopped state before any file write', async t => {
  const writes = [];
  const f = await fixture(t, config => {
    const runtime = new PufferRuntime(config);
    runtime.status = async () => ({ gameswitchVersion: 1, running: null });
    runtime.readAdminFile = async () => '';
    runtime.request = async (endpoint, options = {}) => { if (options.method === 'PUT') writes.push(endpoint); return null; };
    return runtime;
  });
  await f.setup();
  const profile = await f.create('valheim'); profile.installed = true;
  const response = await f.post(`/api/profiles/${profile.id}/admin`, { steamId, role: 'admin' });
  assert.equal(response.status, 409);
  assert.deepEqual(writes, []);
});

test('Puffer file admin rechecks stopped state after saving its backup and preserves target on concurrent start or unknown state', async t => {
  for (const changedState of [true, null, undefined]) await t.test(`second running state ${String(changedState)}`, async child => {
    const writes = [];
    let statusCalls = 0;
    const original = `// Unverändert\nSteam_${otherSteamId}\n`;
    const f = await fixture(child, config => {
      const runtime = new PufferRuntime(config);
      runtime.status = async () => ({ gameswitchVersion: 1, running: statusCalls++ === 0 ? false : changedState });
      runtime.readAdminFile = async () => original;
      runtime.request = async (endpoint, options = {}) => { if (options.method === 'PUT') writes.push({ endpoint, body: options.body }); return null; };
      return runtime;
    });
    await f.setup();
    const profile = await f.create('valheim'); profile.installed = true;
    const response = await f.post(`/api/profiles/${profile.id}/admin`, { steamId, role: 'admin' });
    assert.equal(response.status, 409);
    assert.equal(statusCalls, 2);
    assert.equal(writes.length, 1);
    assert.match(writes[0].endpoint, /\/saves\/adminlist\.txt\.gameswitch-[a-f0-9-]+\.bak$/u);
    assert.equal(writes[0].body, original);
    assert.equal(f.instance.controller.busy, false);
  });
});

test('Puffer file admin writes a backup first and reports next-start activation without restarting', async t => {
  const writes = [];
  const original = `// Freunde\nSteam_${otherSteamId}\n`;
  const f = await fixture(t, config => {
    const runtime = new PufferRuntime(config);
    runtime.status = async () => ({ gameswitchVersion: 1, running: false });
    runtime.readAdminFile = async () => original;
    runtime.request = async (endpoint, options = {}) => { if (options.method === 'PUT') writes.push({ endpoint, body: options.body }); return null; };
    forbidLifecycle(runtime);
    return runtime;
  });
  await f.setup();
  const profile = await f.create('valheim'); profile.installed = true;
  const response = await f.post(`/api/profiles/${profile.id}/admin`, { steamId, role: 'admin' });
  assert.equal(response.status, 200);
  assert.equal(response.data.requiresRestart, true);
  assert.match(response.data.notice, /nächsten Start/u);
  assert.equal(Object.hasOwn(response.data, 'simulated'), false);
  assert.equal(writes.length, 2);
  assert.match(writes[0].endpoint, /\.gameswitch-[a-f0-9-]+\.bak$/u);
  assert.equal(writes[0].body, original);
  assert.ok(writes[1].endpoint.endsWith('/saves/adminlist.txt'));
  assert.equal(writes[1].body, original + `Steam_${steamId64}\n`);
});

test('Puffer file admin backup failure prevents target write and malformed files fail before backup', async t => {
  let malformed = false;
  const writes = [];
  const f = await fixture(t, config => {
    const runtime = new PufferRuntime(config);
    runtime.status = async () => ({ gameswitchVersion: 1, running: false });
    runtime.readAdminFile = async () => malformed ? 'arbitrary invalid file content\n' : '';
    runtime.request = async (endpoint, options = {}) => {
      if (options.method === 'PUT') { writes.push(endpoint); throw new Error('Synthetic backup I/O failure'); }
      return null;
    };
    return runtime;
  });
  await f.setup();
  const profile = await f.create('valheim'); profile.installed = true;
  const route = `/api/profiles/${profile.id}/admin`;
  assert.equal((await f.post(route, { steamId, role: 'admin' })).status, 500);
  assert.equal(writes.length, 1);
  assert.match(writes[0], /\.bak$/u);
  malformed = true;
  assert.equal((await f.post(route, { steamId, role: 'admin' })).status, 400);
  assert.equal(writes.length, 1);
  assert.equal(f.instance.controller.busy, false);
});
