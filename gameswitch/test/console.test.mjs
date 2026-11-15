import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.mjs';
import { readConfig } from '../server/config.mjs';
import { PufferRuntime } from '../server/runtime.mjs';
import { consoleCommandSchema } from '../server/console-command.mjs';
import { listenFixture } from './http-fixture.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-console-'));
  const config = readConfig({ DATA_DIR: directory });
  const instance = await createApp({ config });
  const server = await listenFixture(instance.app);
  config.port = server.address().port;
  config.origin = `http://127.0.0.1:${config.port}`;
  let cookie = ''; let csrf = '';
  const request = async (route, body, headers = {}) => {
    const response = await fetch(config.origin + route, {
      method: 'POST', headers: { Origin: config.origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: response.status, data };
  };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await instance.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const setup = () => request('/api/setup', { token: instance.bootstrapToken, username: 'admin', password: 'Console-test-password-only-2026' });
  const minecraft = { id: 'minecraft-fixture', serverId: 'mc-fixture', name: 'Testwelt', gameId: 'minecraft', installed: true, status: 'running' };
  const gmod = { id: 'gmod-fixture', serverId: 'gmod-fixture', name: 'Test TTT', gameId: 'gmod', installed: true, status: 'stopped' };
  instance.store.state.profiles.push(minecraft, gmod);
  return { instance, request, setup, minecraft, gmod };
}

test('console validation accepts Minecraft syntax and rejects multiline/control/lifecycle input', () => {
  assert.equal(consoleCommandSchema.parse({ command: ' /op Example_Player  ' }).command, 'op Example_Player');
  assert.equal(consoleCommandSchema.parse({ command: 'tellraw @a {"text":"hi; $(literal)"}' }).command, 'tellraw @a {"text":"hi; $(literal)"}');
  for (const command of ['', ' / ', 'say hi\nstop', 'list\rstop', 'say \x00', 'say \x1b[31mred', 'say \u0085', 'say \u2028', 'say \u2029', 'x'.repeat(1025), 'stop', '/STOP', 'minecraft:stop', 'restart', 'exit']) {
    assert.equal(consoleCommandSchema.safeParse({ command }).success, false, JSON.stringify(command));
  }
  assert.equal(consoleCommandSchema.safeParse({ command: 'list', url: 'http://localhost' }).success, false);
});

test('console API inherits login/CSRF/origin protection and rejects stopped profiles', async t => {
  const f = await fixture(t);
  const route = `/api/profiles/${f.minecraft.id}/console`;
  assert.equal((await f.request(route, { command: 'list' })).status, 401);
  await f.setup();
  assert.equal((await f.request(route, { command: 'list' }, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await f.request(route, { command: 'list' }, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await f.request(`/api/profiles/${f.gmod.id}/console`, { command: 'status' })).status, 409);
  assert.equal((await f.request(route, { command: 'list' })).status, 409);
  assert.equal((await f.request(route, { command: 'stop' })).status, 400);
});

test('Minecraft console dispatches once, omits arguments from audit and never calls lifecycle methods', async t => {
  const f = await fixture(t); await f.setup();
  const calls = [];
  f.instance.runtime.command = async (profile, command) => { calls.push({ id: profile.id, command }); };
  for (const method of ['start', 'stop', 'install', 'backup', 'restore', 'save']) f.instance.runtime[method] = async () => { throw new Error('Lifecycle must not be invoked'); };
  const response = await f.request(`/api/profiles/${f.minecraft.id}/console`, { command: '/op Secret_Player' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { ok: true });
  assert.deepEqual(calls, [{ id: f.minecraft.id, command: 'op Secret_Player' }]);
  const events = JSON.stringify(f.instance.store.state.events);
  assert.ok(events.includes('„op“'));
  assert.ok(!events.includes('Secret_Player'));
  assert.equal(f.instance.controller.busy, false);
});

test('console dispatch exclusively reserves lifecycle gate and releases it after upstream failure', async t => {
  const f = await fixture(t); await f.setup();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  f.instance.runtime.command = async () => { calls++; entered(); await held; throw Object.assign(new Error('Upstream request timed out; dispatch uncertain'), { status: 502 }); };
  const pending = f.request(`/api/profiles/${f.minecraft.id}/console`, { command: 'list' });
  await ready;
  assert.equal((await f.request(`/api/profiles/${f.gmod.id}/activate`, {})).status, 409);
  assert.equal((await f.request(`/api/profiles/${f.minecraft.id}/console`, { command: 'list' })).status, 409);
  release();
  assert.equal((await pending).status, 502);
  assert.equal(calls, 1);
  assert.equal(f.instance.controller.busy, false);
});

test('console never dispatches if audit persistence fails', async t => {
  const f = await fixture(t); await f.setup();
  let calls = 0;
  f.instance.runtime.command = async () => { calls++; };
  f.instance.store.save = async () => { throw new Error('Disk full'); };
  assert.equal((await f.request(`/api/profiles/${f.minecraft.id}/console`, { command: 'list' })).status, 500);
  assert.equal(calls, 0);
  assert.equal(f.instance.controller.busy, false);
});

test('console uncertainty is reported explicitly without automatic retry', async t => {
  const f = await fixture(t); await f.setup();
  let calls = 0;
  f.instance.runtime.command = async () => { calls++; throw Object.assign(new Error('Internal detail must not be exposed'), { code: 'CONSOLE_DELIVERY_UNCERTAIN' }); };
  const response = await f.request(`/api/profiles/${f.minecraft.id}/console`, { command: 'list' });
  assert.equal(response.status, 502);
  assert.match(response.data.error, /bereits ausgeführt/);
  assert.ok(!response.data.error.includes('Internal detail'));
  assert.equal(calls, 1);
});

test('Puffer console adapter forwards literal text/plain and checks actual running state', async () => {
  const calls = [];
  let running = true;
  const runtime = new PufferRuntime({ pufferUrl: 'https://runtime.example', clientId: 'test', clientSecret: 'test' }, async (url, options) => {
    calls.push({ url, ...options });
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'test-access-token', expires_in: 300 });
    if (url.endsWith('/status')) return Response.json({ gameswitchVersion: 1, running, installing: false });
    return new Response(null, { status: 204 });
  });
  const profile = { serverId: 'mc-profile' };
  const command = 'tellraw @a {"text":"hi; $(literal)"}';
  await runtime.command(profile, command);
  const posts = calls.filter(call => call.url.endsWith('/console'));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body, command);
  assert.equal(posts[0].headers['Content-Type'], 'text/plain');
  running = false;
  await assert.rejects(runtime.command(profile, 'list'), error => error.status === 409);
  assert.equal(calls.filter(call => call.url.endsWith('/console')).length, 1);
});
