import test from 'node:test';
import assert from 'node:assert/strict';
import { PufferRuntime } from '../server/runtime.mjs';

test('concurrent PufferPanel statuses share OAuth and can retry after failed authentication', async () => {
  const statuses = [];
  let authCalls = 0;
  const runtime = new PufferRuntime({ pufferUrl: 'https://runtime.example' }, async (url, options) => {
    if (url.endsWith('/oauth2/token')) {
      authCalls++;
      if (authCalls === 1) return new Response(null, { status: 503 });
      return Response.json({ access_token: 'fixture' });
    }
    assert.equal(options.headers.Authorization, 'Bearer fixture');
    statuses.push(new URL(url).pathname);
    return Response.json({ gameswitchVersion: 1, running: true });
  });
  const profiles = [{ serverId: 'first', installed: true }, { serverId: 'second', installed: true }];
  const firstAttempt = await Promise.allSettled(profiles.map(profile => runtime.status(profile)));
  assert.ok(firstAttempt.every(result => result.status === 'rejected'));
  assert.equal(authCalls, 1);
  assert.deepEqual(statuses, []);
  assert.ok((await Promise.all(profiles.map(profile => runtime.status(profile)))).every(status => status.running));
  assert.equal(authCalls, 2);
  assert.deepEqual(statuses.sort(), ['/api/servers/first/status', '/api/servers/second/status']);
});

test('PufferPanel install leaves a running target alone after an interrupted or external start', async () => {
  const calls = [];
  const runtime = new PufferRuntime({});
  runtime.request = async endpoint => {
    calls.push(endpoint);
    if (endpoint.endsWith('/status')) return { gameswitchVersion: 1, running: true };
    return {};
  };
  await assert.rejects(runtime.install({ gameId: 'minecraft', serverId: 'existing', installed: false }), error => error.status === 409);
  assert.deepEqual(calls, ['/api/servers/existing', '/api/servers/existing/status']);
});
