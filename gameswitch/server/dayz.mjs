// Native Linux server and configuration reference:
// https://community.bistudio.com/wiki/DayZ:Hosting_a_Linux_Server
// https://community.bohemia.net/wiki/DayZ:Server_Configuration
export const DAYZ_APP_ID = '223350';
export const DAYZ_WORKSHOP_APP_ID = '221100';
export const DAYZ_DEFAULT_MISSION = 'dayzOffline.chernarusplus';
export const DAYZ_LIBRARY_ROOT = '/var/lib/gameswitch-libraries/dayz';
// Built locally by the root Steam library helper from the already trusted
// steamcmd image plus the native server's system libraries (libcurl, libcap).
// The reserved .invalid registry can never resolve, so a missing local image
// fails closed instead of pulling a same-named image from a public registry.
export const DAYZ_RUNTIME_IMAGE = 'gameswitch.invalid/dayz-runtime:1';

// Well-known Workshop items whose dependencies and admin files GameSwitch
// understands. Any other numeric item can still be loaded as a plain mod.
export const DAYZ_MODS = Object.freeze({
  cf: '1559212036', // Community Framework
  vpp: '1828439124', // VPPAdminTools
  cot: '1564026768', // Community Online Tools
});
// https://github.com/VanillaPlusPlus/VPP-Admin-Tools (PermissionManager.c)
export const VPP_PERMISSIONS_DIRECTORY = 'profiles/VPPAdminTools/Permissions';
export const VPP_SUPERADMINS_DIRECTORY = `${VPP_PERMISSIONS_DIRECTORY}/SuperAdmins`;
export const VPP_SUPERADMINS_FILE = `${VPP_SUPERADMINS_DIRECTORY}/SuperAdmins.txt`;
export const VPP_CREDENTIALS_FILE = `${VPP_PERMISSIONS_DIRECTORY}/credentials.txt`;
export const DAYZ_CONFIG_FILE = 'gameswitch-dayz/serverDZ.cfg';
// VPPAdminTools hashes a plain password of at most 32 characters on its first
// start; a 64-character first line would be taken as an existing hash.
export const DAYZ_ADMIN_PASSWORD = /^[A-Za-z0-9_-]{8,32}$/;

const invalid = message => Object.assign(new Error(message), { status: 400 });
const workshopId = /^[1-9][0-9]{4,19}$/;
const forbidden = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u;
const steamBase = 76561197960265728n;

function adminSteamIds(values = []) {
  if (!Array.isArray(values) || values.length > 20 || new Set(values).size !== values.length || values.some(value => typeof value !== 'string' || !/^[0-9]{17}$/.test(value) || BigInt(value) <= steamBase || BigInt(value) > steamBase + 0xffffffffn)) throw invalid('Admins: höchstens 20 unterschiedliche SteamID64 eines öffentlichen Spieleraccounts angeben.');
  return [...values];
}

export function dayzUsesVpp(profile) { return Array.isArray(profile?.workshopIds) && profile.workshopIds.includes(DAYZ_MODS.vpp); }

