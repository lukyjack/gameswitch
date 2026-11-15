// Trusted Arma configuration/launch primitives. No credentials or arbitrary
// shell fragments can be supplied by a profile.
// https://community.bistudio.com/wiki/Arma_3:_MP_Mission_Names
// https://community.bistudio.com/wiki/Arma_3:_Dedicated_Server
// https://community.bistudio.com/wiki/Arma_3:_Server_Config_File
export const ARMA_DEFAULT_MISSION = 'MP_COOP_m01.Stratis';
export const ARMA_APP_ID = '233780';
export const ARMA_WORKSHOP_APP_ID = '107410';
export const ARMA_LIBRARY_ROOT = '/var/lib/gameswitch-libraries/arma3';
export const ARMA_MISSIONS = Object.freeze([
  { id: 'MP_COOP_m01.Stratis', name: 'Escape From Stratis', slots: 10 },
  { id: 'MP_COOP_m03.Altis', name: 'Escape From Altis', slots: 10 },
  { id: 'MP_ZGM_m11.Altis', name: 'Zeus Altis', slots: 50 },
  { id: 'MP_ZGM_m12.Stratis', name: 'Zeus Stratis', slots: 50 },
  { id: 'MP_CombatPatrol_01.Altis', name: 'Combat Patrol Altis', slots: 12 },
]);

const invalid = message => Object.assign(new Error(message), { status: 400 });

export function armaMission(value = ARMA_DEFAULT_MISSION) {
  if (!ARMA_MISSIONS.some(mission => mission.id === value)) throw invalid('Bitte eine unterstützte Arma-3-Mission auswählen.');
  return value;
}

export function armaWorkshopIds(values = []) {
  if (!Array.isArray(values) || values.length > 30 || values.some(value => typeof value !== 'string' || !/^[1-9][0-9]{4,19}$/.test(value)) || new Set(values).size !== values.length) throw invalid('Workshop: höchstens 30 unterschiedliche numerische Item-IDs angeben.');
  return [...values];
}

export function armaAdminSteamIds(values = []) {
  if (!Array.isArray(values) || values.length > 20 || values.some(value => typeof value !== 'string' || !/^[0-9]{17}$/.test(value) || BigInt(value) <= 76561197960265728n || BigInt(value) > 76561202255233023n) || new Set(values).size !== values.length) throw invalid('Admins: höchstens 20 unterschiedliche SteamID64 eines öffentlichen Spieleraccounts angeben.');
  return [...values];
}

function serverName(value) {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length > 60 || /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value)) throw invalid('Ungültiger Arma-Servername.');
  // Config strings have their own grammar. Restrict the displayed hostname to
  // letters, digits and familiar punctuation, preserving the original UI name.
  // Quotes, preprocessor metacharacters and Puffer ${variables} never reach it.
  return value.normalize('NFKC').replace(/[^\p{L}\p{N} _.,:()\-]/gu, ' ').replace(/\s+/g, ' ').trim() || 'GameSwitch Arma 3';
}

export function armaServerConfig(profile, secrets = {}) {
  const mission = armaMission(profile.mission);
  armaAdminSteamIds(profile.adminSteamIds);
  const password = secrets.serverPassword;
  if (typeof password !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(password)) throw invalid('Das private Arma-Serverpasswort fehlt oder ist ungültig.');
  if (!Number.isInteger(profile.maxPlayers) || profile.maxPlayers < 1 || profile.maxPlayers > 32) throw invalid('Arma-Spielerzahl außerhalb des erlaubten Bereichs.');
  return [
    '// GameSwitch managed configuration. Keep private: contains the join password.',
    `hostname = "${serverName(profile.name)}";`,
    `password = "${password}";`,
    'passwordAdmin = "";',
    'serverCommandPassword = "";',
    '#include "admins.cfg"',
    `maxPlayers = ${profile.maxPlayers};`,
    'verifySignatures = 2;',
    'allowedFilePatching = 0;',
    'filePatchingExceptions[] = {};',
    'BattlEye = 1;',
    'upnp = 0;',
    'voteThreshold = 1;',
    'allowedVoteCmds[] = {};',
    'allowedVotedAdminCmds[] = {};',
    'kickDuplicate = 1;',
    'persistent = 1;',
    'statisticsEnabled = 0;',
    'timeStampFormat = "full";',
    'timeStampFormatConsole = "full";',
    'logFile = "server_console.log";',
    'missionWhitelist[] = {};',
    'class Missions {',
    '  class GameSwitchMission {',
    `    template = "${mission}";`,
    '    difficulty = "Regular";',
    '  };',
    '};',
    '',
  ].join('\n');
}

export function armaAdminConfig(values = []) {
  return `admins[] = {${armaAdminSteamIds(values).map(value => `"${value}"`).join(',')}};\n`;
}

function rejectUnsafeTree(root) {
  // The host library is root-controlled and mounted read-only; repeat the
  // regular-file/directory check at the copy boundary as defence in depth.
  return `test ! -L ${root}; if [ -n "$(find ${root} -mindepth 1 ! -type f ! -type d -printf x -quit)" ]; then echo "Prepared game library contains unsupported entries" >&2; exit 1; fi; if [ -n "$(find ${root} -type f -links +1 -printf x -quit)" ]; then echo "Prepared game library contains hard links" >&2; exit 1; fi`;
}

