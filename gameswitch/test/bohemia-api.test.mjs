import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { readConfig } from '../server/config.mjs';
import { createDiagnostics } from '../server/diagnostics.mjs';
import { PufferRuntime } from '../server/runtime.mjs';
import { gamePorts, validateGamePorts } from '../server/game-ports.mjs';
import { listenFixture } from './http-fixture.mjs';

const password = 'Private_Bohemia_fixture_2026';
const steamId = '76561197960512641';
const missions = ['MP_COOP_m01.Stratis', 'MP_COOP_m03.Altis', 'MP_ZGM_m11.Altis', 'MP_ZGM_m12.Stratis', 'MP_CombatPatrol_01.Altis'];
const profileInput = (gameId, patch = {}) => ({
  name: `${gameId} friends`, gameId, version: 'latest', loader: 'steam',
  port: 2302, memoryMb: gameId === 'dayz' ? 8192 : 6144, maxPlayers: gameId === 'dayz' ? 20 : 10,
  serverPassword: password,
  mission: gameId === 'dayz' ? 'dayzOffline.chernarusplus' : missions[0],
  workshopIds: ['450814997'],
  ...(gameId === 'arma3' ? { adminSteamIds: [steamId] } : { queryPort: 27016 }),
  ...patch,
});

async function fixture(t, { puffer = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-bohemia-api-'));
  const config = readConfig({
    DATA_DIR: directory, GAME_LIBRARY_DIR: path.join(directory, 'unprepared-libraries'), HOST_MEMORY_MB: '24576',
    ...(puffer ? { RUNTIME_MODE: 'pufferpanel', PUFFERPANEL_URL: 'http://127.0.0.1:8080', PUFFERPANEL_CLIENT_ID: 'fixture', PUFFERPANEL_CLIENT_SECRET: 'fixture-private-oauth' } : {}),
  });
  const records = [];
  let runtime;
  const lifecycleCalls = [];
  const sourceId = randomUUID();
  if (puffer) {
    runtime = new PufferRuntime(config, async () => { throw new Error('No upstream HTTP request is permitted in this fixture'); });
    runtime.status = async profile => ({ running: profile.id === sourceId, gameswitchVersion: 1 });
    for (const action of ['save', 'stop', 'backup', 'install', 'start']) runtime[action] = async () => { lifecycleCalls.push(action); };
  }
  const instance = await createApp({ config, ...(runtime ? { runtime } : {}), diagnostics: createDiagnostics({ write: line => records.push(JSON.parse(line)) }) });
  if (puffer) instance.store.state.profiles.push({ id: sourceId, serverId: '1234567890abcdef', gameId: 'minecraft', name: 'Current Minecraft', installed: true, status: 'running', memoryMb: 12288, port: 25565, loader: 'ftb', version: '26.1.2' });
  let server = await listenFixture(instance.app);
  while ([2302, 2303, 2304, 2305, 2306, 27016, 34197].includes(server.address().port)) {
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
  const setup = async () => {
    const response = await post('/api/setup', { token: instance.bootstrapToken, username: 'admin', password: 'Bohemia-API-fixture-login-2026' });
    assert.equal(response.status, 201);
  };
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await instance.close();
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('gameswitch-bohemia-api-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, instance, config, post, request, setup, records, lifecycleCalls, sourceId };
}

test('Arma and DayZ profile creation inherits login, Origin and CSRF protection', async t => {
  const f = await fixture(t);
  for (const game of ['arma3', 'dayz']) assert.equal((await f.post('/api/profiles', profileInput(game))).status, 401);
  await f.setup();
  for (const game of ['arma3', 'dayz']) {
    assert.equal((await f.post('/api/profiles', profileInput(game), { Origin: 'https://outside.invalid' })).status, 403);
    assert.equal((await f.post('/api/profiles', profileInput(game), { 'X-CSRF-Token': '' })).status, 403);
  }
  assert.equal(f.instance.store.state.profiles.length, 0);
});

test('Arma and DayZ retain selected missions and mods while keeping game passwords private', async t => {
  const f = await fixture(t); await f.setup();
  for (const game of ['arma3', 'dayz']) {
    const created = await f.post('/api/profiles', profileInput(game));
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.profile.mission, profileInput(game).mission);
    assert.deepEqual(created.data.profile.workshopIds, ['450814997']);
    assert.equal(created.data.profile.consoleInput, false);
    assert.equal(created.data.profile.adminKind, game);
    assert.equal(created.data.profile.serverPasswordSet, true);
    assert.equal(created.data.profile.serverPassword, undefined);
    if (game === 'arma3') assert.deepEqual(created.data.profile.adminSteamIds, [steamId]);
    const secretFile = path.join(f.directory, 'profile-secrets', `${created.data.profile.id}.json`);
    assert.equal(JSON.parse(await fs.readFile(secretFile, 'utf8')).serverPassword, password);
  }
  const state = await f.request('/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.data.runtimeSetup.arma3.ready, true);
  assert.equal(state.data.runtimeSetup.dayz.ready, true);
  assert.equal(state.data.runtimeSetup.arma3.simulated, true);
  for (const data of [state.data, f.instance.store.state, f.records, await fs.readFile(path.join(f.directory, 'state.json'), 'utf8')]) assert.ok(!JSON.stringify(data).includes(password));
});

test('Arma accepts only verified mission names and valid individual Steam account identifiers', async t => {
  const f = await fixture(t); await f.setup();
  for (const mission of missions) {
    const response = await f.post('/api/profiles', profileInput('arma3', { mission }));
    assert.equal(response.status, 201, JSON.stringify(response.data));
  }
  const before = f.instance.store.state.profiles.length;
  for (const patch of [
    { mission: '../outside.Altis' }, { mission: 'MP_COOP_m01.Stratis;exec' }, { mission: 'UnknownMission.Altis' },
    { mission: 'MP_COOP_m01.Stratis\nexec' }, { mission: 'dayzOffline.chernarusplus' },
    { adminSteamIds: ['76561197960265728'] }, { adminSteamIds: ['99999999999999999'] },
    { adminSteamIds: ['a'.repeat(17)] }, { adminSteamIds: ['$(touch private)'] }, { adminSteamIds: [76561197960512640] },
    { adminSteamIds: [steamId, steamId] }, { adminSteamIds: Array.from({ length: 21 }, (_, i) => String(76561197960265729n + BigInt(i))) },
  ]) {
    const response = await f.post('/api/profiles', profileInput('arma3', patch));
    assert.equal(response.status, 400, JSON.stringify({ patch, response }));
  }
  assert.equal(f.instance.store.state.profiles.length, before);
});

test('both games reject Workshop injection, duplicates, excessive lists and cross-game configuration', async t => {
  const f = await fixture(t); await f.setup();
  for (const game of ['arma3', 'dayz']) {
    for (const patch of [
      { workshopIds: ['../123456'] }, { workshopIds: ['123456;quit'] }, { workshopIds: ['123456\nexit'] },
      { workshopIds: ['https://steamcommunity.com/sharedfiles/filedetails/?id=123456789'] },
      { workshopIds: ['0123456'] }, { workshopIds: [123456789] }, { workshopIds: ['123456', '123456'] },
      { workshopIds: Array.from({ length: 31 }, (_, i) => String(123456 + i)) },
      { collectionId: '123456789' }, { worldName: 'world' }, { gamemode: 'sandbox' }, { map: 'map' },
      { beaconPort: 15000 }, { serverPassword: undefined }, { serverPassword: 'secret!notallowed' },
      { steamPassword: 'must-never-enter-profile' }, { command: 'arbitrary' }, { version: 'development' }, { loader: 'native' },
    ]) {
      const response = await f.post('/api/profiles', profileInput(game, patch));
      assert.equal(response.status, 400, JSON.stringify({ game, patch, response }));
    }
  }
  assert.equal((await f.post('/api/profiles', profileInput('dayz', { mission: 'dayzOffline.enoch' }))).status, 400);
  assert.equal((await f.post('/api/profiles', profileInput('dayz', { adminSteamIds: [steamId] }))).status, 400);
  const gmod = { name: 'Existing GMod', gameId: 'gmod', version: 'latest', loader: 'steam', memoryMb: 4096, port: 27015, maxPlayers: 12 };
  for (const field of [{ mission: missions[0] }, { workshopIds: [] }, { adminSteamIds: [] }]) assert.equal((await f.post('/api/profiles', { ...gmod, ...field })).status, 400);
  assert.equal(f.instance.store.state.profiles.length, 0);
});

test('derived Arma and DayZ UDP ranges reject administrative overlap, overflow and query collisions', async t => {
  assert.deepEqual(gamePorts(profileInput('arma3')).map(({ port, protocol }) => [port, protocol]), [2302, 2303, 2304, 2305, 2306].map(port => [port, 'udp']));
  assert.deepEqual(gamePorts(profileInput('dayz')).map(({ port, protocol }) => [port, protocol]), [[2302, 'udp'], [2303, 'udp'], [2304, 'udp'], [27016, 'udp']]);
  for (const profile of [profileInput('arma3', { port: 65533 }), profileInput('arma3', { port: 5654 }), profileInput('dayz', { port: 65534 }), profileInput('dayz', { queryPort: 2303 }), profileInput('dayz', { queryPort: 2304 }), profileInput('dayz', { queryPort: 8080 })]) assert.throws(() => validateGamePorts(profile), error => error.status === 400);
  const f = await fixture(t); await f.setup();
  for (const input of [profileInput('arma3', { port: 65533 }), profileInput('arma3', { port: 5654 }), profileInput('dayz', { queryPort: 2303 }), profileInput('dayz', { queryPort: 5657 })]) assert.equal((await f.post('/api/profiles', input)).status, 400);
  assert.equal(f.instance.store.state.profiles.length, 0);
});

test('Arma and DayZ readonly consoles reject direct commands and DayZ has no false native Steam admin action', async t => {
  const f = await fixture(t); await f.setup();
  const commands = [];
  f.instance.runtime.command = async (...args) => { commands.push(args); };
  for (const game of ['arma3', 'dayz']) {
    const created = await f.post('/api/profiles', profileInput(game));
    assert.equal(created.status, 201);
    const profile = f.instance.store.state.profiles.find(p => p.id === created.data.profile.id);
    profile.installed = true;
    await f.instance.runtime.write(profile, { running: true, installed: true, lines: ['Fixture output only'] });
    for (const command of ['help', '#login', '#shutdown']) {
      const response = await f.post(`/api/profiles/${profile.id}/console`, { command });
      assert.equal(response.status, 400, JSON.stringify({ game, command, response }));
    }
    const logs = await f.request(`/api/profiles/${profile.id}/console`);
    assert.equal(logs.status, 200);
    assert.ok(logs.data.lines.includes('Fixture output only'));
    if (game === 'dayz') assert.equal((await f.post(`/api/profiles/${profile.id}/admin`, { steamId, role: 'admin' })).status, 400);
  }
  assert.deepEqual(commands, []);
});

test('an unprepared Steam library blocks activation before saving or stopping the current Minecraft server', async t => {
  const f = await fixture(t, { puffer: true }); await f.setup();
  for (const game of ['arma3', 'dayz']) {
    const created = await f.post('/api/profiles', profileInput(game));
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const activation = await f.post(`/api/profiles/${created.data.profile.id}/activate`);
    assert.equal(activation.status, 202);
    await f.instance.controller.pending;
    assert.equal(f.instance.store.state.job.status, 'failed');
    assert.equal(f.instance.store.state.job.errorId, f.instance.store.state.job.requestId);
    assert.deepEqual(f.lifecycleCalls, []);
    assert.equal(f.instance.store.state.activeProfileId, f.sourceId);
    assert.deepEqual(f.instance.store.state.pendingSafetyBackupProfileIds, []);
    assert.equal(f.instance.store.state.profiles.find(p => p.id === f.sourceId).status, 'running');
  }
  assert.equal(f.records.length, 2);
  assert.ok(f.records.every(record => record.reason === 'steam_library_required'));
  assert.ok(!JSON.stringify(f.records).includes(password));
});
