import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.mjs';
import { readConfig } from '../server/config.mjs';
import { SandboxRuntime, PufferRuntime } from '../server/runtime.mjs';
import { parseCollection, profileSchema, providers } from '../server/catalog.mjs';
import { buildDefinition, javaVersion } from '../server/templates.mjs';
import { openStore } from '../server/store.mjs';
import { Controller } from '../server/controller.mjs';

async function fixture(t, extra = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-test-'));
  const config = readConfig({ DATA_DIR: directory, PORT: '3001' });
  const instance = await createApp({ config, ...extra, ...(extra.makeRuntime ? { runtime: extra.makeRuntime(config) } : {}) });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  config.port = server.address().port;
  config.origin = `http://127.0.0.1:${config.port}`;
  let cookie = ''; let csrf = '';
  const request = async (url, method = 'GET', body, headers = {}) => {
    const response = await fetch(`${config.origin}${url}`, { method, headers: { Origin: config.origin, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const payload = await response.json();
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (payload.csrfToken) csrf = payload.csrfToken;
    return { status: response.status, payload, headers: response.headers };
  };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await instance.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const setup = () => request('/api/setup', 'POST', { token: instance.bootstrapToken, username: 'admin', password: 'A-long-test-only-password-2026' });
  return { instance, config, request, setup, directory };
}

const profile = (name = 'Minecraft Freunde') => ({ name, gameId: 'minecraft', version: '1.21.4', loader: 'paper', maxPlayers: 12, memoryMb: 6144, port: 25565, eulaAccepted: true });

test('bootstrap authentication, cookie flags, cross-origin/CSRF and secret isolation', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/state')).status, 401);
  assert.equal((await f.request('/api/setup', 'POST', { token: 'wrong', username: 'admin', password: 'A-long-test-password' })).status, 403);
  const setup = await f.setup();
  assert.equal(setup.status, 201);
  assert.match(setup.headers.get('set-cookie'), /HttpOnly/);
  assert.match(setup.headers.get('set-cookie'), /SameSite=Strict/);
  assert.equal((await f.request('/api/profiles', 'POST', profile(), { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await f.request('/api/profiles', 'POST', profile(), { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.setup()).status, 409);
  const state = await f.request('/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.headers.get('cache-control'), 'no-store');
  assert.ok(state.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  assert.ok(!JSON.stringify(state.payload).includes('passwordHash'));
  await f.request('/api/logout', 'POST');
  assert.equal((await f.request('/api/state')).status, 401);
  assert.equal((await f.request('/api/login', 'POST', { username: 'admin', password: 'incorrect' })).status, 401);
  assert.equal((await f.request('/api/login', 'POST', { username: 'admin', password: 'A-long-test-only-password-2026' })).status, 200);
});

test('strict profile validation rejects shell/URL input, reserved ports and unsafe memory', async t => {
  const f = await fixture(t); await f.setup();
  for (const bad of [{ ...profile(), version: '1.21;id' }, { ...profile(), arbitraryCommand: 'id' }, { ...profile(), port: 8080 }, { ...profile(), memoryMb: 15000 }, { ...profile(), eulaAccepted: false }]) assert.equal((await f.request('/api/profiles', 'POST', bad)).status, 400);
  assert.equal((await f.request('/api/profiles', 'POST', profile())).status, 201);
  assert.equal(profileSchema.safeParse({ ...profile(), name: 'name\nlog forgery' }).success, false);
  assert.equal(parseCollection('https://steamcommunity.com/sharedfiles/filedetails/?id=123456789'), '123456789');
  assert.throws(() => parseCollection('http://127.0.0.1/private'));
  assert.throws(() => parseCollection('https://steamcommunity.com.evil.test/sharedfiles/filedetails/?id=123456789'));
});

test('profile switch is serialized and saves, stops, backs up before next start', async t => {
  const calls = [];
  const f = await fixture(t, { makeRuntime: config => {
    const runtime = new SandboxRuntime(config);
    for (const method of ['save', 'stop', 'backup', 'install', 'start']) {
      const original = runtime[method].bind(runtime);
      runtime[method] = async (...args) => { calls.push(`${method}:${args[0].name}`); return original(...args); };
    }
    return runtime;
  } });
  await f.setup();
  const first = (await f.request('/api/profiles', 'POST', profile('Welt eins'))).payload.profile;
  const second = (await f.request('/api/profiles', 'POST', profile('Welt zwei'))).payload.profile;
  assert.equal((await f.request(`/api/profiles/${first.id}/activate`, 'POST')).status, 202);
  assert.equal((await f.request(`/api/profiles/${second.id}/activate`, 'POST')).status, 409);
  await f.instance.controller.pending;
  assert.equal(f.instance.store.state.job.status, 'completed');
  calls.length = 0;
  await f.request(`/api/profiles/${second.id}/activate`, 'POST');
  await f.instance.controller.pending;
  assert.deepEqual(calls, ['save:Welt eins', 'stop:Welt eins', 'backup:Welt eins', 'install:Welt zwei', 'start:Welt zwei']);
  const state = (await f.request('/api/state')).payload;
  assert.equal(state.activeProfileId, second.id);
  assert.equal(state.backups.length, 1);
  assert.equal(state.profiles.filter(p => p.status === 'running').length, 1);
  const persisted = JSON.parse(await fs.readFile(path.join(f.directory, 'state.json'), 'utf8'));
  assert.equal(persisted.activeProfileId, second.id);
  assert.equal(persisted.backups[0].profileId, first.id);
});

test('backup failure leaves old profile stopped and never starts the target', async t => {
  let failBackup = false;
  const f = await fixture(t, { makeRuntime: config => {
    const runtime = new SandboxRuntime(config);
    const backup = runtime.backup.bind(runtime);
    runtime.backup = async (...args) => { if (failBackup) throw new Error('Disk full'); return backup(...args); };
    return runtime;
  } });
  await f.setup();
  const first = (await f.request('/api/profiles', 'POST', profile('Sicherer Altstand'))).payload.profile;
  const second = (await f.request('/api/profiles', 'POST', profile('Neuer Server'))).payload.profile;
  await f.request(`/api/profiles/${first.id}/activate`, 'POST'); await f.instance.controller.pending;
  failBackup = true;
  await f.request(`/api/profiles/${second.id}/activate`, 'POST'); await f.instance.controller.pending;
  assert.equal(f.instance.store.state.job.status, 'failed');
  assert.equal(f.instance.store.state.activeProfileId, null);
  assert.equal((await f.instance.runtime.status(second)).running, false);
  assert.equal((await f.instance.runtime.status(first)).running, false);
  assert.equal(f.instance.store.state.backups.length, 0);
  assert.equal(f.instance.store.state.pendingSafetyBackupProfileId, first.id);
  await f.request(`/api/profiles/${second.id}/activate`, 'POST'); await f.instance.controller.pending;
  assert.equal(f.instance.store.state.job.status, 'failed');
  assert.equal((await f.instance.runtime.status(second)).running, false);
  assert.equal(f.instance.store.state.pendingSafetyBackupProfileId, first.id);
  const persisted = JSON.parse(await fs.readFile(path.join(f.directory, 'state.json'), 'utf8'));
  assert.equal(persisted.pendingSafetyBackupProfileId, first.id);
  failBackup = false;
  await f.request(`/api/profiles/${second.id}/activate`, 'POST'); await f.instance.controller.pending;
  assert.equal(f.instance.store.state.job.status, 'completed');
  assert.equal(f.instance.store.state.pendingSafetyBackupProfileId, null);
});

test('restore requires stopped server and makes a recovery snapshot', async t => {
  const f = await fixture(t); await f.setup();
  const p = (await f.request('/api/profiles', 'POST', profile())).payload.profile;
  await f.request(`/api/profiles/${p.id}/activate`, 'POST'); await f.instance.controller.pending;
  await f.request(`/api/profiles/${p.id}/backup`, 'POST'); await f.instance.controller.pending;
  assert.equal(f.instance.store.state.job.status, 'failed');
  await f.request(`/api/profiles/${p.id}/stop`, 'POST'); await f.instance.controller.pending;
  await f.request(`/api/profiles/${p.id}/backup`, 'POST'); await f.instance.controller.pending;
  const b = f.instance.store.state.backups[0];
  await f.request(`/api/backups/${b.id}/restore`, 'POST'); await f.instance.controller.pending;
  assert.equal(f.instance.store.state.job.status, 'completed');
  assert.equal(f.instance.store.state.backups.length, 2);
  assert.equal((await f.instance.runtime.status(p)).running, false);
});

test('interrupted lifecycle state survives restart and incomplete restore blocks activation', async t => {
  const f = await fixture(t); await f.setup();
  const p = (await f.request('/api/profiles', 'POST', profile())).payload.profile;
  await f.request(`/api/profiles/${p.id}/activate`, 'POST'); await f.instance.controller.pending;
  await f.request(`/api/profiles/${p.id}/stop`, 'POST'); await f.instance.controller.pending;
  await f.request(`/api/profiles/${p.id}/backup`, 'POST'); await f.instance.controller.pending;
  const original = f.instance.store.state.backups[0];
  const restore = f.instance.runtime.restore.bind(f.instance.runtime);
  f.instance.runtime.restore = async () => { throw new Error('Extraction interrupted'); };
  await f.request(`/api/backups/${original.id}/restore`, 'POST'); await f.instance.controller.pending;
  assert.ok(f.instance.store.state.recoveryRequiredProfileIds.includes(p.id));
  const resumed = await createApp({ config: f.config, runtime: f.instance.runtime });
  assert.equal(resumed.bootstrapToken, null);
  resumed.controller.begin('activate', p.id); await resumed.controller.pending;
  assert.equal(resumed.store.state.job.status, 'failed');
  assert.equal((await resumed.runtime.status(p)).running, false);
  resumed.runtime.restore = restore;
  resumed.controller.begin('restore', p.id, original.id); await resumed.controller.pending;
  assert.equal(resumed.store.state.job.status, 'completed');
  assert.equal(resumed.store.state.recoveryRequiredProfileIds.length, 0);
  await resumed.close();
});

test('Puffer adapter requires patched status, uses durable wait and rejects unsuccessful backup', async () => {
  const calls = [];
  let patched = true; let backupSuccess = true;
  const config = readConfig({ RUNTIME_MODE: 'pufferpanel', PUFFERPANEL_CLIENT_ID: 'test-id', PUFFERPANEL_CLIENT_SECRET: 'never-exposed', PUFFERPANEL_URL: 'http://127.0.0.1:8080' });
  const fake = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'hidden-token', expires_in: 3600 });
    if (url.includes('/status')) return Response.json({ gameswitchVersion: patched ? 1 : undefined, running: false, backup: { state: backupSuccess ? 'succeeded' : 'failed', fileName: 'snapshot.tar.gz' } });
    if (url.includes('/backup/create')) return new Response(null, { status: 204 });
    if (url.endsWith('/backup')) return Response.json([{ id: 17, name: 'fixed-name', fileName: 'snapshot.tar.gz' }]);
    if (url.includes('/stop')) return new Response(null, { status: 204 });
    return Response.json({});
  };
  const runtime = new PufferRuntime(config, fake);
  const p = { id: 'local-id', serverId: 'runtime-id', installed: true };
  assert.equal((await runtime.backup(p, 'fixed-name')).runtimeId, '17');
  assert.ok(calls.some(call => call.url.includes('/backup/create?name=fixed-name&wait=true')));
  await runtime.stop(p);
  assert.ok(calls.some(call => call.url.includes('/stop?wait=true&skipRestart=true')));
  backupSuccess = false;
  await assert.rejects(runtime.backup(p, 'fixed-name'), /nicht erfolgreich/);
  patched = false;
  await assert.rejects(runtime.status(p), /Sicherheitspatch/);
  assert.equal(calls[0].options.redirect, 'error');
});

test('trusted definitions choose Java, Docker isolation and preserve server.properties', () => {
  const config = readConfig({});
  assert.equal(javaVersion('1.16.5'), 8); assert.equal(javaVersion('1.20.1'), 17); assert.equal(javaVersion('1.21.4'), 21); assert.equal(javaVersion('26.1'), 25);
  const definition = buildDefinition(profile(), config);
  assert.equal(definition.environment.networkName, 'bridge');
  assert.deepEqual(definition.environment.hostConfig.CapDrop, ['ALL']);
  assert.deepEqual(definition.environment.hostConfig.SecurityOpt, ['no-new-privileges:true']);
  assert.equal(definition.environment.hostConfig.Privileged, false);
  assert.equal(definition.run.autorestart, false);
  const properties = definition.install.find(step => step.target === 'server.properties');
  assert.ok(properties.if.includes('!file_exists'));
  assert.ok(properties.text.includes('online-mode=true'));
  assert.ok(!definition.run.pre.some(step => step.target === 'server.properties'));
});

test('production refuses insecure/public dev configuration and catalog rejects URL as project', async () => {
  assert.throws(() => readConfig({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'http://example.test' }), /HTTPS/);
  assert.throws(() => readConfig({ HOST: '0.0.0.0' }), /loopback/);
  assert.throws(() => readConfig({ PUBLIC_ORIGIN: 'ftp://example.test' }), /HTTP/);
  assert.throws(() => readConfig({ RUNTIME_MODE: 'pufferpanel', PUFFERPANEL_URL: 'http://example.test', PUFFERPANEL_CLIENT_ID: 'x', PUFFERPANEL_CLIENT_SECRET: 'x' }), /HTTPS/);
  let fetched = false;
  await assert.rejects(providers(async () => { fetched = true; }).versions('https://127.0.0.1/secret'));
  assert.equal(fetched, false);
});

test('failed durable state write locks future lifecycle mutations', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-disk-failure-'));
  const store = await openStore(directory);
  await fs.rm(directory, { recursive: true, force: true });
  await assert.rejects(store.save());
  assert.equal(store.healthy, false);
  const controller = new Controller(store, { start: () => { throw new Error('Must never run'); } });
  assert.throws(() => controller.begin('activate', 'any'), /Persistenzfehler/);
});

const ftbPack = () => ({
  status: 'success', id: 135, name: 'FTB Evolution 2', private: false,
  versions: [
    { id: 100614, name: '1.9.0', type: 'release', private: false, released: 200, specs: { minimum: 6144, recommended: 8192 }, targets: [{ name: 'minecraft', type: 'game', version: '26.1.2' }, { name: 'java', type: 'runtime', version: '25.0.2+10-LTS' }, { name: 'neoforge', type: 'modloader', version: '26.1.2.126' }] },
    { id: 100613, name: 'hidden', type: 'release', private: true, released: 300, targets: [] },
    { id: 100612, name: 'archived', type: 'archived', private: false, released: 100, targets: [] },
  ],
});

test('official FTB provider normalizes targets, excludes hidden releases and rejects unsafe IDs', async () => {
  const urls = [];
  const provider = providers(async url => {
    urls.push(String(url));
    if (String(url).includes('/search/')) return Response.json({ status: 'success', packs: [{ id: 135, name: 'FTB Evolution 2', synopsis: 'FTB pack', provider: 'ftb' }, { id: 999, name: 'Other provider', provider: 'curseforge' }] });
    return Response.json(ftbPack());
  });
  assert.deepEqual((await provider.ftbSearch('Evolution')).hits.map(pack => pack.id), ['135']);
  const result = await provider.ftbVersions('135');
  assert.equal(result.pack.name, 'FTB Evolution 2');
  assert.equal(result.versions.length, 1);
  const selected = await provider.ftbVersion('135', '100614');
  assert.deepEqual(selected.gameVersions, ['26.1.2']);
  assert.deepEqual(selected.loaders, ['neoforge']);
  assert.equal(selected.javaVersion, 25);
  assert.equal(selected.minimumMemoryMb, 6144);
  assert.equal(selected.recommendedMemoryMb, 8192);
  const before = urls.length;
  await assert.rejects(provider.ftbVersions('https://evil.test/pack'));
  await assert.rejects(provider.ftbVersion('135', '../../private'));
  assert.equal(urls.length, before);
  assert.ok(urls.every(url => new URL(url).origin === 'https://api.feed-the-beast.com'));
  await assert.rejects(provider.ftbVersion('135', '100613'), /nicht öffentlich/);
  await assert.rejects(providers(async () => Response.json({ status: 'error' })).ftbVersions('135'), /nicht gefunden/);
});

test('FTB profiles pin exact IDs and validate version, Java metadata and heap reserve', async t => {
  const provider = providers(async url => String(url).includes('/search/') ? Response.json({ status: 'success', packs: [{ id: 135, name: 'FTB Evolution 2', provider: 'ftb' }] }) : Response.json(ftbPack()));
  const f = await fixture(t, { providers: provider }); await f.setup();
  assert.equal((await f.request('/api/catalog/ftb?q=Evolution')).payload.hits[0].id, '135');
  assert.equal((await f.request('/api/catalog/ftb/135/versions')).payload.versions[0].id, '100614');
  const ftb = { ...profile('FTB Evolution 2'), loader: 'ftb', version: '26.1.2', modpackId: '135', modpackVersion: '100614', memoryMb: 10240 };
  for (const invalid of [{ ...ftb, version: '1.21.4' }, { ...ftb, memoryMb: 6144 }, { ...ftb, modpackId: 'url-not-numeric' }, { ...ftb, modpackVersion: '100613' }, { ...ftb, javaVersion: 8 }]) assert.equal((await f.request('/api/profiles', 'POST', invalid)).status, 400);
  const created = await f.request('/api/profiles', 'POST', ftb);
  assert.equal(created.status, 201);
  assert.equal(created.payload.profile.modpackName, 'FTB Evolution 2');
  assert.equal(created.payload.profile.modpackVersionName, '1.9.0');
  assert.equal(created.payload.profile.javaVersion, 25);
  const definition = buildDefinition(created.payload.profile, f.config);
  assert.equal(definition.environment.image, 'itzg/minecraft-server:java25');
  assert.equal(definition.run.command, '/start');
  assert.equal(definition.run.environmentVars.TYPE, 'FTBA');
  assert.equal(definition.run.environmentVars.FTB_MODPACK_ID, '135');
  assert.equal(definition.run.environmentVars.FTB_MODPACK_VERSION_ID, '100614');
  assert.equal(definition.run.environmentVars.FTB_BASE_URL, 'https://api.feed-the-beast.com/v1/modpacks');
  assert.equal(definition.run.environmentVars.MEMORY, '9472M');
  assert.equal(definition.run.environmentVars.VERSION, undefined);
  assert.equal(definition.run.autorestart, false);
});

test('Garry’s Mod TTT uses only the validated terrortown identifier with Workshop collection', async t => {
  const f = await fixture(t); await f.setup();
  const ttt = { name: 'TTT mit Freunden', gameId: 'gmod', loader: 'steam', version: 'latest', gamemode: 'terrortown', collectionId: '123456789', map: 'ttt_minecraft_b5', port: 27015, memoryMb: 4096, maxPlayers: 12 };
  assert.equal((await f.request('/api/profiles', 'POST', { ...ttt, gamemode: 'terrortown;rm' })).status, 400);
  assert.equal((await f.request('/api/profiles', 'POST', { ...profile(), gamemode: 'terrortown' })).status, 400);
  const created = await f.request('/api/profiles', 'POST', ttt);
  assert.equal(created.status, 201);
  const definition = buildDefinition(created.payload.profile, f.config);
  assert.equal(definition.data.gamemode.value, 'terrortown');
  assert.equal(definition.data.wscollection.value, '123456789');
  assert.equal(definition.data.mapname.value, 'ttt_minecraft_b5');
  assert.match(definition.run.command, /\+gamemode \$\{gamemode\}/);
  const sandbox = await f.request('/api/profiles', 'POST', { ...ttt, gamemode: undefined });
  assert.equal(sandbox.payload.profile.gamemode, 'sandbox');
});
