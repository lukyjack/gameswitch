import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const secretSchema = z.object({
  serverPassword: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  rconPassword: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict();
const profileId = /^(?:[a-f0-9]{16,64}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i;

function location(config, id) {
  if (typeof id !== 'string' || !profileId.test(id)) throw Object.assign(new Error('Ungültige Profil-ID für den Geheimnisspeicher.'), { status: 400 });
  const directory = path.join(config.dataDir, 'profile-secrets');
  return { directory, file: path.join(directory, `${id.toLowerCase()}.json`) };
}

export async function readProfileSecrets(config, id) {
  const { directory, file } = location(config, id);
  let handle;
  try {
    const dir = await fs.lstat(directory);
    if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error('Unsicheres Geheimnisverzeichnis.');
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 4096 || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw new Error('Unsichere oder zu große Geheimnisdatei.');
    const buffer = Buffer.alloc(4097); let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 4096) throw new Error('Geheimnisdatei ist zu groß.');
    return secretSchema.parse(JSON.parse(buffer.subarray(0, length).toString('utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  } finally { await handle?.close(); }
}

export async function getProfileSecretFlags(config, id) {
  const secrets = await readProfileSecrets(config, id);
  return { serverPasswordSet: Boolean(secrets.serverPassword), rconPasswordSet: Boolean(secrets.rconPassword) };
}

export async function writeProfileSecrets(config, id, patch) {
  const validated = secretSchema.parse(patch);
  const { directory, file } = location(config, id);
  const merged = secretSchema.parse({ ...await readProfileSecrets(config, id), ...validated });
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const dir = await fs.lstat(directory);
  if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error('Unsicheres Geheimnisverzeichnis.');
  await fs.chmod(directory, 0o700);
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(merged));
    await handle.sync();
    await handle.close(); handle = null;
    await fs.rename(temporary, file);
    await fs.chmod(file, 0o600);
  } finally { await handle?.close(); await fs.rm(temporary, { force: true }); }
  return { serverPasswordSet: Boolean(merged.serverPassword), rconPasswordSet: Boolean(merged.rconPassword) };
}
