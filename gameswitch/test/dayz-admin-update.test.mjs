import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { readConfig } from '../server/config.mjs';
import { PufferRuntime } from '../server/runtime.mjs';
import { Controller } from '../server/controller.mjs';
import { openStore } from '../server/store.mjs';
import { buildDefinition } from '../server/templates.mjs';
import { buildAdminAction, mergeAdminFile } from '../server/game-admin.mjs';
import { gameLibraryStatus } from '../server/game-library.mjs';
import { writeProfileSecrets } from '../server/profile-secrets.mjs';
import { createDiagnostics } from '../server/diagnostics.mjs';
import {
  buildDayzDefinition, dayzServerConfig, dayzSettings, mergeVppSuperAdmins, withDayzAdminPassword,
  DAYZ_MODS, DAYZ_RUNTIME_IMAGE, VPP_CREDENTIALS_FILE, VPP_SUPERADMINS_FILE,
} from '../server/dayz.mjs';
import { listenFixture } from './http-fixture.mjs';

const CF = DAYZ_MODS.cf, VPP = DAYZ_MODS.vpp, COT = DAYZ_MODS.cot;
const admin = '76561197960512641';
const other = '76561198000000001';
const joinPassword = 'DayZ_Join_Fixture_2026';
const adminPassword = 'DayZ_Admin_Fixture_1';
const profile = patch => ({ gameId: 'dayz', loader: 'steam', version: 'latest', name: 'Freunde', port: 2302, queryPort: 27016, maxPlayers: 20, memoryMb: 8192, ...patch });
const environment = () => ({ type: 'docker', image: DAYZ_RUNTIME_IMAGE, config: { User: '1000:1000' }, hostConfig: { CapDrop: ['ALL'], Binds: [] } });
const config = (secrets = { serverPassword: joinPassword, adminPassword }) => ({ nodeId: 0, gameUid: 1000, gameGid: 1000, profileSecrets: secrets });
const definition = (patch = {}, secrets) => buildDayzDefinition(profile(patch), config(secrets), 'GameSwitch-fixture', environment());
const invalid = callback => assert.throws(callback, error => error.status === 400);

