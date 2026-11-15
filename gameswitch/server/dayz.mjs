// Native Linux server and configuration reference:
// https://community.bistudio.com/wiki/DayZ:Hosting_a_Linux_Server
// https://community.bohemia.net/wiki/DayZ:Server_Configuration
export const DAYZ_APP_ID = '223350';
export const DAYZ_WORKSHOP_APP_ID = '221100';
export const DAYZ_DEFAULT_MISSION = 'dayzOffline.chernarusplus';
export const DAYZ_LIBRARY_ROOT = '/var/lib/gameswitch-libraries/dayz';

const invalid = message => Object.assign(new Error(message), { status: 400 });
const workshopId = /^[1-9][0-9]{4,19}$/;
const forbidden = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u;

export function dayzSettings(profile) {
  if (profile?.gameId !== 'dayz' || profile.loader !== 'steam' || profile.version !== 'latest') throw invalid('DayZ benötigt die aktuelle stabile Linux-Steam-Vorlage.');
  const mission = profile.mission || DAYZ_DEFAULT_MISSION;
  if (mission !== DAYZ_DEFAULT_MISSION) throw invalid('Diese DayZ-Vorlage unterstützt zunächst Chernarus mit dayzOffline.chernarusplus.');
  const mods = profile.workshopIds ?? [];
  if (!Array.isArray(mods) || mods.length > 30 || mods.some(id => typeof id !== 'string' || !workshopId.test(id)) || new Set(mods).size !== mods.length) throw invalid('DayZ-Mods benötigen höchstens 30 eindeutige numerische Workshop-IDs.');
  if (!Number.isInteger(profile.port) || profile.port < 1024 || profile.port > 65534) throw invalid('Ungültiger DayZ-Spielport.');
  const queryPort = profile.queryPort ?? 27016;
  if (!Number.isInteger(queryPort) || queryPort < 1024 || queryPort > 65535 || [profile.port, profile.port + 1].includes(queryPort)) throw invalid('DayZ benötigt einen getrennten gültigen Steam-Abfrageport.');
  if (!Number.isInteger(profile.maxPlayers) || profile.maxPlayers < 1 || profile.maxPlayers > 40) throw invalid('DayZ unterstützt in dieser Vorlage 1–40 Slots.');
  if (typeof profile.name !== 'string' || profile.name.length < 2 || profile.name.length > 60 || forbidden.test(profile.name)) throw invalid('Ungültiger DayZ-Servername.');
  // The title is presentation only. Restrict its engine-config representation
  // rather than allowing a name to introduce config statements or Puffer vars.
  const hostname = profile.name.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9 ._()!-]/g, '').trim() || 'GameSwitch DayZ';
  return { mission, workshopIds: [...mods], queryPort, hostname };
}

