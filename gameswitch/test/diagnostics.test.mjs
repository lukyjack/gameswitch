import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDiagnostics, classifyUpstreamError, upstreamFailure, friendlyDiagnosticMessage } from '../server/diagnostics.mjs';
import { PufferRuntime } from '../server/runtime.mjs';
import { openStore } from '../server/store.mjs';
import { Controller } from '../server/controller.mjs';

test('private diagnostics allowlists fields and never serializes messages, causes, credentials or arbitrary context', () => {
  const output = [];
  const logger = createDiagnostics({ write: line => output.push(line) });
  const requestId = randomUUID(), jobId = randomUUID(), profileId = randomUUID();
  const error = Object.assign(new Error('SECRET_PASSWORD PRIVATE_TOKEN Steam_76561197960265729 command /op SecretPlayer'), {
    cause: { message: 'PRIVATE_CAUSE', code: 'EACCES', password: 'PRIVATE_PASSWORD' },
    responseHash: 'a'.repeat(64), upstreamStatus: 500, diagnosticReason: 'permission_denied', body: 'PRIVATE_BODY',
  });
  error.stack = 'Error: SECRET_MESSAGE\n at SECRET_FUNCTION (/srv/PRIVATE_PATH/server/runtime.mjs:123:45)\n at SECRET_EXTRA (/other/private.mjs:1:2)\n at SECRET_FUNCTION (/server/controller.mjs:67:89)';
  assert.equal(logger.error(error, { requestId, jobId, profileId, gameId: 'minecraft', operation: 'activate', stage: 'Sicherung abschließen', status: 'failed', body: 'PRIVATE_CONTEXT', command: 'op SecretPlayer', steamId: '76561197960265729', headers: { Authorization: 'PRIVATE_HEADER' } }), requestId);
  const record = JSON.parse(output[0]);
  assert.equal(record.requestId, requestId); assert.equal(record.errorId, requestId); assert.equal(record.jobId, jobId); assert.equal(record.profileId, profileId);
  assert.equal(record.reason, 'permission_denied'); assert.equal(record.code, 'EACCES');
  assert.deepEqual(record.frames, ['runtime.mjs:123:45', 'controller.mjs:67:89']);
  for (const secret of ['SECRET_', 'PRIVATE_', '76561197960265729', 'SecretPlayer']) assert.ok(!output[0].includes(secret), secret);
  for (const key of ['message', 'stack', 'cause', 'body', 'headers', 'command', 'steamId']) assert.equal(record[key], undefined);
  logger.error(Object.assign(new Error('hidden'), { diagnosticReason: 'SECRET_REASON', name: 'SECRET_CLASS', code: 'SECRET_CODE' }), { requestId: 'SECRET_ID', profileId: '76561197960265729', sourceProfileId: '76561197960265729', gameId: 'SECRET_GAME', operation: 'SECRET_OPERATION', stage: 'SECRET_STAGE' });
  assert.ok(!output[1].includes('SECRET_'));
  assert.ok(!output[1].includes('76561197960265729'));
});

test('sync or async diagnostic writer failure and hostile getters cannot cause application failures', async () => {
  const hostile = Object.defineProperty({}, 'stack', { get() { throw new Error('private getter'); } });
  for (const write of [() => { throw new Error('Sink failed'); }, async () => { throw new Error('Async sink failed'); }]) {
    assert.match(createDiagnostics({ write }).error(hostile), /^[a-f0-9-]{36}$/);
  }
  await new Promise(resolve => setImmediate(resolve));
});

test('upstream failure caps content, classifies fixed reasons, hashes only and maps runtime authentication to 502', async () => {
  const secret = 'PRIVATE_PASSWORD';
  const error = await upstreamFailure(Response.json({ msg: 'backup contains unsupported symbolic or hard links ' + secret }, { status: 500 }), 'backup');
  assert.equal(error.diagnosticReason, 'backup_unsafe_links'); assert.equal(error.upstreamStatus, 500); assert.equal(error.upstreamOperation, 'backup');
  assert.match(error.responseHash, /^[a-f0-9]{64}$/); assert.ok(!JSON.stringify(error).includes(secret)); assert.ok(!error.message.includes(secret));
  assert.match(friendlyDiagnosticMessage(error), /Steam-Cache/);
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('X'.repeat(30000) + secret)); }, cancel() { cancelled = true; } }), { status: 500 });
  const bounded = await upstreamFailure(response);
  assert.equal(cancelled, true); assert.equal(bounded.responseTruncated, true); assert.ok(!JSON.stringify(bounded).includes(secret));
  assert.equal(classifyUpstreamError('{"message":"ENOSPC no space left"}', 500), 'disk_full');
  assert.equal(classifyUpstreamError('permission denied', 500), 'permission_denied');
  const unauthorized = await upstreamFailure(Response.json({ error: 'invalid_client' }, { status: 401 }), 'oauth');
  assert.equal(unauthorized.status, 502); assert.equal(unauthorized.upstreamStatus, 401);
  assert.equal((await upstreamFailure(new Response('', { status: 404 }))).status, 404);
});