test('DayZ runs in the locally built runtime image and the install step names missing native libraries', () => {
  const value = buildDefinition(profile(), { ...readConfig({}), nodeId: 0, gameUid: 1000, gameGid: 1000, profileSecrets: { serverPassword: joinPassword } });
  assert.equal(value.environment.image, 'gameswitch.invalid/dayz-runtime:1');
  const commands = value.install.flatMap(step => step.commands || []).join('\n');
  assert.match(commands, /ldd \/pufferpanel\/DayZServer/);
  assert.match(commands, /DayZ runtime libraries missing/);
  // Puffer expands ${...} tokens in commands; the shell part must never use them.
  assert.ok(!/\$\{/.test(commands));
});

test('DayZ install doubles as update: mods and keys are rebuilt while world, profiles and config stay', () => {
  const value = definition({ workshopIds: [CF, VPP], adminSteamIds: [admin] });
  const copy = value.install.find(step => step.type === 'command').commands[0];
  const removal = copy.indexOf('rm -rf /pufferpanel/mods /pufferpanel/keys');
  assert.ok(removal > 0);
  assert.ok(copy.indexOf('test ! -L /pufferpanel/mods') < removal, 'links are rejected before removal');
  assert.ok(removal < copy.indexOf('cp -a --no-preserve=ownership /gameswitch-library/server/. /pufferpanel/'));
  assert.ok(copy.indexOf(`/gameswitch-library/mods/${VPP}/. /pufferpanel/mods/${VPP}/`) > removal);
  for (const kept of ['/pufferpanel/profiles', 'storage_', 'serverDZ.cfg', '/pufferpanel/gameswitch-dayz ']) assert.ok(!copy.includes(`rm -rf ${kept}`), kept);
  assert.equal(value.install.find(step => step.target === 'gameswitch-dayz/serverDZ.cfg').if, '!file_exists("gameswitch-dayz/serverDZ.cfg")');
});

test('DayZ admin password reaches passwordAdmin and VPP files only through private writefile steps', () => {
  const value = definition({ workshopIds: [CF, VPP], adminSteamIds: [admin, other] });
  assert.ok(dayzServerConfig(profile(), { serverPassword: joinPassword, adminPassword }).includes(`passwordAdmin = "${adminPassword}";`));
  assert.ok(dayzServerConfig(profile(), { serverPassword: joinPassword }).includes('passwordAdmin = "";'));
  invalid(() => dayzServerConfig(profile(), { serverPassword: joinPassword, adminPassword: 'short' }));
  invalid(() => dayzServerConfig(profile(), { serverPassword: joinPassword, adminPassword: 'a'.repeat(33) }));
  invalid(() => dayzServerConfig(profile(), { serverPassword: joinPassword, adminPassword: 'bad";x' }));
  const admins = value.install.find(step => step.target === VPP_SUPERADMINS_FILE);
  assert.equal(admins.text, `${admin}\n${other}\n`);
  assert.equal(admins.if, `!file_exists("${VPP_SUPERADMINS_FILE}")`);
  const credentials = value.install.find(step => step.target === VPP_CREDENTIALS_FILE);
  assert.equal(credentials.text, `${adminPassword}\n`);
  assert.equal(credentials.if, `!file_exists("${VPP_CREDENTIALS_FILE}")`);
  assert.ok(value.install.some(step => step.type === 'mkdir' && step.target === 'profiles/VPPAdminTools/Permissions/SuperAdmins'));
  const commands = value.install.flatMap(step => step.commands || []).join('\n');
  assert.ok(!commands.includes(adminPassword) && !commands.includes(joinPassword));
  assert.ok(!JSON.stringify(value.run).includes(adminPassword));
  // Without VPP no VPP files are created and no Steam-ID admin list is accepted.
  assert.ok(!definition().install.some(step => String(step.target).startsWith('profiles/VPPAdminTools')));
  invalid(() => definition({ workshopIds: [CF, VPP] }, { serverPassword: joinPassword }));
});

test('DayZ admin mods need Community Framework first and Steam-ID admins need VPPAdminTools', () => {
  assert.equal(dayzSettings(profile({ workshopIds: [CF, VPP] })).vpp, true);
  assert.equal(dayzSettings(profile({ workshopIds: [CF, COT] })).vpp, false);
  for (const workshopIds of [[VPP], [VPP, CF], [COT], [COT, CF]]) invalid(() => dayzSettings(profile({ workshopIds })));
  invalid(() => dayzSettings(profile({ adminSteamIds: [admin] })));
  invalid(() => dayzSettings(profile({ workshopIds: [CF, COT], adminSteamIds: [admin] })));
  invalid(() => dayzSettings(profile({ workshopIds: [CF, VPP], adminSteamIds: ['76561197960265728'] })));
  invalid(() => dayzSettings(profile({ workshopIds: [CF, VPP], adminSteamIds: [admin, admin] })));
});

test('serverDZ.cfg admin password edit replaces exactly one assignment and keeps local changes', () => {
  const original = dayzServerConfig(profile(), { serverPassword: joinPassword }).replace('disableVoN = 0;', 'disableVoN = 1;\ndisable3rdPerson = 1;');
  const updated = withDayzAdminPassword(original, { adminPassword });
  assert.equal(updated, original.replace('passwordAdmin = "";', `passwordAdmin = "${adminPassword}";`));
  assert.ok(updated.includes('disable3rdPerson = 1;'));
  const crlf = original.replaceAll('\n', '\r\n');
  assert.equal(withDayzAdminPassword(crlf, { adminPassword }), crlf.replace('passwordAdmin = "";', `passwordAdmin = "${adminPassword}";`));
  for (const broken of ['hostname = "x";\n', `${original}passwordAdmin = "";\n`, original.replace('passwordAdmin = "";', '// passwordAdmin = "";\npasswordAdmin = "";'), `${original}\0`]) invalid(() => withDayzAdminPassword(broken, { adminPassword }));
  invalid(() => withDayzAdminPassword(original, { adminPassword: 'x";verifySignatures=0;' }));
  const named = dayzServerConfig(profile({ name: 'passwordAdmin Server' }), { serverPassword: joinPassword });
  assert.ok(withDayzAdminPassword(named, { adminPassword }).includes(`passwordAdmin = "${adminPassword}";`));
  assert.ok(withDayzAdminPassword(named, { adminPassword }).includes('hostname = "passwordAdmin Server";'));
});

test('VPP super admin list keeps foreign IDs, drops the VPP placeholder and refuses unknown content', () => {
  const placeholder = 'Remove this text and add your steam64 ID (each ID entry on a *new line*, no spaces between or commas)\n';
  assert.equal(mergeVppSuperAdmins(placeholder, admin, 'admin'), `${admin}\n`);
  assert.equal(mergeVppSuperAdmins('', admin, 'admin'), `${admin}\n`);
  assert.equal(mergeVppSuperAdmins(`${other}\r\n${admin}\r\n`, admin, 'admin'), `${other}\n${admin}\n`);
  assert.equal(mergeVppSuperAdmins(`${other}\n${admin}\n${admin}\n`, admin, 'user'), `${other}\n`);
  assert.equal(mergeVppSuperAdmins(`${admin}\n`, admin, 'user'), '');
  for (const original of ['STEAM_0:1:1\n', `${admin};#shutdown\n`, '76561197960265728\n', `${admin}\0`]) invalid(() => mergeVppSuperAdmins(original, other, 'admin'));
  const action = buildAdminAction(profile({ workshopIds: [CF, VPP] }), { steamId: 'STEAM_0:1:123456', role: 'admin' });
  assert.equal(action.path, VPP_SUPERADMINS_FILE); assert.equal(action.identity, admin);
  assert.equal(mergeAdminFile(action, `${other}\n`), `${other}\n${admin}\n`);
  invalid(() => buildAdminAction(profile(), { steamId: admin, role: 'admin' }));
  invalid(() => buildAdminAction(profile({ workshopIds: [CF, VPP] }), { steamId: admin, role: 'superadmin' }));
});

test('DayZ library is only ready once the helper has built and checked the runtime image', async t => {
  if (process.platform === 'win32' || process.getuid?.() !== 0) return; // Production requires root-owned files.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-dayz-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'dayz');
  await fs.mkdir(path.join(directory, 'server'), { recursive: true });
  await fs.writeFile(path.join(directory, 'server', 'DayZServer'), Buffer.from([127, 69, 76, 70]));
  await fs.chmod(path.join(directory, 'server', 'DayZServer'), 0o755);
  const manifest = { schema: 1, gameId: 'dayz', appId: '223350', ready: true, workshopIds: [], updatedAt: '2026-11-17T10:00:00.000Z' };
  const libraryConfig = { mode: 'pufferpanel', gameLibraryDir: root };
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  const missing = await gameLibraryStatus(libraryConfig, 'dayz');
  assert.equal(missing.ready, false);
  assert.match(missing.reason, /Laufzeitumgebung/);
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ ...manifest, runtimeImage: 'steamcmd/steamcmd:latest' }));
  assert.equal((await gameLibraryStatus(libraryConfig, 'dayz')).ready, false);
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ ...manifest, runtimeImage: DAYZ_RUNTIME_IMAGE }));
  const ready = await gameLibraryStatus(libraryConfig, 'dayz');
  assert.equal(ready.ready, true); assert.equal(ready.updatedAt, manifest.updatedAt);
});

