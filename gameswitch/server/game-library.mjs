import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export const libraryGames = new Set(['arma3', 'dayz']);
const apps = { arma3: '233780', dayz: '223350' };
const workshopId = /^[1-9][0-9]{4,19}$/;
const trusted = stat => process.platform === 'win32' || (stat.uid === 0 && !(stat.mode & 0o022));

export async function gameLibraryStatus(config, gameId) {
  if (!libraryGames.has(gameId)) throw new Error('Unknown managed library');
  if (config.mode === 'sandbox') return { ready: true, simulated: true, reason: 'Sandbox: Serverdateien werden simuliert.', workshopIds: [] };
  const directory = path.join(config.gameLibraryDir || '/var/lib/gameswitch-libraries', gameId);
  let handle;
  try {
    try {
      await fs.lstat(path.join(path.dirname(directory), '.preparing'));
      return { ready: false, reason: 'Die Steam-Bibliothek wird gerade vorbereitet. Laufende Spiele bleiben aktiv.', workshopIds: [] };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const dir of [path.dirname(directory), directory]) {
      const stat = await fs.lstat(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.uid !== 0 || (stat.mode & 0o022)))) throw new Error('Untrusted library directory');
    }
    handle = await fs.open(path.join(directory, 'manifest.json'), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 16384 || (process.platform !== 'win32' && (stat.uid !== 0 || (stat.mode & 0o022)))) throw new Error('Untrusted library manifest');
    const buffer = Buffer.alloc(16385);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 16384) throw new Error('Manifest too large');
    const manifest = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    if (manifest.schema !== 1 || manifest.gameId !== gameId || manifest.appId !== apps[gameId] || manifest.ready !== true || !Array.isArray(manifest.workshopIds) || manifest.workshopIds.length > 30 || !manifest.workshopIds.every(id => typeof id === 'string' && workshopId.test(id)) || new Set(manifest.workshopIds).size !== manifest.workshopIds.length) throw new Error('Invalid library manifest');
    const binary = path.join(directory, 'server', gameId === 'arma3' ? 'arma3server_x64' : 'DayZServer');
    const serverDirectory = await fs.lstat(path.join(directory, 'server'));
    if (!serverDirectory.isDirectory() || serverDirectory.isSymbolicLink() || !trusted(serverDirectory)) throw new Error('Untrusted library server path');
    const binaryStat = await fs.lstat(binary);
    if (!binaryStat.isFile() || binaryStat.isSymbolicLink() || !binaryStat.size || binaryStat.nlink !== 1 || !trusted(binaryStat) || (process.platform !== 'win32' && !(binaryStat.mode & 0o111))) throw new Error('Missing or untrusted native server binary');
    if (manifest.workshopIds.length) {
      const modsDirectory = await fs.lstat(path.join(directory, 'mods'));
      if (!modsDirectory.isDirectory() || modsDirectory.isSymbolicLink() || !trusted(modsDirectory)) throw new Error('Untrusted workshop path');
      for (const id of manifest.workshopIds) {
        const mod = await fs.lstat(path.join(directory, 'mods', id));
        if (!mod.isDirectory() || mod.isSymbolicLink() || !trusted(mod)) throw new Error('Missing prepared Workshop directory');
      }
    }
    return { ready: true, reason: 'Serverdateien vorbereitet; der erste native Spielstart wird gesondert geprüft.', workshopIds: manifest.workshopIds, updatedAt: typeof manifest.updatedAt === 'string' && !Number.isNaN(Date.parse(manifest.updatedAt)) ? manifest.updatedAt : undefined };
  } catch {
    return { ready: false, reason: 'Steam-Einrichtung erforderlich. Serverdateien zuerst über den Button „Steam einrichten“ vorbereiten.', workshopIds: [] };
  } finally { await handle?.close(); }
}

export async function requireGameLibrary(config, profile) {
  if (!libraryGames.has(profile.gameId)) return;
  const status = await gameLibraryStatus(config, profile.gameId);
  if (!status.ready) throw Object.assign(new Error(status.reason), { status: 409, diagnosticReason: 'steam_library_required' });
  if (!status.simulated && (profile.workshopIds || []).some(id => !status.workshopIds.includes(id))) throw Object.assign(new Error('Ausgewählte Workshop-Mods müssen zuerst in der geschützten Steam-Bibliothek vorbereitet werden.'), { status: 409, diagnosticReason: 'steam_mods_required' });
}