test('Puffer request sanitizes upstream JSON and network errors without retaining credentials or response text', async () => {
  const runtime = new PufferRuntime({ pufferUrl: 'http://127.0.0.1:8080', clientId: 'PRIVATE_ID', clientSecret: 'PRIVATE_SECRET' }, async url => url.endsWith('/oauth2/token') ? Response.json({ access_token: 'PRIVATE_ACCESS', expires_in: 300 }) : Response.json({ message: 'permission denied PRIVATE_BODY' }, { status: 500 }));
  await assert.rejects(runtime.request('/api/servers/internal/backup/create?name=PRIVATE_NAME', { method: 'POST' }), error => {
    assert.equal(error.diagnosticReason, 'permission_denied'); assert.equal(error.upstreamOperation, 'backup');
    assert.ok(!JSON.stringify(error).includes('PRIVATE_')); return true;
  });
  runtime.fetcher = async () => new Response('INVALID_PRIVATE_RESPONSE', { status: 200 });
  await assert.rejects(runtime.request('/api/servers/internal/status'), error => error.diagnosticReason === 'invalid_upstream_response' && !error.message.includes('PRIVATE'));
  runtime.fetcher = async () => { throw Object.assign(new Error('PRIVATE_URL'), { cause: { code: 'ECONNREFUSED', message: 'PRIVATE_CAUSE' } }); };
  await assert.rejects(runtime.request('/api/servers/internal/status'), error => error.diagnosticReason === 'network_unavailable' && error.code === 'ECONNREFUSED' && !JSON.stringify(error).includes('PRIVATE'));
  const oauth = new PufferRuntime(runtime.config, async () => Response.json({ error: 'invalid_client', private: 'PRIVATE_SECRET' }, { status: 403 }));
  await assert.rejects(oauth.authorize(), error => error.status === 502 && error.upstreamStatus === 403 && error.diagnosticReason === 'upstream_auth');
});

test('controller persists correlated friendly errors with failed backup stage and never automatically starts', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-diagnostics-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = await openStore(directory);
  const old = { id: randomUUID(), name: 'Vorherige Welt', gameId: 'gmod', installed: true, status: 'running' };
  const target = { id: randomUUID(), name: 'Minecraft', gameId: 'minecraft', installed: true, status: 'stopped' };
  store.state.profiles.push(old, target);
  let running = old.id, starts = 0;
  const runtime = { status: async profile => ({ running: running === profile.id }), save: async () => {}, stop: async () => { running = null; }, backup: async () => { throw Object.assign(new Error('PRIVATE_BODY walking root symlink'), { diagnosticReason: 'backup_unsafe_links', upstreamStatus: 500, responseHash: 'b'.repeat(64) }); }, start: async () => { starts++; } };
  const output = [];
  const controller = new Controller(store, runtime, createDiagnostics({ write: line => output.push(line) }));
  const requestId = randomUUID();
  controller.begin('activate', target.id, undefined, { requestId }); await controller.pending;
  assert.equal(starts, 0); assert.equal(store.state.job.status, 'failed'); assert.equal(store.state.job.errorId, requestId);
  assert.match(store.state.job.error, /Steam-Cache/); assert.ok(store.state.job.error.includes(requestId));
  assert.ok(!JSON.stringify(store.state).includes('PRIVATE_')); assert.equal(store.state.pendingSafetyBackupProfileId, old.id);
  const record = JSON.parse(output[0]);
  assert.equal(record.stage, 'Sicherung abschließen'); assert.equal(record.sourceProfileId, old.id); assert.equal(record.profileId, target.id);
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8')).job.errorId, requestId);
  const throwing = new Controller(store, runtime, { error() { throw new Error('Logging failed'); } });
  throwing.begin('activate', target.id); await throwing.pending;
  assert.equal(throwing.busy, false); assert.equal(store.state.job.status, 'failed'); assert.match(store.state.job.errorId, /^[a-f0-9-]{36}$/);
});