async function apiFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-dayz-admin-'));
  const appConfig = readConfig({ DATA_DIR: directory });
  const records = [];
  const instance = await createApp({ config: appConfig, diagnostics: createDiagnostics({ write: line => records.push(JSON.parse(line)) }) });
  const server = await listenFixture(instance.app);
  appConfig.port = server.address().port;
  appConfig.origin = `http://127.0.0.1:${appConfig.port}`;
  let cookie = '', csrf = '';
  const post = async (route, body = {}) => {
    const response = await fetch(appConfig.origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: appConfig.origin, Cookie: cookie, 'X-CSRF-Token': csrf }, body: JSON.stringify(body) });
    const data = await response.json();
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: response.status, data };
  };
  await post('/api/setup', { token: instance.bootstrapToken, username: 'admin', password: 'DayZ-Admin-Test-Only-2026!' });
  const create = extra => post('/api/profiles', { gameId: 'dayz', loader: 'steam', version: 'latest', name: 'DayZ Freunde', port: 2302, queryPort: 27016, maxPlayers: 10, memoryMb: 8192, serverPassword: joinPassword, mission: 'dayzOffline.chernarusplus', workshopIds: [], ...extra });
  const job = async () => { await instance.controller.pending; return instance.store.state.job; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await instance.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { instance, records, post, create, job };
}

