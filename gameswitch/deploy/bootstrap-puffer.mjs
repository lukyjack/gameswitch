// Run on the Linux VPS as root after the patched loopback-only PufferPanel starts.
// No credentials appear in argv/stdout. A temporary root-only checkpoint allows
// resuming a failed API connection without creating another administrative user.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export function parseEnv(content) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const value = match[2];
    result[match[1]] = value.startsWith('"') && value.endsWith('"') ? JSON.parse(value) : value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value;
  }
  return result;
}

function serializeEnv(values) {
  return Object.entries(values).map(([key, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n\x00]/.test(String(value))) throw new Error('Environment value is not a single line');
    return `${key}=${JSON.stringify(String(value))}`;
  }).join('\n') + '\n';
}

async function writePrivate(file, content) {
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temporary, file);
  await fs.chmod(file, 0o600);
}

export function runPuffer(binary, args, input, user) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/sbin/runuser', ['--user', user, '--', binary, ...args], { stdio: ['pipe', 'ignore', 'ignore'], env: { ...process.env, NO_COLOR: '1' } });
    const timeout = setTimeout(() => child.kill('SIGTERM'), 60000);
    child.once('error', () => { clearTimeout(timeout); reject(new Error('Unable to start PufferPanel bootstrap CLI')); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('PufferPanel bootstrap CLI failed; inspect its database and configuration')); });
  });
}

export async function bootstrapPuffer(options = {}) {
  const url = new URL(options.url || 'http://127.0.0.1:8080');
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Bootstrap only supports a literal loopback PufferPanel URL');
  const envFile = path.resolve(options.envFile || '/etc/gameswitch/gameswitch.env');
  const pendingFile = `${envFile}.bootstrap-pending.json`;
  const fetcher = options.fetcher || fetch;
  const command = options.runCommand || runPuffer;
  // The daemon opens HTTP only after database migration. Never invoke the CLI
  // against a half-initialized database merely because the service was launched.
  const readyDeadline = Date.now() + (options.readyTimeoutMs ?? 60000);
  let ready = false;
  do {
    try {
      const response = await fetcher(`${url.origin}/api/config`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(Math.min(3000, Math.max(1, readyDeadline - Date.now()))) });
      if (response.ok) {
        const data = await response.json();
        ready = typeof data.branding?.name === 'string' && typeof data.registrationEnabled === 'boolean';
      }
    } catch { /* Startup may still be migrating; retry without logging secrets. */ }
    if (!ready && Date.now() < readyDeadline) await delay(Math.min(options.readyIntervalMs ?? 1000, Math.max(1, readyDeadline - Date.now())));
  } while (!ready && Date.now() < readyDeadline);
  if (!ready) throw new Error('PufferPanel did not become ready; database user creation was not attempted');
  await fs.mkdir(path.dirname(envFile), { recursive: true, mode: 0o700 });
  let env = {};
  try { env = parseEnv(await fs.readFile(envFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const post = async (endpoint, body, cookie, form = false) => {
    const response = await fetcher(`${url.origin}${endpoint}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: form ? new URLSearchParams(body) : JSON.stringify(body) });
    if (!response.ok) throw new Error(`PufferPanel bootstrap API failed at ${endpoint} (${response.status})`);
    return response;
  };
  const verify = async (clientId, clientSecret) => {
    const response = await post('/oauth2/token', { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }, null, true);
    const data = await response.json();
    if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('PufferPanel did not issue a usable OAuth token');
  };
  if (env.PUFFERPANEL_CLIENT_ID && env.PUFFERPANEL_CLIENT_SECRET) {
    await verify(env.PUFFERPANEL_CLIENT_ID, env.PUFFERPANEL_CLIENT_SECRET);
    env.RUNTIME_MODE = 'pufferpanel'; env.PUFFERPANEL_URL = url.origin;
    await writePrivate(envFile, serializeEnv(env));
    await fs.rm(pendingFile, { force: true });
    return { reused: true, verified: true, envFile };
  }
  let pending;
  try { pending = JSON.parse(await fs.readFile(pendingFile, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const suffix = randomBytes(6).toString('hex');
    pending = { username: `gameswitch-${suffix}`, email: `gameswitch-${suffix}@localhost.invalid`, password: randomBytes(36).toString('base64url'), created: false };
    await writePrivate(pendingFile, JSON.stringify(pending));
  }
  if (!pending.created) {
    await command(options.binary || '/usr/local/bin/pufferpanel', ['--config', options.config || '/etc/pufferpanel/config.json', '--workDir', options.workDir || '/var/lib/pufferpanel', 'user', 'add', '--name', pending.username, '--email', pending.email, '--admin', '--password-stdin'], `${pending.password}\n`, options.user || 'pufferpanel');
    pending.created = true;
    await writePrivate(pendingFile, JSON.stringify(pending));
  }
  const login = await post('/auth/login', { email: pending.email, password: pending.password });
  const data = await login.json();
  if (data.needsSecondFactor) throw new Error('Bootstrap account unexpectedly requires second-factor authentication');
  const cookie = login.headers.getSetCookie().find(value => value.startsWith('puffer_auth='))?.split(';')[0];
  if (!cookie) throw new Error('PufferPanel login did not provide an authentication cookie');
  const clientResponse = await post('/api/self/oauth2', { name: 'GameSwitch controller', description: 'Dedicated local single-node GameSwitch runtime client' }, cookie);
  const client = await clientResponse.json();
  if (typeof client.client_id !== 'string' || typeof client.client_secret !== 'string' || !client.client_secret) throw new Error('PufferPanel returned an invalid OAuth client');
  env.RUNTIME_MODE = 'pufferpanel';
  env.PUFFERPANEL_URL = url.origin;
  env.PUFFERPANEL_CLIENT_ID = client.client_id;
  env.PUFFERPANEL_CLIENT_SECRET = client.client_secret;
  env.PUFFERPANEL_NODE_ID ||= '0';
  // Save before verification so a network interruption cannot lose the only copy
  // of an already-created client secret. A rerun verifies and reuses it.
  await writePrivate(envFile, serializeEnv(env));
  await verify(client.client_id, client.client_secret);
  await fs.rm(pendingFile, { force: true });
  try { await post('/auth/logout', {}, cookie); } catch { /* Server-side session expires shortly; bootstrap result remains valid. */ }
  return { reused: false, verified: true, envFile };
}

async function main() {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('Run this bootstrap helper as root on the Linux VPS');
  const args = process.argv.slice(2);
  const flags = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--url', '--env-file', '--binary', '--config', '--work-dir', '--user'].includes(args[index]) || !args[index + 1]) throw new Error('Invalid bootstrap arguments');
    flags[args[index]] = args[index + 1];
  }
  const result = await bootstrapPuffer({ url: flags['--url'], envFile: flags['--env-file'], binary: flags['--binary'], config: flags['--config'], workDir: flags['--work-dir'], user: flags['--user'] });
  console.log(JSON.stringify({ verified: result.verified, reused: result.reused, envFile: result.envFile, credentialsPrinted: false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
