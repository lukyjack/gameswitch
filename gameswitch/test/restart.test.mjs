import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.mjs';
import { readConfig } from '../server/config.mjs';
import { listenFixture } from './http-fixture.mjs';

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-restart-'));
  const config = readConfig({ DATA_DIR: directory });
  const first = { id: 'restart-first', serverId: 'runtime-first', name: 'Freunde-Welt', gameId: 'minecraft', installed: true, status: 'running' };
  const other = { id: 'restart-other', serverId: 'runtime-other', name: 'Andere Welt', gameId: 'minecraft', installed: true, status: 'stopped' };
  const running = new Map([[first.id, true], [other.id, false]]);
  const calls = [];
  let instance;
  const fail = options.fail;
  const runtime = {
    async status(profile) {
      calls.push(`status:${profile.id}`);
      if (options.statusFailure?.(profile, calls)) throw new Error('Status unavailable');
      return { running: running.get(profile.id) || false };
    },
    async save(profile) {
      calls.push(`save:${profile.id}`);
      const persisted = JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8'));
      assert.ok(persisted.pendingSafetyBackupProfileIds.includes(profile.id), 'intent must be durable before saving');
      assert.equal(persisted.job.type, 'restart');
      if (options.onSave) await options.onSave();
      if (fail === 'save') throw new Error('Save failed');
    },
    async stop(profile) {
      calls.push(`stop:${profile.id}`);
      if (fail === 'stop') throw new Error('Stop failed');
      if (!options.stillRunningAfterStop) running.set(profile.id, false);
    },
    async backup(profile, name) {
      calls.push(`backup:${profile.id}`);
      assert.equal(running.get(profile.id), false);
      assert.ok(name.startsWith('Vor-Neustart-'));
      if (fail === 'backup') throw new Error('Backup failed');
      if (options.afterBackup) options.afterBackup({ running, first, other });
      return { runtimeId: 'restart-snapshot' };
    },
    async start(profile) {
      calls.push(`start:${profile.id}`);
      assert.equal([...running.values()].some(Boolean), false);
      const persisted = JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8'));
      assert.ok(!persisted.pendingSafetyBackupProfileIds.includes(profile.id), 'completed backup must be durable before starting');
      assert.equal(persisted.backups[0].runtimeId, 'restart-snapshot');
      running.set(profile.id, true);
    },
    async install() { calls.push('install'); throw new Error('Restart must never install or reinstall'); },
    async command() { calls.push('command'); },
  };
  instance = await createApp({ config, runtime });
  instance.store.state.profiles.push(first, other);
  await instance.store.save();
  const server = await listenFixture(instance.app);
  config.port = server.address().port;
  config.origin = `http://127.0.0.1:${config.port}`;
  let cookie = ''; let csrf = '';
  const request = async (route, body = {}, headers = {}) => {
    const response = await fetch(config.origin + route, { method: 'POST', headers: { Origin: config.origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const data = await response.json();
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: response.status, data };
  };
  const setup = () => request('/api/setup', { token: instance.bootstrapToken, username: 'admin', password: 'Restart-tests-only-password-2026' });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await instance.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { instance, first, other, running, calls, request, setup, directory };
}

test('restart API requires login, origin, CSRF and an empty body', async t => {
  const f = await fixture(t);
  const route = `/api/profiles/${f.first.id}/restart`;
  assert.equal((await f.request(route)).status, 401);
  await f.setup();
  assert.equal((await f.request(route, {}, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await f.request(route, {}, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await f.request(route, { force: true })).status, 400);
  assert.equal((await f.request(route, { memoryMb: 12288 })).status, 400);
  assert.deepEqual(f.calls, []);
});

test('restart saves, confirms graceful stop, snapshots and starts the same installed profile without installation', async t => {
  const f = await fixture(t); await f.setup();
  const response = await f.request(`/api/profiles/${f.first.id}/restart`);
  assert.equal(response.status, 202);
  assert.equal(response.data.job.type, 'restart');
  await f.instance.controller.pending;
  assert.equal(f.instance.store.state.job.status, 'completed');
  assert.deepEqual(f.calls, [
    `status:${f.first.id}`, `status:${f.other.id}`, `save:${f.first.id}`, `stop:${f.first.id}`, `status:${f.first.id}`, `backup:${f.first.id}`,
    `status:${f.first.id}`, `status:${f.other.id}`, `start:${f.first.id}`,
  ]);
  assert.equal(f.running.get(f.first.id), true);
  assert.equal(f.running.get(f.other.id), false);
  assert.equal(f.instance.store.state.activeProfileId, f.first.id);
  assert.equal(f.instance.store.state.backups[0].profileId, f.first.id);
  assert.deepEqual(f.instance.store.state.pendingSafetyBackupProfileIds, []);
  assert.ok(f.instance.store.state.job.steps.every(step => step.status === 'completed'));
  assert.ok(f.instance.store.state.events.some(event => event.message.includes('Serverneustart')));
});

test('restart rejects stopped, wrong, uninstalled or recovery-blocked targets before side effects', async t => {
  const cases = [
    { name: 'stopped', prepare: f => f.running.set(f.first.id, false) },
    { name: 'wrong running profile', prepare: f => { f.running.set(f.first.id, false); f.running.set(f.other.id, true); } },
    { name: 'uninstalled', prepare: f => { f.first.installed = false; } },
    { name: 'incomplete restore', prepare: f => f.instance.store.state.recoveryRequiredProfileIds.push(f.first.id) },
  ];
  for (const scenario of cases) await t.test(scenario.name, async child => {
    const f = await fixture(child); await f.setup(); scenario.prepare(f);
    assert.equal((await f.request(`/api/profiles/${f.first.id}/restart`)).status, 202);
    await f.instance.controller.pending;
    assert.equal(f.instance.store.state.job.status, 'failed');
    assert.ok(f.calls.every(call => call.startsWith('status:')));
  });
});

test('restart serializes against duplicate restarts, other lifecycle actions and console dispatch', async t => {
  let release; const held = new Promise(resolve => { release = resolve; });
  let enter; const entered = new Promise(resolve => { enter = resolve; });
  const f = await fixture(t, { onSave: async () => { enter(); await held; } }); await f.setup();
  assert.equal((await f.request(`/api/profiles/${f.first.id}/restart`)).status, 202);
  await entered;
  assert.equal((await f.request(`/api/profiles/${f.first.id}/restart`)).status, 409);
  assert.equal((await f.request(`/api/profiles/${f.other.id}/activate`)).status, 409);
  assert.equal((await f.request(`/api/profiles/${f.first.id}/console`, { command: 'list' })).status, 409);
  release(); await f.instance.controller.pending;
  assert.equal(f.instance.store.state.job.status, 'completed');
  assert.equal(f.calls.filter(call => call.startsWith('start:')).length, 1);
});

test('save, stop or backup failure never starts or installs and keeps the durable safety marker', async t => {
  for (const fail of ['save', 'stop', 'backup']) await t.test(fail, async child => {
    const f = await fixture(child, { fail }); await f.setup();
    await f.request(`/api/profiles/${f.first.id}/restart`); await f.instance.controller.pending;
    assert.equal(f.instance.store.state.job.status, 'failed');
    assert.ok(!f.calls.some(call => call.startsWith('start:') || call === 'install'));
    const persisted = JSON.parse(await fs.readFile(path.join(f.directory, 'state.json'), 'utf8'));
    assert.deepEqual(persisted.pendingSafetyBackupProfileIds, [f.first.id]);
    assert.equal(persisted.backups.length, 0);
  });
});

test('restart refuses an unconfirmed stop and status failures without starting', async t => {
  for (const options of [
    { stillRunningAfterStop: true },
    { statusFailure: (profile, calls) => calls.includes(`stop:${profile.id}`) },
    { statusFailure: () => true },
  ]) await t.test(JSON.stringify(options), async child => {
    const f = await fixture(child, options); await f.setup();
    await f.request(`/api/profiles/${f.first.id}/restart`); await f.instance.controller.pending;
    assert.equal(f.instance.store.state.job.status, 'failed');
    assert.ok(!f.calls.some(call => call.startsWith('start:') || call.startsWith('backup:') || call === 'install'));
  });
});

test('restart freshly checks every profile and refuses an externally started server after the backup', async t => {
  const f = await fixture(t, { afterBackup: ({ running, other }) => running.set(other.id, true) }); await f.setup();
  await f.request(`/api/profiles/${f.first.id}/restart`); await f.instance.controller.pending;
  assert.equal(f.instance.store.state.job.status, 'failed');
  assert.match(f.instance.store.state.job.error, /Ports/);
  assert.equal(f.running.get(f.first.id), false);
  assert.equal(f.running.get(f.other.id), true);
  assert.equal(f.instance.store.state.backups.length, 1);
  assert.ok(!f.calls.some(call => call.startsWith('start:') || call === 'install'));
});