test('DayZ profile API validates admin mods and keeps the admin password out of state, events and responses', async t => {
  const f = await apiFixture(t);
  assert.equal((await f.create({ workshopIds: [VPP], adminPassword })).status, 400);
  assert.equal((await f.create({ workshopIds: [CF, VPP] })).status, 400, 'VPP needs an admin password');
  assert.equal((await f.create({ adminSteamIds: [admin] })).status, 400, 'Steam-ID admins need VPP');
  assert.equal((await f.create({ adminPassword: 'x' })).status, 400);
  const created = await f.create({ workshopIds: [CF, VPP], adminSteamIds: [admin], adminPassword });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.profile.adminPasswordSet, true);
  assert.equal(created.data.profile.adminKind, 'dayz');
  const serialized = JSON.stringify({ state: f.instance.store.state, response: created.data, diagnostics: f.records });
  assert.ok(!serialized.includes(adminPassword) && !serialized.includes(joinPassword));
  const arma = await f.post('/api/profiles', { gameId: 'arma3', loader: 'steam', version: 'latest', name: 'Arma', port: 2402, maxPlayers: 10, memoryMb: 6144, serverPassword: joinPassword, adminPassword });
  assert.equal(arma.status, 400);
});

test('DayZ admin password and VPP super admins can be maintained for a stopped profile', async t => {
  const f = await apiFixture(t);
  const created = await f.create({ workshopIds: [CF, VPP], adminSteamIds: [other], adminPassword });
  const profile = f.instance.store.state.profiles.find(item => item.id === created.data.profile.id);
  profile.installed = true; await f.instance.store.save();
  const granted = await f.post(`/api/profiles/${profile.id}/admin`, { steamId: admin, role: 'admin' });
  assert.equal(granted.status, 200, JSON.stringify(granted.data));
  assert.equal((await f.instance.runtime.read(profile)).adminFiles[VPP_SUPERADMINS_FILE], `${other}\n${admin}\n`);
  const changed = await f.post(`/api/profiles/${profile.id}/admin-password`, { password: 'New_Admin_Fixture_2' });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal(changed.data.profile.adminPasswordSet, true);
  assert.equal((await f.post(`/api/profiles/${profile.id}/admin-password`, { password: 'bad";x=1' })).status, 400);
  assert.equal((await f.post(`/api/profiles/${profile.id}/admin-password`, { password: 'New_Admin_Fixture_2', extra: 1 })).status, 400);
  const serialized = JSON.stringify({ events: f.instance.store.state.events, diagnostics: f.records });
  for (const value of ['New_Admin_Fixture_2', adminPassword, admin, other]) assert.ok(!serialized.includes(value), value);
  const plain = await f.create({ name: 'Vanilla' , port: 2402, queryPort: 27116 });
  assert.equal((await f.post(`/api/profiles/${plain.data.profile.id}/admin`, { steamId: admin, role: 'admin' })).status, 400);
  assert.equal((await f.post(`/api/profiles/${plain.data.profile.id}/admin-password`, { password: 'Vanilla_Login_123' })).status, 200);
});

