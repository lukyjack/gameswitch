import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSteamId, buildAdminAction, mergeAdminFile } from '../server/game-admin.mjs';

const steamId = 'STEAM_0:1:123456';
const steamId64 = '76561197960512641';
const other = '76561198000000000';
const group = 'Group=GameSwitch_Admin:changemap,balance,chat,kick,ban,cameraman,pause';
const action = (gameId, role = 'admin', id = steamId) => buildAdminAction({ gameId }, { steamId: id, role });
const invalid = fn => assert.throws(fn, error => error.status === 400);

test('Steam identity conversion uses exact integers and canonicalizes public SteamID2 universes', () => {
  assert.deepEqual(canonicalSteamId(steamId), { steamId2: steamId, steamId64 });
  assert.deepEqual(canonicalSteamId(steamId64), { steamId2: steamId, steamId64 });
  assert.deepEqual(canonicalSteamId('STEAM_1:1:123456'), { steamId2: steamId, steamId64 });
  assert.equal(canonicalSteamId('76561197960265729').steamId2, 'STEAM_0:1:0');
  assert.equal(canonicalSteamId('76561202255233023').steamId2, 'STEAM_0:1:2147483647');
});

test('Steam identity validation rejects invalid account types, zero, overflow and injected text', () => {
  for (const value of [null, 76561197960512641, {}, '', ' 76561197960512641', '76561197960512641\n', '076561197960512641', '76561197960265728', '76561197960265727', '76561202255233024', '76561197960512641;quit', 'STEAM_0:0:0', 'STEAM_2:1:123456', 'STEAM_0:2:123456', 'STEAM_0:0:2147483648', 'STEAM_0:1:0123456', 'STEAM_0:1:123456\rquit', 'STEAM_0:1:123456"', 'STEAM_0:1:123456\u0085']) invalid(() => canonicalSteamId(value));
});

test('GMod helper produces only fixed native ULX commands, with removeuserid for user', () => {
  assert.equal(action('gmod').command, `ulx adduserid ${steamId} admin`);
  assert.equal(action('gmod', 'superadmin', steamId64).command, `ulx adduserid ${steamId} superadmin`);
  assert.equal(action('gmod', 'user').command, `ulx removeuserid ${steamId}`);
  assert.equal(action('gmod').requires, 'ulx');
  assert.equal(action('gmod').kind, 'command');
});

test('Admin action schema rejects unknown games, unsupported roles and arbitrary code or paths', () => {
  for (const gameId of ['minecraft', 'unknown', undefined]) invalid(() => action(gameId));
  for (const gameId of ['valheim', 'squad']) invalid(() => action(gameId, 'superadmin'));
  for (const input of [{ steamId, role: 'owner' }, { steamId, role: 'admin;quit' }, { steamId, role: 'admin', command: 'quit' }, { steamId, role: 'admin', path: '../x' }, { steamId, role: 'admin', gameId: 'gmod' }, { steamId }, null]) invalid(() => buildAdminAction({ gameId: 'gmod' }, input));
  assert.equal(action('valheim').path, 'saves/adminlist.txt');
  assert.equal(action('valheim').identity, `Steam_${steamId64}`);
  assert.equal(action('squad').path, 'SquadGame/ServerConfig/Admins.cfg');
  assert.equal(action('squad').identity, steamId64);
});

test('Valheim merge preserves unrelated identities, comments, BOM and CRLF; target is canonical and unique', () => {
  const original = `\uFEFF// Spieler\r\nSteam_${other}\r\nPlayFab_ABCDEF123456\r\n${steamId64} // Alt\r\nSteam_${steamId64} // Zweiter Eintrag\r\n`;
  const merged = mergeAdminFile(action('valheim'), original);
  assert.equal(merged, `\uFEFF// Spieler\r\nSteam_${other}\r\nPlayFab_ABCDEF123456\r\nSteam_${steamId64} // Alt\r\n// Zweiter Eintrag\r\n`);
  assert.equal(mergeAdminFile(action('valheim'), merged), merged);
});

test('Valheim demotion removes only the requested Steam account and retains its comments', () => {
  const original = `// Liste\nSteam_${steamId64} // Freunde\n${steamId64}\nSteam_${other}\nPlayFab_ABCDEF123456\n`;
  const merged = mergeAdminFile(action('valheim', 'user'), original);
  assert.equal(merged, `// Liste\n// Freunde\nSteam_${other}\nPlayFab_ABCDEF123456\n`);
  assert.equal(mergeAdminFile(action('valheim', 'user'), merged), merged);
  assert.equal(mergeAdminFile(action('valheim', 'user'), '// Leer'), '// Leer');
  assert.equal(mergeAdminFile(action('valheim'), '// Leer'), `// Leer\nSteam_${steamId64}\n`);
});

