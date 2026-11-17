import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Controller } from '../server/controller.mjs';
import { openStore } from '../server/store.mjs';

function fixture() {
  const mc = { id: 'mc', gameId: 'minecraft', name: 'Minecraft', port: 25565, memoryMb: 12288, installed: true };
  const dayz = { id: 'dayz', gameId: 'dayz', name: 'DayZ', port: 2302, queryPort: 27016, memoryMb: 6144, installed: false };
  const running = new Set(['mc']);
  const calls = [];
  const state = { profiles: [mc, dayz], activeProfileId: 'mc', pendingSafetyBackupProfileIds: [], recoveryRequiredProfileIds: [], backups: [], events: [] };
  const store = { state, healthy: true, save: async () => {}, event: () => {} };
  const runtime = {
    async status(p) { return { running: running.has(p.id) }; },
    async preflight(p) { calls.push(`preflight:${p.id}`); },
    async install(p) { calls.push(`install:${p.id}`); },
    async start(p) { calls.push(`start:${p.id}`); running.add(p.id); },
    async save(p) { calls.push(`save:${p.id}`); },
    async stop(p) { calls.push(`stop:${p.id}`); running.delete(p.id); },
    async backup(p) { calls.push(`backup:${p.id}`); return { runtimeId: 'backup' }; },
  };
  const controller = new Controller(store, runtime, undefined, { memoryMb: 23964, reservedMemoryMb: 3072 });
  return { mc, dayz, running, calls, state, runtime, controller };
}

test('starts DayZ alongside Minecraft without saving, stopping or restarting Minecraft', async () => {
  const f = fixture(); f.controller.begin('parallel', f.dayz.id); await f.controller.pending;
  assert.equal(f.state.job.status, 'completed');
  assert.deepEqual(f.calls, ['preflight:dayz', 'install:dayz', 'start:dayz']);
  assert.deepEqual([...f.running].sort(), ['dayz', 'mc']);
  await f.controller.reconcile();
  assert.equal(f.mc.status, 'running'); assert.equal(f.dayz.status, 'running');
});

test('a failed stop of a still-running game preserves its backup marker while another game starts', async () => {
  const f = fixture(); f.state.pendingSafetyBackupProfileIds.push(f.mc.id);
  f.controller.begin('parallel', f.dayz.id); await f.controller.pending;
  assert.equal(f.state.job.status, 'completed');
  assert.deepEqual(f.state.pendingSafetyBackupProfileIds, [f.mc.id]);
  assert.deepEqual(f.calls, ['preflight:dayz', 'install:dayz', 'start:dayz']);
  assert.deepEqual([...f.running].sort(), ['dayz', 'mc']);
});

test('rejects RAM exhaustion and conflicting ports before installation or stopping any server', async () => {
  for (const scenario of ['memory', 'ports']) {
    const f = fixture();
    if (scenario === 'memory') f.dayz.memoryMb = 10000;
    else { f.dayz.gameId = 'minecraft'; f.dayz.port = f.mc.port; }
    f.controller.begin('parallel', f.dayz.id); await f.controller.pending;
    assert.equal(f.state.job.status, 'failed'); assert.deepEqual(f.calls, []);
    assert.deepEqual([...f.running], ['mc']);
  }
});

test('stopping the second server saves only that game and retains the running Minecraft profile', async () => {
  const f = fixture(); f.running.add('dayz'); f.dayz.installed = true;
  f.controller.begin('stop', 'dayz'); await f.controller.pending;
  assert.equal(f.state.job.status, 'completed');
  assert.deepEqual(f.calls, ['save:dayz', 'stop:dayz', 'backup:dayz']);
  assert.deepEqual([...f.running], ['mc']);
  assert.equal(f.state.activeProfileId, 'mc');
  assert.deepEqual(f.state.pendingSafetyBackupProfileIds, []);
});

test('each failed backup remains pending until its own profile is secured', async () => {
  const f = fixture(); f.running.add('dayz'); f.dayz.installed = true;
  const completeBackup = f.runtime.backup;
  f.runtime.backup = async () => { throw new Error('Disk full'); };
  f.controller.begin('stop', 'dayz'); await f.controller.pending;
  assert.equal(f.state.job.status, 'failed');
  f.controller.begin('stop', 'mc'); await f.controller.pending;
  assert.equal(f.state.job.status, 'failed');
  assert.equal(f.running.size, 0);
  assert.deepEqual(f.state.pendingSafetyBackupProfileIds, ['dayz', 'mc']);

  f.runtime.backup = completeBackup;
  f.controller.begin('parallel', 'dayz'); await f.controller.pending;
  assert.equal(f.state.job.status, 'completed');
  assert.deepEqual(f.state.pendingSafetyBackupProfileIds, ['mc']);
  assert.deepEqual([...f.running], ['dayz']);
});