test('Server & Mods update backs up, refreshes and restarts a running DayZ profile and keeps a stopped one stopped', async t => {
  const f = await apiFixture(t);
  const created = await f.create({});
  const id = created.data.profile.id;
  assert.equal((await f.post(`/api/profiles/${id}/activate`)).status, 202);
  assert.equal((await f.job()).status, 'completed');
  assert.equal((await f.post(`/api/profiles/${id}/update`, { unexpected: true })).status, 400);
  assert.equal((await f.post(`/api/profiles/${id}/update`)).status, 202);
  const running = await f.job();
  assert.equal(running.status, 'completed', running.error);
  assert.deepEqual(running.steps.map(step => step.status), Array(6).fill('completed'));
  const profile = f.instance.store.state.profiles.find(item => item.id === id);
  assert.equal(profile.status, 'running'); assert.equal(f.instance.store.state.activeProfileId, id);
  assert.ok(f.instance.store.state.backups.some(backup => backup.profileId === id && backup.name.startsWith('Vor-Update-')));
  assert.deepEqual(f.instance.store.state.pendingSafetyBackupProfileIds, []);
  assert.equal((await f.instance.runtime.read(profile)).updates, 1);
  assert.equal((await f.post(`/api/profiles/${id}/stop`)).status, 202); await f.job();
  assert.equal((await f.post(`/api/profiles/${id}/update`)).status, 202);
  assert.equal((await f.job()).status, 'completed');
  assert.equal(profile.status, 'stopped'); assert.equal(f.instance.store.state.activeProfileId, null);
  assert.equal((await f.instance.runtime.read(profile)).updates, 2);
  const minecraft = await f.post('/api/profiles', { gameId: 'minecraft', loader: 'vanilla', version: '1.21.4', eulaAccepted: true, name: 'MC', port: 25565, maxPlayers: 10, memoryMb: 4096 });
  assert.equal((await f.post(`/api/profiles/${minecraft.data.profile.id}/update`)).status, 400);
  const fresh = await f.create({ name: 'Neu', port: 2502, queryPort: 27216 });
  assert.equal((await f.post(`/api/profiles/${fresh.data.profile.id}/update`)).status, 202);
  assert.match((await f.job()).error, /noch nicht installiert/);
});

test('update refuses port collisions with another running profile before touching it', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await openStore(path.join(root, 'state'));
  const running = { id: randomUUID(), gameId: 'arma3', name: 'Arma', port: 2302, installed: true };
  const target = { id: randomUUID(), gameId: 'dayz', name: 'DayZ', port: 2302, queryPort: 27016, installed: true };
  store.state.profiles.push(running, target);
  const calls = [];
  const runtime = { status: async item => ({ running: item.id === running.id }) };
  for (const method of ['preflight', 'save', 'stop', 'backup', 'start', 'update']) runtime[method] = async () => { calls.push(method); return {}; };
  const controller = new Controller(store, runtime);
  controller.begin('update', target.id); await controller.pending;
  assert.equal(store.state.job.status, 'failed');
  assert.match(store.state.job.error, /belegt einen benötigten Spielport/);
  assert.equal(store.state.job.steps[0].status, 'failed');
  assert.deepEqual(calls, []);
});

test('Puffer update re-applies the current definition before reinstalling and refuses a running instance', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-puffer-update-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const item = { id: randomUUID(), serverId: 'fixture', ...profile({ workshopIds: [CF, VPP], adminSteamIds: [admin] }), installed: true };
  await writeProfileSecrets({ dataDir: directory }, item.id, { serverPassword: joinPassword, adminPassword });
  const runtimeConfig = { ...readConfig({ DATA_DIR: directory }), mode: 'sandbox', nodeId: 0, gameUid: 1000, gameGid: 1000 };
  const runtime = new PufferRuntime(runtimeConfig);
  const requests = [];
  runtime.status = async () => ({ running: false });
  runtime.request = async (endpoint, options = {}) => { requests.push({ endpoint, ...options }); return null; };
  await runtime.update(item);
  assert.deepEqual(requests.map(request => `${request.method} ${request.endpoint}`), ['PUT /api/servers/fixture/definition', 'POST /api/servers/fixture/install?wait=true']);
  assert.equal(requests[0].body.environment.image, DAYZ_RUNTIME_IMAGE);
  assert.ok(requests[0].body.install.some(step => step.target === VPP_CREDENTIALS_FILE));
  runtime.status = async () => ({ running: true }); requests.length = 0;
  await assert.rejects(runtime.update(item), error => error.status === 409);
  assert.deepEqual(requests, []);
  await assert.rejects(runtime.update({ ...item, gameId: 'minecraft' }), error => error.status === 400);
});

