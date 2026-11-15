import { z } from 'zod';

const steamBase = 76561197960265728n;
const maximumAccount = 0xffffffffn;
const maximumFileBytes = 256 * 1024;
const squadGroup = 'GameSwitch_Admin';
const squadPermissions = ['changemap', 'balance', 'chat', 'kick', 'ban', 'cameraman', 'pause'];
const adminInput = z.object({ steamId: z.string(), role: z.enum(['admin', 'superadmin', 'user']) }).strict();

function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }

export function canonicalSteamId(input) {
  if (typeof input !== 'string') invalid('Bitte eine SteamID oder SteamID64 als Text eingeben.');
  let account;
  const legacy = /^STEAM_[01]:([01]):(0|[1-9][0-9]{0,9})$/.exec(input);
  if (legacy) account = BigInt(legacy[2]) * 2n + BigInt(legacy[1]);
  else if (/^[0-9]{17}$/.test(input)) account = BigInt(input) - steamBase;
  else invalid('Bitte eine gültige SteamID oder SteamID64 eines öffentlichen Spieleraccounts eingeben.');
  if (account <= 0n || account > maximumAccount) invalid('Die Steam-ID gehört nicht zu einem gültigen öffentlichen Spieleraccount.');
  return { steamId2: `STEAM_0:${account % 2n}:${account / 2n}`, steamId64: String(steamBase + account) };
}

export function buildAdminAction(profile, input) {
  if (!['gmod', 'valheim', 'squad'].includes(profile?.gameId)) invalid('Für dieses Spiel gibt es keinen Steam-Admin-Helfer.');
  const parsed = adminInput.safeParse(input);
  if (!parsed.success) invalid('Erlaubt sind nur Steam-ID und eine gültige Rolle.');
  const { role } = parsed.data;
  const { steamId2, steamId64 } = canonicalSteamId(parsed.data.steamId);
  if (profile.gameId === 'gmod') return {
    kind: 'command', requires: 'ulx',
    command: role === 'user' ? `ulx removeuserid ${steamId2}` : `ulx adduserid ${steamId2} ${role}`,
    notice: 'ULX-Befehl übermittelt. Bitte das Ergebnis in der Konsole prüfen.',
  };
  if (role === 'superadmin') invalid('Dieses Spiel unterstützt hier nur die Rollen Admin und Spieler.');
  if (profile.gameId === 'valheim') return {
    kind: 'file', path: 'saves/adminlist.txt', identity: `Steam_${steamId64}`, role,
    notice: 'Die Adminliste wurde gespeichert. Die Änderung gilt spätestens beim nächsten Start; es wurde kein Neustart ausgelöst.',
  };
  return {
    kind: 'file', path: 'SquadGame/ServerConfig/Admins.cfg', identity: steamId64, role,
    notice: 'Die Adminliste wurde gespeichert. Die Änderung gilt spätestens beim nächsten Start. Andere Gruppen und externe Adminlisten bleiben bestehen.',
  };
}

function readFile(original) {
  if (typeof original !== 'string' || Buffer.byteLength(original, 'utf8') > maximumFileBytes) invalid('Die Admin-Datei ist ungültig oder größer als 256 KiB.');
  if (!original.isWellFormed() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u2028\u2029]/u.test(original) || /\r(?!\n)/u.test(original)) invalid('Die Admin-Datei enthält ungültige Steuerzeichen.');
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
  const content = original.slice(bom.length);
  const lines = [...content.matchAll(/([^\r\n]*)(\r\n|\n|$)/gu)]
    .filter(match => match[0].length > 0).map(match => ({ text: match[1], ending: match[2] }));
  return { bom, lines, newline: lines.find(line => line.ending)?.ending || '\n' };
}

function splitComment(line) {
  const index = line.indexOf('//');
  return index < 0 ? { code: line.trim(), comment: '' } : { code: line.slice(0, index).trim(), comment: line.slice(index) };
}

function appendLine(file, text) {
  const last = file.lines.at(-1);
  if (last && !last.ending) last.ending = file.newline;
  file.lines.push({ text, ending: file.newline });
}

function withoutAssignment(line, comment) {
  return comment ? { ...line, text: `${/^\s*/u.exec(line.text)[0]}${comment}` } : null;
}

function mergeValheim(file, action) {
  const identity = action.identity;
  const account = identity.slice('Steam_'.length);
  let found = false;
  file.lines = file.lines.map(line => {
    const { code, comment } = splitComment(line.text);
    if (!code || code.startsWith('#')) return line;
    if (/^[0-9]{17}$/u.test(code)) canonicalSteamId(code);
    else if (/^Steam_/u.test(code)) canonicalSteamId(code.slice(6));
    else if (!/^[A-Za-z][A-Za-z0-9]{0,23}_[A-Za-z0-9]{1,128}$/u.test(code)) invalid('Die Valheim-Adminliste ist beschädigt. Bitte die vorhandenen Einträge prüfen.');
    if (code !== identity && code !== account) return line;
    if (action.role === 'user' || found) return withoutAssignment(line, comment);
    found = true;
    return code === identity ? line : { ...line, text: line.text.replace(code, identity) };
  }).filter(Boolean);
  if (action.role === 'admin' && !found) appendLine(file, identity);
}