export function dayzSettings(profile) {
  if (profile?.gameId !== 'dayz' || profile.loader !== 'steam' || profile.version !== 'latest') throw invalid('DayZ benötigt die aktuelle stabile Linux-Steam-Vorlage.');
  const mission = profile.mission || DAYZ_DEFAULT_MISSION;
  if (mission !== DAYZ_DEFAULT_MISSION) throw invalid('Diese DayZ-Vorlage unterstützt zunächst Chernarus mit dayzOffline.chernarusplus.');
  const mods = profile.workshopIds ?? [];
  if (!Array.isArray(mods) || mods.length > 30 || mods.some(id => typeof id !== 'string' || !workshopId.test(id)) || new Set(mods).size !== mods.length) throw invalid('DayZ-Mods benötigen höchstens 30 eindeutige numerische Workshop-IDs.');
  // Both admin mods are built on Community Framework and fail to load without
  // it. The -mod order is the load order, so CF has to come first.
  for (const [id, name] of [[DAYZ_MODS.vpp, 'VPPAdminTools'], [DAYZ_MODS.cot, 'Community Online Tools']]) {
    if (mods.includes(id) && !(mods.includes(DAYZ_MODS.cf) && mods.indexOf(DAYZ_MODS.cf) < mods.indexOf(id))) throw invalid(`${name} (${id}) benötigt Community Framework (${DAYZ_MODS.cf}) weiter vorne in der Mod-Liste.`);
  }
  const admins = adminSteamIds(profile.adminSteamIds);
  if (admins.length && !mods.includes(DAYZ_MODS.vpp)) throw invalid(`DayZ vergibt Steam-ID-Adminrechte über VPPAdminTools. Bitte CF (${DAYZ_MODS.cf}) und VPPAdminTools (${DAYZ_MODS.vpp}) in die Mod-Liste aufnehmen.`);
  if (!Number.isInteger(profile.port) || profile.port < 1024 || profile.port > 65534) throw invalid('Ungültiger DayZ-Spielport.');
  const queryPort = profile.queryPort ?? 27016;
  if (!Number.isInteger(queryPort) || queryPort < 1024 || queryPort > 65535 || [profile.port, profile.port + 1].includes(queryPort)) throw invalid('DayZ benötigt einen getrennten gültigen Steam-Abfrageport.');
  if (!Number.isInteger(profile.maxPlayers) || profile.maxPlayers < 1 || profile.maxPlayers > 40) throw invalid('DayZ unterstützt in dieser Vorlage 1–40 Slots.');
  if (typeof profile.name !== 'string' || profile.name.length < 2 || profile.name.length > 60 || forbidden.test(profile.name)) throw invalid('Ungültiger DayZ-Servername.');
  // The title is presentation only. Restrict its engine-config representation
  // rather than allowing a name to introduce config statements or Puffer vars.
  const hostname = profile.name.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9 ._()!-]/g, '').trim() || 'GameSwitch DayZ';
  return { mission, workshopIds: [...mods], queryPort, hostname, adminSteamIds: admins, vpp: mods.includes(DAYZ_MODS.vpp) };
}

function adminPassword(secrets) {
  const value = secrets?.adminPassword;
  if (value === undefined) return '';
  if (typeof value !== 'string' || !DAYZ_ADMIN_PASSWORD.test(value)) throw invalid('Das private DayZ-Adminpasswort ist ungültig.');
  return value;
}

export function dayzServerConfig(profile, secrets = {}) {
  const { mission, queryPort, hostname } = dayzSettings(profile);
  if (typeof secrets.serverPassword !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(secrets.serverPassword)) throw invalid('Das private DayZ-Serverpasswort fehlt oder ist ungültig.');
  return `hostname = "${hostname}";
description = "GameSwitch private DayZ server";
password = "${secrets.serverPassword}";
passwordAdmin = "${adminPassword(secrets)}";
maxPlayers = ${profile.maxPlayers};
verifySignatures = 2;
forceSameBuild = 1;
BattlEye = 1;
allowFilePatching = 0;
enableWhitelist = 0;
disableBanlist = 0;
disablePrioritylist = 0;
disableVoN = 0;
vonCodecQuality = 20;
serverTime = "SystemTime";
serverTimeAcceleration = 1;
serverNightTimeAcceleration = 1;
serverTimePersistent = 1;
instanceId = 1;
storageAutoFix = 0;
steamQueryPort = ${queryPort};
class Missions {
  class GameSwitch {
    template = "${mission}";
  };
};
`;
}

// Replace only the passwordAdmin assignment of an existing, possibly locally
// adjusted serverDZ.cfg. Anything ambiguous is left untouched.
export function withDayzAdminPassword(original, secrets) {
  const password = adminPassword(secrets);
  if (typeof original !== 'string' || Buffer.byteLength(original) > 256 * 1024 || !original.isWellFormed() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(original)) throw invalid('Die DayZ-Serverkonfiguration ist ungültig.');
  const assignment = /^([ \t]*)passwordAdmin[ \t]*=[ \t]*"[^"\r\n]*"[ \t]*;[ \t]*(\r?)$/gmu;
  const matches = original.match(assignment) || [];
  // Count assignments and commented-out variants, not a hostname that merely
  // contains the word.
  const mentions = original.match(/^[ \t]*(?:\/\/[ \t]*)?passwordAdmin\b/gmu) || [];
  if (matches.length !== 1 || mentions.length !== 1) throw invalid('serverDZ.cfg enthält keine eindeutige passwordAdmin-Zeile und wird nicht verändert.');
  return original.replace(assignment, (_, indent, carriage) => `${indent}passwordAdmin = "${password}";${carriage}`);
}