test('Puffer admin password patches serverDZ.cfg and VPP credentials only while confirmed stopped', async () => {
  const cfg = dayzServerConfig(profile(), { serverPassword: joinPassword });
  const item = { id: randomUUID(), serverId: 'fixture', ...profile({ workshopIds: [CF, VPP] }), installed: true };
  const runtime = new PufferRuntime({});
  const requests = [];
  runtime.status = async () => ({ running: false });
  runtime.request = async (endpoint, options = {}) => { requests.push({ endpoint, ...options }); return options.raw ? cfg : null; };
  assert.deepEqual(await runtime.setAdminPassword(item, adminPassword), { requiresRestart: true });
  const writes = requests.filter(request => request.method === 'PUT');
  assert.equal(writes[0].endpoint, '/api/servers/fixture/file/gameswitch-dayz/serverDZ.cfg');
  assert.ok(writes[0].body.includes(`passwordAdmin = "${adminPassword}";`) && writes[0].body.includes(`password = "${joinPassword}";`));
  assert.equal(writes[1].endpoint, '/api/servers/fixture/file/profiles/VPPAdminTools/Permissions?folder');
  assert.equal(writes[2].endpoint, '/api/servers/fixture/file/profiles/VPPAdminTools/Permissions/credentials.txt');
  assert.equal(writes[2].body, `${adminPassword}\n`);
  // Vanilla profiles only update passwordAdmin.
  requests.length = 0;
  await runtime.setAdminPassword({ ...item, workshopIds: [] }, adminPassword);
  assert.equal(requests.filter(request => request.method === 'PUT').length, 1);
  // Running or unknown state: nothing is read or written.
  for (const state of [true, null]) {
    runtime.status = async () => ({ running: state }); requests.length = 0;
    await assert.rejects(runtime.setAdminPassword(item, adminPassword), error => error.status === 409);
    assert.deepEqual(requests, []);
  }
  runtime.status = async () => ({ running: false });
  runtime.request = async (endpoint, options = {}) => { if (options.raw) return cfg; if (endpoint.endsWith('credentials.txt')) throw new Error('private gateway detail'); return null; };
  await assert.rejects(runtime.setAdminPassword(item, adminPassword), error => error.code === 'ADMIN_WRITE_UNCERTAIN' && !error.message.includes('gateway'));
  await assert.rejects(runtime.setAdminPassword(item, 'x'), error => error.status === 400);
  // A not yet installed profile only stores the secret; files come with the install.
  runtime.request = async () => { throw new Error('No runtime access expected'); };
  assert.deepEqual(await runtime.setAdminPassword({ ...item, installed: false }, adminPassword), { requiresRestart: false });
});

test('a VPP profile without an admin password is blocked before activation touches the running game', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-vpp-preflight-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtime = new PufferRuntime({ ...readConfig({ DATA_DIR: directory }), mode: 'sandbox' });
  const item = { id: randomUUID(), serverId: 'fixture', ...profile({ workshopIds: [CF, VPP] }) };
  await writeProfileSecrets({ dataDir: directory }, item.id, { serverPassword: joinPassword });
  await assert.rejects(runtime.preflight(item), error => error.status === 409 && /Adminpasswort/.test(error.message));
  await writeProfileSecrets({ dataDir: directory }, item.id, { adminPassword });
  await runtime.preflight(item);
});