function mergeSquad(file, action) {
  const groupNames = new Set();
  let managedGroup = false;
  let managedAssignment = false;
  const entries = file.lines.map(line => {
    const { code, comment } = splitComment(line.text);
    if (!code || code.startsWith('#')) return { line };
    const group = /^Group\s*=\s*([A-Za-z0-9_. -]{1,64})\s*:\s*([A-Za-z][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z][A-Za-z0-9_]*)*)\s*$/u.exec(code);
    if (group) {
      const name = group[1].trim();
      const normalizedName = name.toLowerCase();
      if (!name || groupNames.has(normalizedName) || (normalizedName === squadGroup.toLowerCase() && name !== squadGroup)) invalid('Die Squad-Adminliste enthält mehrdeutige Gruppendefinitionen.');
      groupNames.add(normalizedName);
      const permissions = group[2].split(',').map(permission => permission.trim());
      if (new Set(permissions).size !== permissions.length) invalid('Die Squad-Adminliste enthält doppelte Gruppenrechte.');
      if (name === squadGroup) {
        managedGroup = true;
        if (permissions.length !== squadPermissions.length || squadPermissions.some(permission => !permissions.includes(permission))) invalid('Die vorhandene GameSwitch_Admin-Gruppe hat andere Rechte und wird nicht überschrieben.');
      }
      return { line, group: true };
    }
    // Preserve existing Steam and EOS assignments, including assignments managed elsewhere.
    const admin = /^Admin\s*=\s*([0-9]{17}|[0-9a-fA-F]{32})\s*:\s*([A-Za-z0-9_. -]{1,64})\s*$/u.exec(code);
    if (!admin || !admin[2].trim()) invalid('Die Squad-Adminliste ist beschädigt. Bitte die vorhandenen Einträge prüfen.');
    const groupName = admin[2].trim();
    if (groupName.toLowerCase() === squadGroup.toLowerCase() && groupName !== squadGroup) invalid('Die Squad-Adminliste enthält eine mehrdeutige GameSwitch_Admin-Zuweisung.');
    if (groupName === squadGroup) managedAssignment = true;
    return { line, admin: true, identity: admin[1], groupName, comment };
  });
  if (managedAssignment && !managedGroup) invalid('In der Squad-Adminliste fehlt die verwendete GameSwitch_Admin-Gruppe.');
  let found = false;
  file.lines = entries.map(entry => {
    if (!entry.admin || entry.identity !== action.identity || entry.groupName !== squadGroup) return entry.line;
    if (action.role === 'user' || found) return withoutAssignment(entry.line, entry.comment);
    found = true;
    return entry.line;
  }).filter(Boolean);
  if (action.role !== 'admin') return;
  if (!managedGroup) {
    const text = `Group=${squadGroup}:${squadPermissions.join(',')}`;
    const firstAdmin = file.lines.findIndex(line => /^\s*Admin\s*=/u.test(line.text));
    if (firstAdmin < 0) appendLine(file, text);
    else file.lines.splice(firstAdmin, 0, { text, ending: file.newline });
  }
  if (!found) appendLine(file, `Admin=${action.identity}:${squadGroup}`);
}

export function mergeAdminFile(action, original) {
  if (action?.kind !== 'file' || !['admin', 'user'].includes(action.role)) invalid('Ungültige Admin-Dateiaktion.');
  let merge;
  if (action.path === 'saves/adminlist.txt' && typeof action.identity === 'string' && action.identity.startsWith('Steam_')) {
    if (canonicalSteamId(action.identity.slice(6)).steamId64 !== action.identity.slice(6)) invalid('Ungültige Valheim-Identität.');
    merge = mergeValheim;
  } else if (action.path === 'SquadGame/ServerConfig/Admins.cfg') {
    if (canonicalSteamId(action.identity).steamId64 !== action.identity) invalid('Ungültige Squad-Identität.');
    merge = mergeSquad;
  } else invalid('Diese Admin-Datei darf nicht verändert werden.');
  const file = readFile(original);
  merge(file, action);
  const result = file.bom + file.lines.map(line => line.text + line.ending).join('');
  if (Buffer.byteLength(result, 'utf8') > maximumFileBytes) invalid('Die aktualisierte Admin-Datei wäre größer als 256 KiB.');
  return result;
}