// One SteamID64 per line, exactly as VPPAdminTools reads them. VPP's own
// placeholder line is dropped; any other content stops the automatic edit.
const vppPlaceholder = /^Remove this text and add your steam64 ID/u;
export function mergeVppSuperAdmins(original, steamId64, role) {
  if (!['admin', 'user'].includes(role)) throw invalid('Ungültige VPP-Adminrolle.');
  adminSteamIds([steamId64]);
  if (typeof original !== 'string' || Buffer.byteLength(original) > 256 * 1024 || !original.isWellFormed() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u2028\u2029]/u.test(original)) throw invalid('Die VPP-Adminliste ist ungültig oder zu groß.');
  const ids = [];
  for (const raw of original.replace(/^﻿/u, '').split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || vppPlaceholder.test(line)) continue;
    if (!/^[0-9]{17}$/u.test(line)) throw invalid('Die VPP-Adminliste enthält unerwartete Einträge und wird nicht automatisch verändert.');
    adminSteamIds([line]);
    if (!ids.includes(line)) ids.push(line);
  }
  const result = ids.filter(id => id !== steamId64);
  if (role === 'admin') result.push(steamId64);
  if (result.length > 50) throw invalid('Maximal 50 VPP-Superadministratoren erlaubt.');
  return result.length ? `${result.join('\n')}\n` : '';
}

