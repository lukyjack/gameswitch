import test from 'node:test';
import assert from 'node:assert/strict';
import { minecraftMemory, ftbEnvironment } from '../server/minecraft-memory.mjs';
import { PufferRuntime } from '../server/runtime.mjs';

test('large FTB packs leave native headroom and use a small initial heap', () => {
  const profile = { loader: 'ftb', memoryMb: 12288, recommendedMemoryMb: 8192 };
  assert.deepEqual(minecraftMemory(profile), { maximumMb: 8192, initialMb: 2048 });
  assert.equal(minecraftMemory({ ...profile, memoryMb: 8192 }).maximumMb, 6144);
  const env = ftbEnvironment(profile, { FTB_MODPACK_ID: '135', JVM_OPTS: '-Dcustom=value' });
  assert.equal(env.MEMORY, '8192M');
  assert.equal(env.INIT_MEMORY, '2048M');
  assert.equal(env.MAX_MEMORY, '8192M');
  assert.equal(env.FTB_MODPACK_ID, '135');
  assert.equal(env.JVM_OPTS, '-Dcustom=value -Dio.netty.native.workdir=/data/.cache/netty');
});

test('resource reconciliation refuses to touch an already running FTB process', async () => {
  const calls = [];
  const runtime = new PufferRuntime({ pufferUrl: 'https://runtime.example' }, async (url, options) => {
    calls.push({ url, method: options.method });
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'fixture' });
    return Response.json({ gameswitchVersion: 1, running: true });
  });
  await assert.rejects(runtime.start({ gameId: 'minecraft', loader: 'ftb', serverId: 'ftb-fixture', port: 25565, memoryMb: 12288 }), error => error.status === 409);
  assert.ok(calls.every(call => !call.url.endsWith('/definition') && !call.url.includes('/start') && !call.url.includes('/stop')));
});

test('a legacy FTB profile with insufficient native reserve fails before configuration or start', async () => {
  const calls = [];
  const runtime = new PufferRuntime({ pufferUrl: 'https://runtime.example' }, async (url, options) => {
    calls.push({ url, method: options.method });
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'fixture' });
    if (url.endsWith('/status')) return Response.json({ gameswitchVersion: 1, running: false });
    return Response.json({ run: { environmentVars: { MEMORY: '6400M' } } });
  });
  await assert.rejects(runtime.start({ gameId: 'minecraft', loader: 'ftb', serverId: 'legacy-fixture', port: 25565, memoryMb: 7168, minimumMemoryMb: 6144 }), error => error.status === 400 && /8192 MB/.test(error.message));
  assert.ok(calls.every(call => call.method !== 'PUT' && !call.url.includes('/start') && !call.url.includes('/stop')));
});

test('the next stopped FTB start updates only resource settings and preserves pack/world settings', async () => {
  const calls = []; let running = false;
  const original = {
    run: { environmentVars: { MEMORY: '9472M', FTB_MODPACK_ID: '135', FTB_MODPACK_VERSION_ID: '100614', LEVEL: 'existing-world', CUSTOM_SETTING: 'unchanged' } },
    environment: { hostConfig: { Memory: 10 * 1024 ** 3, MemorySwap: 10 * 1024 ** 3, NanoCpus: 6_000_000_000, CapDrop: ['ALL'] }, config: { User: '1000:1000' } },
  };
  const runtime = new PufferRuntime({ pufferUrl: 'https://runtime.example', cpuCores: 8 }, async (url, options) => {
    calls.push({ url, ...options });
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'fixture' });
    if (url.endsWith('/status')) return Response.json({ gameswitchVersion: 1, running });
    if (url.endsWith('/definition') && options.method === 'GET') return Response.json(original);
    if (url.includes('/start?')) running = true;
    return new Response(null, { status: 204 });
  });
  await runtime.start({ gameId: 'minecraft', loader: 'ftb', serverId: 'ftb-fixture', port: 25565, memoryMb: 12288, recommendedMemoryMb: 8192 });
  const definition = JSON.parse(calls.find(call => call.url.endsWith('/definition') && call.method === 'PUT').body);
  assert.equal(definition.environment.hostConfig.Memory, 12 * 1024 ** 3);
  assert.equal(definition.environment.hostConfig.NanoCpus, 8_000_000_000);
  assert.equal(definition.run.environmentVars.MAX_MEMORY, '8192M');
  assert.equal(definition.run.environmentVars.LEVEL, 'existing-world');
  assert.equal(definition.run.environmentVars.FTB_MODPACK_VERSION_ID, '100614');
  assert.equal(definition.run.environmentVars.CUSTOM_SETTING, 'unchanged');
  assert.deepEqual(definition.environment.hostConfig.CapDrop, ['ALL']);
  assert.equal(calls.filter(call => call.url.includes('/start?')).length, 1);
  assert.ok(calls.every(call => !call.url.includes('/stop') && !call.url.includes('/install')));
});
