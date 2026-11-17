import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { gameLibraryStatus, requireGameLibrary } from '../server/game-library.mjs';
import { Controller } from '../server/controller.mjs';
import { openStore } from '../server/store.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'arma3');
  await fs.mkdir(path.join(directory, 'server'), { recursive: true });
  await fs.mkdir(path.join(directory, 'mods', '450814997'), { recursive: true });
  await fs.writeFile(path.join(directory, 'server', 'arma3server_x64'), Buffer.from([127, 69, 76, 70]));
  await fs.chmod(path.join(directory, 'server', 'arma3server_x64'), 0o755);
  const config = { mode: 'pufferpanel', gameLibraryDir: root };
  const manifest = { schema: 1, gameId: 'arma3', appId: '233780', ready: true, workshopIds: ['450814997'], updatedAt: new Date().toISOString() };
  const write = async value => fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(value));
  return { root, config, directory, manifest, write };
}

test('missing or malformed Steam library stays unavailable and returns no private file contents', async t => {
  const f = await fixture(t);
  assert.equal((await gameLibraryStatus(f.config, 'arma3')).ready, false);
  await fs.writeFile(path.join(f.directory, 'manifest.json'), 'PRIVATE_STEAM_LOGIN');
  const status = await gameLibraryStatus(f.config, 'arma3');
  assert.equal(status.ready, false);
  assert.ok(!JSON.stringify(status).includes('PRIVATE_'));
  for (const value of [{ ...f.manifest, gameId: 'dayz' }, { ...f.manifest, appId: '223350' }, { ...f.manifest, ready: false }, { ...f.manifest, workshopIds: ['1;quit'] }, { ...f.manifest, workshopIds: ['450814997', '450814997'] }]) {
    await f.write(value);
    assert.equal((await gameLibraryStatus(f.config, 'arma3')).ready, false);
  }
});

test('prepared library requires a native file and selected Workshop items; Sandbox is explicitly simulated', async t => {
  const f = await fixture(t); await f.write(f.manifest);
  const status = await gameLibraryStatus(f.config, 'arma3');
  // Linux production intentionally requires root-owned files.
  if (process.platform !== 'win32' && process.getuid?.() !== 0) { assert.equal(status.ready, false); return; }
  assert.equal(status.ready, true);
  await requireGameLibrary(f.config, { gameId: 'arma3', workshopIds: ['450814997'] });
  await fs.writeFile(path.join(f.root, '.preparing'), 'prepare');
  assert.equal((await gameLibraryStatus(f.config, 'arma3')).ready, false);
  await assert.rejects(requireGameLibrary(f.config, { gameId: 'arma3' }), error => error.diagnosticReason === 'steam_library_required');
  await fs.unlink(path.join(f.root, '.preparing'));
  await assert.rejects(requireGameLibrary(f.config, { gameId: 'arma3', workshopIds: ['463939057'] }), error => error.diagnosticReason === 'steam_mods_required');
  await fs.unlink(path.join(f.directory, 'server', 'arma3server_x64'));
  assert.equal((await gameLibraryStatus(f.config, 'arma3')).ready, false);
  assert.equal((await gameLibraryStatus({ mode: 'sandbox' }, 'dayz')).simulated, true);
  await requireGameLibrary({ mode: 'sandbox' }, { gameId: 'arma3', workshopIds: ['450814997'] });
});

test('missing Steam setup refuses activation before save, stop or safety-marker changes', async t => {
  const f = await fixture(t);
  const store = await openStore(path.join(f.root, 'state'));
  const current = { id: randomUUID(), gameId: 'minecraft', name: 'Evolution2', installed: true };
  const target = { id: randomUUID(), gameId: 'dayz', name: 'DayZ', installed: false };
  store.state.profiles.push(current, target);
  store.state.activeProfileId = current.id;
  const calls = [];
  const runtime = { status: async profile => ({ running: profile.id === current.id }), preflight: profile => requireGameLibrary(f.config, profile) };
  for (const method of ['save', 'stop', 'backup', 'start', 'install']) runtime[method] = async () => calls.push(method);
  const controller = new Controller(store, runtime);
  controller.begin('activate', target.id, undefined, { sourceProfileId: current.id }); await controller.pending;
  assert.equal(store.state.job.status, 'failed');
  assert.match(store.state.job.error, /Steam-Einrichtung/);
  assert.equal(store.state.activeProfileId, current.id);
  assert.deepEqual(store.state.pendingSafetyBackupProfileIds, []);
  assert.deepEqual(calls, []);
});