test('Squad merge adds bounded managed rights before assignments without changing existing groups or admins', () => {
  const original = `// Konfiguration\r\nGroup=Owner:cheat,config,manageserver\r\nAdmin=${other}:Owner // Besitzer\r\nAdmin=${steamId64}:Owner // Externe Rechte\r\n`;
  const merged = mergeAdminFile(action('squad'), original);
  assert.equal(merged, `// Konfiguration\r\nGroup=Owner:cheat,config,manageserver\r\n${group}\r\nAdmin=${other}:Owner // Besitzer\r\nAdmin=${steamId64}:Owner // Externe Rechte\r\nAdmin=${steamId64}:GameSwitch_Admin\r\n`);
  assert.equal(mergeAdminFile(action('squad'), merged), merged);
  const managedRights = merged.split('\r\n').find(line => line.startsWith('Group=GameSwitch_Admin:'));
  assert.doesNotMatch(managedRights, /cheat|config|manageserver|private|featuretest/u);
});

test('Squad demotion and deduplication affect only target managed assignments, preserving other permissions', () => {
  const original = `${group}\nGroup=Owner:config\nAdmin=${steamId64}:Owner // Unverwaltet\nAdmin=${steamId64}:GameSwitch_Admin // Panel\nAdmin=${steamId64}:GameSwitch_Admin // Doppelt\nAdmin=${other}:GameSwitch_Admin\nAdmin=0123456789abcdef0123456789abcdef:Owner // EOS\n`;
  const granted = mergeAdminFile(action('squad'), original);
  assert.equal(granted.match(new RegExp(`Admin=${steamId64}:GameSwitch_Admin`, 'g')).length, 1);
  assert.ok(granted.includes('// Doppelt\n'));
  const demoted = mergeAdminFile(action('squad', 'user'), original);
  assert.ok(demoted.includes(`Admin=${steamId64}:Owner // Unverwaltet\n`));
  assert.ok(demoted.includes(`Admin=${other}:GameSwitch_Admin\n`));
  assert.ok(demoted.includes('Admin=0123456789abcdef0123456789abcdef:Owner // EOS\n'));
  assert.ok(demoted.includes('// Panel\n// Doppelt\n'));
  assert.ok(!demoted.includes(`Admin=${steamId64}:GameSwitch_Admin`));
  assert.equal(mergeAdminFile(action('squad', 'user'), demoted), demoted);
});

test('Malformed or conflicting permission files fail closed without clobbering existing rights', () => {
  for (const original of ['Steam_not-a-steamid\n', 'Steam_76561197960265728\n', 'invalid line\n', 'Steam_76561197960512641;quit\n']) invalid(() => mergeAdminFile(action('valheim'), original));
  for (const original of ['exec malicious\n', 'Admin=not-an-id:Owner\n', 'Group=Owner:config\nGroup=Owner:cheat\n', 'Group=Owner:config\nGroup=owner:cheat\n', 'Group=Owner:config,config\n', 'Group=GameSwitch_Admin:cheat\n', 'Group=gameswitch_admin:cheat\n', `Admin=${steamId64}:GameSwitch_Admin\n`, `${group}\nAdmin=${steamId64}:gameswitch_admin\n`, 'Group=Owner:\n']) invalid(() => mergeAdminFile(action('squad'), original));
});

test('File merge limits input and output bytes and refuses control characters or arbitrary file actions', () => {
  for (const original of [null, Buffer.from(''), 'a'.repeat(256 * 1024 + 1), '//\0\n', '//\u0085\n', '//\u2028\n', '//\ud800\n', '//\rwrong\n']) invalid(() => mergeAdminFile(action('valheim'), original));
  invalid(() => mergeAdminFile(action('valheim'), `//${'é'.repeat(128 * 1024)}`));
  invalid(() => mergeAdminFile(action('valheim'), `//${'a'.repeat(256 * 1024 - 2)}`));
  for (const malicious of [{ ...action('valheim'), path: '../adminlist.txt' }, { ...action('valheim'), identity: `Steam_${steamId64};quit` }, { ...action('squad'), identity: steamId }, { ...action('squad'), role: 'superadmin' }, action('gmod'), null]) invalid(() => mergeAdminFile(malicious, ''));
  assert.equal(mergeAdminFile(action('squad'), ''), `${group}\nAdmin=${steamId64}:GameSwitch_Admin\n`);
});
