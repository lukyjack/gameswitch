import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { bootstrapPuffer, parseEnv } from '../deploy/bootstrap-puffer.mjs';

test('Puffer bootstrap keeps credentials out of argv and writes only private environment', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-bootstrap-'));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const envFile = path.join(directory, 'gameswitch.env');
  await fs.writeFile(envFile, 'HOST=127.0.0.1\nPUBLIC_ORIGIN="http://127.0.0.1:3001"\nRUNTIME_MODE=sandbox\n');
  const cliCalls = [];
  const apiCalls = [];
  const fake = async (url, options) => {
    apiCalls.push({ url, options });
    if (url.endsWith('/api/config')) return Response.json({ branding: { name: 'PufferPanel' }, registrationEnabled: false });
    if (url.endsWith('/auth/login')) return Response.json({ needsSecondFactor: false }, { headers: { 'Set-Cookie': 'puffer_auth=test-only-cookie; HttpOnly; Path=/' } });
    if (url.endsWith('/api/self/oauth2')) return Response.json({ client_id: 'test-only-client-id', client_secret: 'test-only-secret-abc' });
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'test-only-token' });
    return Response.json({});
  };
  const runCommand = async (binary, args, stdin, user) => { cliCalls.push({ binary, args, stdin, user }); };
  const result = await bootstrapPuffer({ envFile, fetcher: fake, runCommand });
  assert.equal(result.verified, true);
  assert.equal(result.reused, false);
  assert.equal(cliCalls.length, 1);
  assert.ok(cliCalls[0].args.includes('--password-stdin'));
  assert.ok(!cliCalls[0].args.includes('--password'));
  assert.ok(!cliCalls[0].args.join(' ').includes(cliCalls[0].stdin.trim()));
  const login = JSON.parse(apiCalls.find(call => call.url.endsWith('/auth/login')).options.body);
  assert.equal(login.password, cliCalls[0].stdin.trim());
  assert.equal(cliCalls[0].user, 'pufferpanel');
  const env = parseEnv(await fs.readFile(envFile, 'utf8'));
  assert.equal(env.RUNTIME_MODE, 'pufferpanel');
  assert.equal(env.PUFFERPANEL_CLIENT_ID, 'test-only-client-id');
  assert.equal(env.PUFFERPANEL_CLIENT_SECRET, 'test-only-secret-abc');
  assert.equal(env.PUBLIC_ORIGIN, 'http://127.0.0.1:3001');
  assert.ok(!(await fs.readFile(envFile, 'utf8')).includes(login.password));
  await assert.rejects(fs.access(`${envFile}.bootstrap-pending.json`));
  if (process.platform !== 'win32') assert.equal((await fs.stat(envFile)).mode & 0o777, 0o600);
  const resumed = await bootstrapPuffer({ envFile, fetcher: fake, runCommand });
  assert.equal(resumed.reused, true);
  assert.equal(cliCalls.length, 1);
});

test('Puffer bootstrap refuses remote or credential-bearing URLs before filesystem/API use', async () => {
  const fetcher = () => { throw new Error('Must not fetch'); };
  for (const url of ['http://example.test:8080', 'https://127.0.0.1:8080', 'http://user:password@127.0.0.1:8080', 'http://127.0.0.1:8080/other']) await assert.rejects(bootstrapPuffer({ url, fetcher }), /literal loopback/);
});

test('Puffer bootstrap checkpoints safely and resumes failed login without creating another user', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-bootstrap-resume-'));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const envFile = path.join(directory, 'service.env');
  let commands = 0;
  const runCommand = async () => { commands++; };
  await assert.rejects(bootstrapPuffer({ envFile, runCommand, fetcher: async url => url.endsWith('/api/config') ? Response.json({ branding: { name: 'PufferPanel' }, registrationEnabled: false }) : new Response(null, { status: 503 }) }), /503/);
  const pending = JSON.parse(await fs.readFile(`${envFile}.bootstrap-pending.json`, 'utf8'));
  assert.equal(pending.created, true);
  assert.ok(pending.password.length >= 40);
  const fake = async url => {
    if (url.endsWith('/api/config')) return Response.json({ branding: { name: 'PufferPanel' }, registrationEnabled: false });
    if (url.endsWith('/auth/login')) return Response.json({ needsSecondFactor: false }, { headers: { 'Set-Cookie': 'puffer_auth=resumed; HttpOnly' } });
    if (url.endsWith('/api/self/oauth2')) return Response.json({ client_id: 'resumed-client', client_secret: 'resumed-secret' });
    return Response.json({ access_token: 'resumed-token' });
  };
  await bootstrapPuffer({ envFile, runCommand, fetcher: fake });
  assert.equal(commands, 1);
  await assert.rejects(fs.access(`${envFile}.bootstrap-pending.json`));
});

test('Puffer bootstrap waits for initialized HTTP API before attempting user creation', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-bootstrap-ready-'));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const envFile = path.join(directory, 'service.env');
  let commands = 0; let attempts = 0;
  await assert.rejects(bootstrapPuffer({ envFile, readyTimeoutMs: 15, readyIntervalMs: 2, runCommand: async () => { commands++; }, fetcher: async () => { attempts++; return new Response(null, { status: 503 }); } }), /did not become ready/);
  assert.ok(attempts >= 1); // The timeout may elapse within one attempt on a busy scheduler.
  assert.equal(commands, 0);
  await assert.rejects(fs.access(`${envFile}.bootstrap-pending.json`));
});

test('Puffer bootstrap retains created=false when the CLI reports a database failure', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-bootstrap-cli-failed-'));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const envFile = path.join(directory, 'service.env');
  await assert.rejects(bootstrapPuffer({ envFile, runCommand: async () => { throw new Error('CLI database transaction failed'); }, fetcher: async () => Response.json({ branding: { name: 'PufferPanel' }, registrationEnabled: false }) }), /transaction failed/);
  const pending = JSON.parse(await fs.readFile(`${envFile}.bootstrap-pending.json`, 'utf8'));
  assert.equal(pending.created, false);
});