export function buildDayzDefinition(profile, config, runtimeName, environment) {
  const { mission, workshopIds, adminSteamIds: admins, vpp } = dayzSettings(profile);
  const settings = dayzServerConfig(profile, config.profileSecrets);
  const password = adminPassword(config.profileSecrets);
  if (vpp && !password) throw invalid('VPPAdminTools benötigt ein Adminpasswort. Bitte im Profil ein Adminpasswort festlegen.');
  if (!environment || environment.type !== 'docker') throw invalid('DayZ benötigt die isolierte Docker-Laufzeit.');
  const isolated = structuredClone(environment);
  // Only a sanitized host library is mounted. Steam credentials and login
  // sessions are never copied into this server or its backups.
  isolated.hostConfig ||= {};
  isolated.hostConfig.Binds = [...(isolated.hostConfig.Binds || []), `${DAYZ_LIBRARY_ROOT}:/gameswitch-library:ro`];
  isolated.hostConfig.Tmpfs = { ...isolated.hostConfig.Tmpfs, '/pufferpanel/dayz-home/.steam': `rw,exec,nosuid,nodev,size=128m,uid=${config.gameUid},gid=${config.gameGid},mode=0700` };
  const checks = workshopIds.map(id => `test -d /gameswitch-library/mods/${id}; test ! -L /gameswitch-library/mods/${id}; if [ -n "$(find /gameswitch-library/mods/${id} -mindepth 1 ! -type f ! -type d -printf x -quit)" ]; then exit 1; fi; if [ -n "$(find /gameswitch-library/mods/${id} -type f -links +1 -printf x -quit)" ]; then exit 1; fi`).join('; ');
  const copyMods = workshopIds.map(id => `mkdir -p /pufferpanel/mods/${id}; cp -a --no-preserve=ownership /gameswitch-library/mods/${id}/. /pufferpanel/mods/${id}/; for key in /gameswitch-library/mods/${id}/keys/*.bikey; do [ -f "$key" ] || continue; dest="/pufferpanel/keys/$(basename "$key")"; if [ -e "$dest" ] && ! cmp -s "$key" "$dest"; then echo "Conflicting game signature keys" >&2; exit 1; fi; cp --no-preserve=ownership "$key" "$dest"; done`).join('; ');
  // Install and "Server & Mods aktualisieren" share these steps. Mods and keys
  // are recreated from the library each time, so removed or renamed PBOs and
  // rotated keys of an updated mod cannot linger. Persistence (storage_1),
  // profiles/ (admin mod data, logs) and serverDZ.cfg are never replaced here.
  // The ldd check runs in this very runtime image and names missing libraries.
  const copy = `set -eu; test -x /gameswitch-library/server/DayZServer; test ! -L /gameswitch-library/server; if [ -n "$(find /gameswitch-library/server -mindepth 1 ! -type f ! -type d -printf x -quit)" ]; then exit 1; fi; if [ -n "$(find /gameswitch-library/server -type f -links +1 -printf x -quit)" ]; then exit 1; fi; test -d /gameswitch-library/server/mpmissions/${mission}; ${checks ? `${checks}; ` : ''}test ! -L /pufferpanel/mods; test ! -L /pufferpanel/keys; rm -rf /pufferpanel/mods /pufferpanel/keys; cp -a --no-preserve=ownership /gameswitch-library/server/. /pufferpanel/; test ! -L /pufferpanel/mods; test ! -L /pufferpanel/keys; test ! -L /pufferpanel/gameswitch-dayz; mkdir -p /pufferpanel/mods /pufferpanel/keys; ${copyMods ? `${copyMods}; ` : ''}chmod -R u+rwX /pufferpanel; mkdir -p /pufferpanel/profiles /pufferpanel/dayz-home /pufferpanel/gameswitch-dayz; chmod 700 /pufferpanel/gameswitch-dayz; missing=$(LD_LIBRARY_PATH=/pufferpanel:/pufferpanel/linux64 ldd /pufferpanel/DayZServer 2>&1 | grep "not found" || true); if [ -n "$missing" ]; then echo "DayZ runtime libraries missing: $missing" >&2; exit 1; fi`;
  // Numeric IDs are the only mod-path components. No Workshop names, URLs,
  // config text, credentials or free-form launch options become shell code.
  const modArgument = workshopIds.length ? ` "-mod=${workshopIds.map(id => `mods/${id}`).join(';')}"` : '';
  const launch = `#!/bin/sh
set -eu
umask 077
mkdir -p "$HOME/.steam/sdk64"
if [ -f /pufferpanel/linux64/steamclient.so ]; then cp /pufferpanel/linux64/steamclient.so "$HOME/.steam/sdk64/steamclient.so"; fi
exec /pufferpanel/DayZServer -config=/pufferpanel/${DAYZ_CONFIG_FILE} -port=${profile.port} -BEpath=/pufferpanel/battleye -profiles=/pufferpanel/profiles -dologs -adminlog -netlog -freezecheck${modArgument}
`;
  // VPPAdminTools reads these files from -profiles. They are written only when
  // absent; afterwards the admin helper of the stopped profile maintains them
  // and VPP replaces the plain password with its own hash on the first start.
  const vppFiles = vpp ? [
    { type: 'mkdir', target: VPP_SUPERADMINS_DIRECTORY },
    ...(admins.length ? [{ if: `!file_exists("${VPP_SUPERADMINS_FILE}")`, type: 'writefile', target: VPP_SUPERADMINS_FILE, text: `${admins.join('\n')}\n` }] : []),
    { if: `!file_exists("${VPP_CREDENTIALS_FILE}")`, type: 'writefile', target: VPP_CREDENTIALS_FILE, text: `${password}\n` },
  ] : [];
  return {
    type: 'dayz', display: 'DayZ Dedicated Server (Linux stable)', name: runtimeName,
    node: config.nodeId, users: [], data: {}, uninstall: [], requirements: { os: 'linux', arch: 'amd64' },
    install: [
      { type: 'mkdir', target: 'dayz-home' },
      { type: 'mkdir', target: 'dayz-home/.steam' },
      { type: 'mkdir', target: 'profiles' },
      { type: 'command', commands: [`/bin/sh -c '${copy}'`] },
      // Parent0700 prevents any exposure during the writefile operator's0644
      // creation; final0600 is applied immediately afterwards. Keep local
      // configuration changes on a retry/reinstall.
      { if: `!file_exists("${DAYZ_CONFIG_FILE}")`, type: 'writefile', target: DAYZ_CONFIG_FILE, text: settings },
      { type: 'writefile', target: 'dayz-launch.sh', text: launch },
      { type: 'command', commands: [`chmod 600 /pufferpanel/${DAYZ_CONFIG_FILE}`, 'chmod 700 /pufferpanel/dayz-launch.sh /pufferpanel/dayz-home /pufferpanel/profiles', 'chmod +x /pufferpanel/DayZServer'] },
      ...vppFiles,
    ],
    run: {
      command: '/bin/sh /pufferpanel/dayz-launch.sh',
      stopCode: 2, stdin: { type: 'stdin' }, autostart: false, autorecover: false, autorestart: false,
      environmentVars: { HOME: '/pufferpanel/dayz-home', LD_LIBRARY_PATH: '/pufferpanel:/pufferpanel/linux64' },
    },
    environment: isolated,
  };
}