export function dayzServerConfig(profile, secrets = {}) {
  const { mission, queryPort, hostname } = dayzSettings(profile);
  if (typeof secrets.serverPassword !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(secrets.serverPassword)) throw invalid('Das private DayZ-Serverpasswort fehlt oder ist ungültig.');
  return `hostname = "${hostname}";
description = "GameSwitch private DayZ server";
password = "${secrets.serverPassword}";
passwordAdmin = "";
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

export function buildDayzDefinition(profile, config, runtimeName, environment) {
  const { mission, workshopIds } = dayzSettings(profile);
  const settings = dayzServerConfig(profile, config.profileSecrets);
  if (!environment || environment.type !== 'docker') throw invalid('DayZ benötigt die isolierte Docker-Laufzeit.');
  const isolated = structuredClone(environment);
  // Only a sanitized host library is mounted. Steam credentials and login
  // sessions are never copied into this server or its backups.
  isolated.hostConfig ||= {};
  isolated.hostConfig.Binds = [...(isolated.hostConfig.Binds || []), `${DAYZ_LIBRARY_ROOT}:/gameswitch-library:ro`];
  isolated.hostConfig.Tmpfs = { ...isolated.hostConfig.Tmpfs, '/pufferpanel/dayz-home/.steam': `rw,exec,nosuid,nodev,size=128m,uid=${config.gameUid},gid=${config.gameGid},mode=0700` };
  const checks = workshopIds.map(id => `test -d /gameswitch-library/mods/${id}; test ! -L /gameswitch-library/mods/${id}; if [ -n "$(find /gameswitch-library/mods/${id} -mindepth 1 ! -type f ! -type d -printf x -quit)" ]; then exit 1; fi; if [ -n "$(find /gameswitch-library/mods/${id} -type f -links +1 -printf x -quit)" ]; then exit 1; fi`).join('; ');
  const copyMods = workshopIds.map(id => `test ! -L /pufferpanel/mods/${id}; mkdir -p /pufferpanel/mods/${id}; cp -a --no-preserve=ownership /gameswitch-library/mods/${id}/. /pufferpanel/mods/${id}/; for key in /gameswitch-library/mods/${id}/keys/*.bikey; do [ -f "$key" ] || continue; dest="/pufferpanel/keys/$(basename "$key")"; if [ -e "$dest" ] && ! cmp -s "$key" "$dest"; then echo "Conflicting game signature keys" >&2; exit 1; fi; cp --no-preserve=ownership "$key" "$dest"; done`).join('; ');
  const copy = `set -eu; test -x /gameswitch-library/server/DayZServer; test ! -L /gameswitch-library/server; if [ -n "$(find /gameswitch-library/server -mindepth 1 ! -type f ! -type d -printf x -quit)" ]; then exit 1; fi; if [ -n "$(find /gameswitch-library/server -type f -links +1 -printf x -quit)" ]; then exit 1; fi; test -d /gameswitch-library/server/mpmissions/${mission}; ${checks ? `${checks}; ` : ''}cp -a --no-preserve=ownership /gameswitch-library/server/. /pufferpanel/; test ! -L /pufferpanel/mods; test ! -L /pufferpanel/keys; test ! -L /pufferpanel/gameswitch-dayz; mkdir -p /pufferpanel/mods /pufferpanel/keys; ${copyMods ? `${copyMods}; ` : ''}chmod -R u+rwX /pufferpanel; mkdir -p /pufferpanel/profiles /pufferpanel/dayz-home /pufferpanel/gameswitch-dayz; chmod 700 /pufferpanel/gameswitch-dayz`;
  // Numeric IDs are the only mod-path components. No Workshop names, URLs,
  // config text, credentials or free-form launch options become shell code.
  const modArgument = workshopIds.length ? ` "-mod=${workshopIds.map(id => `mods/${id}`).join(';')}"` : '';
  const launch = `#!/bin/sh
set -eu
umask 077
mkdir -p "$HOME/.steam/sdk64"
if [ -f /pufferpanel/linux64/steamclient.so ]; then cp /pufferpanel/linux64/steamclient.so "$HOME/.steam/sdk64/steamclient.so"; fi
exec /pufferpanel/DayZServer -config=/pufferpanel/gameswitch-dayz/serverDZ.cfg -port=${profile.port} -BEpath=/pufferpanel/battleye -profiles=/pufferpanel/profiles -dologs -adminlog -netlog -freezecheck${modArgument}
`;
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
      { if: '!file_exists("gameswitch-dayz/serverDZ.cfg")', type: 'writefile', target: 'gameswitch-dayz/serverDZ.cfg', text: settings },
      { type: 'writefile', target: 'dayz-launch.sh', text: launch },
      { type: 'command', commands: ['chmod 600 /pufferpanel/gameswitch-dayz/serverDZ.cfg', 'chmod 700 /pufferpanel/dayz-launch.sh /pufferpanel/dayz-home /pufferpanel/profiles', 'chmod +x /pufferpanel/DayZServer'] },
    ],
    run: {
      command: '/bin/sh /pufferpanel/dayz-launch.sh',
      stopCode: 2, stdin: { type: 'stdin' }, autostart: false, autorecover: false, autorestart: false,
      environmentVars: { HOME: '/pufferpanel/dayz-home', LD_LIBRARY_PATH: '/pufferpanel:/pufferpanel/linux64' },
    },
    environment: isolated,
  };
}
