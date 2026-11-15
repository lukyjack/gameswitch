const metadataFields = new Set(['name', 'isFile', 'size', 'modifyTime', 'extension']);
const unsafeName = /[\/\\\x00-\x1f\x7f-\x9f\u2028\u2029]/u;

function refuse() {
  throw Object.assign(new Error('Der Steam-Cache hat eine unerwartete Struktur und wurde nicht verändert. Bitte die vorhandenen Dateien prüfen.'), { status: 409 });
}

function listing(entries, maximum, allowParent) {
  if (!Array.isArray(entries) || entries.length > maximum) refuse();
  const names = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) refuse();
    if (Object.keys(entry).some(key => !metadataFields.has(key))) refuse();
    const { name, isFile } = entry;
    if (typeof name !== 'string' || !name || name.length > 255 || !name.isWellFormed() || unsafeName.test(name) || name === '.' || (name === '..' && !allowParent) || typeof isFile !== 'boolean' || names.has(name)) refuse();
    if (entry.size !== undefined && (!Number.isSafeInteger(entry.size) || entry.size < 0)) refuse();
    if (entry.modifyTime !== undefined && !Number.isSafeInteger(entry.modifyTime)) refuse();
    if (entry.extension !== undefined && (typeof entry.extension !== 'string' || entry.extension.length > 255 || unsafeName.test(entry.extension))) refuse();
    names.add(name);
  }
  return entries;
}

// PufferPanel's directory listing uses DirEntry.IsDir without following links:
// a root-level .steam symlink therefore has isFile=true and must be refused.
// This proves the observed shape only; the caller must keep the game stopped,
// reserve the lifecycle gate, and refresh the root listing before deletion.
export function validateRootSteamCache(rootEntries) {
  const entries = listing(rootEntries, 4096, false);
  const cache = entries.find(entry => entry.name === '.steam');
  if (!cache) return 'absent';
  if (cache.isFile !== false) refuse();
  return 'directory';
}

// The API does not expose a separate symlink flag. These are bounded known cache
// names and non-directory entries, not a claim that their link targets were read.
export function validateSteamCacheEntries(cacheEntries) {
  const entries = listing(cacheEntries, 32, true);
  for (const entry of entries) {
    if (entry.name === '..' && entry.isFile === false) continue;
    if (!['steam', 'root'].includes(entry.name) || entry.isFile !== true) refuse();
  }
  return true;
}