export function buildArmaDefinition(profile, config, runtimeName, environment) {
  if (profile?.gameId !== 'arma3' || profile.loader !== 'steam' || profile.version !== 'latest') throw invalid('Arma benötigt die aktuelle stabile Linux-Steam-Vorlage.');
  if (!Number.isInteger(profile.port) || profile.port < 1024 || profile.port > 65531) throw invalid('Der Arma-Portbereich liegt außerhalb der erlaubten Grenzen.');
  armaMission(profile.mission);
  armaAdminSteamIds(profile.adminSteamIds);
  const mods = armaWorkshopIds(profile.workshopIds);
  const text = armaServerConfig(profile, config.profileSecrets);
  const env = structuredClone(environment);
  if (!env || env.type !== 'docker' || !env.hostConfig) throw invalid('Arma benötigt die isolierte Docker-Laufzeit.');
  env.hostConfig.Binds = [...(env.hostConfig.Binds || []), `${ARMA_LIBRARY_ROOT}:/gameswitch-library:ro`];
  // Arma uses HOME/.local/share for profiles on Linux (-profiles is unsupported).
  // Persist that HOME, while Steam API cache and its links stay in an isolated
  // nested tmpfs and therefore cannot contaminate a world backup.
  env.hostConfig.Tmpfs = {
    ...env.hostConfig.Tmpfs,
    '/pufferpanel/arma-home/.steam': `rw,exec,nosuid,nodev,size=128m,uid=${config.gameUid},gid=${config.gameGid},mode=0700`,
  };
  const copy = [
    'chmod 700 /pufferpanel/arma /pufferpanel/arma-home /pufferpanel/arma-home/.local /pufferpanel/arma-home/.local/share',
    'test ! -L /pufferpanel/mods; test ! -L /pufferpanel/keys',
    'test -d /gameswitch-library/server',
    rejectUnsafeTree('/gameswitch-library/server'),
    'cp -R --no-preserve=ownership /gameswitch-library/server/. /pufferpanel/',
    'mkdir -p /pufferpanel/mods /pufferpanel/keys',
    ...mods.flatMap(id => [
      `test -d /gameswitch-library/mods/${id}`,
      rejectUnsafeTree(`/gameswitch-library/mods/${id}`),
      `cp -R --no-preserve=ownership /gameswitch-library/mods/${id} /pufferpanel/mods/`,
      `for key in /gameswitch-library/mods/${id}/keys/*.bikey; do if [ -f "$key" ]; then dest="/pufferpanel/keys/$(basename "$key")"; if [ -e "$dest" ] && ! cmp -s "$key" "$dest"; then echo "Conflicting game signature keys" >&2; exit 1; fi; cp --no-preserve=ownership "$key" "$dest"; fi; done`,
    ]),
    'test -x /pufferpanel/arma3server_x64',
  ].join('; ');
  const launch = [
    '#!/bin/sh',
    'set -eu',
    'umask 077',
    'mkdir -p "$HOME/.local/share/Arma 3" "$HOME/.local/share/Arma 3 - Other Profiles" "$HOME/.steam/sdk64"',
    'chmod 700 "$HOME" "$HOME/.local" "$HOME/.local/share"',
    'chmod 600 /pufferpanel/arma/server.cfg /pufferpanel/arma/admins.cfg /pufferpanel/arma/basic.cfg',
    'if [ -f /pufferpanel/linux64/steamclient.so ]; then cp /pufferpanel/linux64/steamclient.so "$HOME/.steam/sdk64/steamclient.so"; fi',
    `exec /pufferpanel/arma3server_x64 -name=gameswitch -config=/pufferpanel/arma/server.cfg -cfg=/pufferpanel/arma/basic.cfg -port=${profile.port} -world=empty${mods.length ? ` "-mod=${mods.map(id => `mods/${id}`).join(';')}"` : ''}`,
    '',
  ].join('\n');
  return {
    type: 'arma3', display: 'Arma 3 Dedicated Server', name: runtimeName, node: config.nodeId, users: [],
    data: { port: { type: 'integer', value: profile.port, required: true, userEdit: false } },
    install: [
      // Create the nested tmpfs parent as the Puffer UID before Docker can make
      // an implicitly root-owned mountpoint in the bind-mounted game volume.
      { type: 'mkdir', target: 'arma' },
      { type: 'mkdir', target: 'arma-home' },
      { type: 'mkdir', target: 'arma-home/.steam' },
      { type: 'mkdir', target: 'arma-home/.local' },
      { type: 'mkdir', target: 'arma-home/.local/share' },
      { type: 'mkdir', target: 'arma-home/.local/share/Arma 3' },
      { type: 'mkdir', target: 'arma-home/.local/share/Arma 3 - Other Profiles' },
      { type: 'command', commands: [`/bin/sh -ec '${copy}'`] },
      { if: '!file_exists("arma/server.cfg")', type: 'writefile', target: 'arma/server.cfg', text },
      { if: '!file_exists("arma/admins.cfg")', type: 'writefile', target: 'arma/admins.cfg', text: armaAdminConfig(profile.adminSteamIds) },
      { if: '!file_exists("arma/basic.cfg")', type: 'writefile', target: 'arma/basic.cfg', text: 'language="English";\nadapter=-1;\nMaxMsgSend=128;\nMinErrorToSend=0.001;\nMinErrorToSendNear=0.01;\n' },
      { type: 'writefile', target: 'arma/launch.sh', text: launch },
      { type: 'command', commands: ['chmod 700 arma/launch.sh arma-home arma-home/.local arma-home/.local/share; chmod 600 arma/server.cfg arma/admins.cfg arma/basic.cfg'] },
    ],
    uninstall: [], requirements: { os: 'linux', arch: 'amd64' },
    run: { command: '/bin/sh /pufferpanel/arma/launch.sh', stopCode: 2, stdin: { type: 'stdin' }, autostart: false, autorecover: false, autorestart: false, environmentVars: { HOME: '/pufferpanel/arma-home' } },
    environment: env,
  };
}