test('restart of the second server leaves Minecraft running', async () => {
  const f = fixture(); f.running.add('dayz'); f.dayz.installed = true;
  f.controller.begin('restart', 'dayz'); await f.controller.pending;
  assert.equal(f.state.job.status, 'completed');
  assert.deepEqual(f.calls, ['preflight:dayz', 'save:dayz', 'stop:dayz', 'backup:dayz', 'start:dayz']);
  assert.deepEqual([...f.running].sort(), ['dayz', 'mc']);
});

test('switch refuses to stop a server when multiple profiles are running', async () => {
  const f = fixture();
  f.state.profiles.push({ ...f.mc, id: 'third' });
  f.running.add('third');
  f.controller.begin('activate', 'dayz', undefined, { sourceProfileId: 'mc' }); await f.controller.pending;
  assert.equal(f.state.job.status, 'failed'); assert.deepEqual(f.calls, []);
  assert.deepEqual([...f.running], ['mc', 'third']);
});

test('an unknown sibling status blocks allocation but allows a confirmed running server to stop', async () => {
  const f = fixture();
  const readStatus = f.runtime.status;
  f.runtime.status = async profile => profile === f.mc ? { running: null } : readStatus(profile);
  f.controller.begin('parallel', 'dayz'); await f.controller.pending;
  assert.equal(f.state.job.status, 'failed');
  assert.deepEqual(f.calls, []);

  f.running.add('dayz');
  f.dayz.installed = true;
  await f.controller.reconcile();
  assert.equal(f.mc.status, 'unknown');
  assert.equal(f.dayz.status, 'running');
  assert.equal(f.state.activeProfileId, 'dayz');
  f.controller.begin('stop', 'dayz'); await f.controller.pending;
  assert.equal(f.state.job.status, 'completed');
  assert.deepEqual(f.calls, ['save:dayz', 'stop:dayz', 'backup:dayz']);
});

test('checks capacity again when a profile is started externally during installation', async () => {
  const f = fixture();
  f.state.profiles.push({ ...f.mc, id: 'external', port: 25566, memoryMb: 4096 });
  const install = f.runtime.install;
  f.runtime.install = async profile => { await install(profile); f.running.add('external'); };
  f.controller.begin('parallel', 'dayz'); await f.controller.pending;
  assert.equal(f.state.job.status, 'failed');
  assert.match(f.state.job.error, /RAM-Budget/);
  assert.equal(f.dayz.installed, true);
  assert.deepEqual([...f.running], ['mc', 'external']);
});

test('an update installer cannot exceed the RAM budget of other running games', async () => {
  const f = fixture();
  f.dayz.installed = true;
  f.dayz.memoryMb = 10000;
  f.controller.begin('update', 'dayz'); await f.controller.pending;
  assert.equal(f.state.job.status, 'failed');
  assert.match(f.state.job.error, /RAM-Budget/);
  assert.deepEqual(f.calls, []);
});

test('updating a running DayZ profile refreshes and restarts only DayZ', async () => {
  const f = fixture();
  f.running.add('dayz');
  f.dayz.installed = true;
  f.runtime.update = async profile => {
    assert.deepEqual([...f.running], ['mc']);
    f.calls.push(`update:${profile.id}`);
    return { libraryUpdatedAt: '2026-11-17T10:00:00.000Z' };
  };
  f.controller.begin('update', 'dayz'); await f.controller.pending;
  assert.equal(f.state.job.status, 'completed');
  assert.deepEqual(f.calls, ['preflight:dayz', 'save:dayz', 'stop:dayz', 'backup:dayz', 'update:dayz', 'start:dayz']);
  assert.deepEqual([...f.running], ['mc', 'dayz']);
  assert.equal(f.dayz.libraryUpdatedAt, '2026-11-17T10:00:00.000Z');
});

test('lifts a legacy safety backup into the per-profile state when reopening the store', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-parallel-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'state.json');
  await fs.writeFile(file, JSON.stringify({
    schema: 1, profiles: [{ id: 'legacy' }], backups: [], events: [], pendingSafetyBackupProfileId: 'legacy',
    job: { status: 'running', steps: [{ status: 'completed' }, { status: 'running' }] },
  }));
  const store = await openStore(directory);
  assert.deepEqual(store.state.pendingSafetyBackupProfileIds, ['legacy']);
  assert.equal(store.state.job.status, 'failed');
  assert.deepEqual(store.state.job.steps.map(step => step.status), ['completed', 'failed']);
  const persisted = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(persisted.schema, 2);
  assert.deepEqual(persisted.pendingSafetyBackupProfileIds, ['legacy']);
  assert.equal(Object.hasOwn(persisted, 'pendingSafetyBackupProfileId'), false);
  assert.deepEqual((await openStore(directory)).state.pendingSafetyBackupProfileIds, ['legacy']);
});
