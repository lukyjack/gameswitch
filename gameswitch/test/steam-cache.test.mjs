import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRootSteamCache, validateSteamCacheEntries } from '../server/steam-cache.mjs';

const directory = { name: '.steam', isFile: false };
const cache = [{ name: '..', isFile: false }, { name: 'root', isFile: true }, { name: 'steam', isFile: true }];
const refuses = fn => assert.throws(fn, error => error.status === 409);

test('Steam cache root guard distinguishes absence from an observed normal directory', () => {
  assert.equal(validateRootSteamCache([]), 'absent');
  assert.equal(validateRootSteamCache([{ name: 'garrysmod', isFile: false }, { name: 'srcds_run', isFile: true, size: 42, modifyTime: 1700000000 }]), 'absent');
  assert.equal(validateRootSteamCache([directory]), 'directory');
  assert.equal(validateRootSteamCache([{ name: 'garrysmod', isFile: false }, directory, { name: 'server.cfg', isFile: true, extension: '.cfg' }]), 'directory');
  assert.equal(validateRootSteamCache([{ name: '.Steam', isFile: false }]), 'absent');
});

test('Steam cache entry guard accepts only known non-directories and the exact synthetic parent', () => {
  assert.equal(validateSteamCacheEntries(cache), true);
  assert.equal(validateSteamCacheEntries([]), true);
  assert.equal(validateSteamCacheEntries([{ name: '..', isFile: false }]), true);
  assert.equal(validateSteamCacheEntries([{ name: 'steam', isFile: true }]), true);
  assert.equal(validateSteamCacheEntries([{ name: 'root', isFile: true, size: 0 }]), true);
  const before = JSON.stringify(cache);
  validateSteamCacheEntries(cache);
  assert.equal(JSON.stringify(cache), before);
});

test('root symlinks, regular files and ambiguous cache roots are refused', () => {
  for (const entries of [[{ name: '.steam', isFile: true }], [directory, directory], [{ name: '.steam', isFile: 'false' }], [{ name: '.steam' }], [{ name: '.steam', isFile: null }], [{ name: '.steam', isFile: false, type: 'symlink' }], [{ name: '..', isFile: false }, directory]]) refuses(() => validateRootSteamCache(entries));
});

test('unknown cache entries, directories and malformed parent entries are refused', () => {
  for (const entries of [[...cache, { name: 'world', isFile: false }], [...cache, { name: 'config.vdf', isFile: true }], [{ name: 'steam', isFile: false }], [{ name: 'root', isFile: false }], [{ name: '..', isFile: true }], [{ name: '.', isFile: false }], [{ name: 'Steam', isFile: true }], [{ name: 'root', isFile: true }, { name: 'root', isFile: true }], [{ name: 'root', isFile: true, symlink: true }]]) refuses(() => validateSteamCacheEntries(entries));
});

test('listing guards reject path components, control characters and non-boolean directory metadata', () => {
  const malformed = [null, {}, [null], [1], [[]], [{ name: '', isFile: true }], [{ name: 'a/b', isFile: true }], [{ name: 'a\\b', isFile: true }], [{ name: '../world', isFile: true }], [{ name: 'root\n', isFile: true }], [{ name: 'root\u0085', isFile: true }], [{ name: 'root\u2028', isFile: true }], [{ name: '\ud800', isFile: true }], [{ name: 'root', isFile: 1 }], [{ name: 'root', isFile: 'true' }], [{ name: 'root', isFile: true, size: -1 }], [{ name: 'root', isFile: true, size: '0' }], [{ name: 'root', isFile: true, modifyTime: NaN }], [{ name: 'root', isFile: true, extension: '../path' }], [{ name: 'x'.repeat(256), isFile: true }]];
  for (const entries of malformed) {
    refuses(() => validateRootSteamCache(entries));
    refuses(() => validateSteamCacheEntries(entries));
  }
});

test('root and cache listings have independent hard entry limits', () => {
  const atLimit = Array.from({ length: 4096 }, (_, index) => ({ name: `file-${index}`, isFile: true }));
  assert.equal(validateRootSteamCache(atLimit), 'absent');
  refuses(() => validateRootSteamCache([...atLimit, directory]));
  refuses(() => validateSteamCacheEntries(Array.from({ length: 33 }, () => ({ name: 'root', isFile: true }))));
});
