import fs from 'node:fs';
import { ftbEnvironment } from './minecraft-memory.mjs';
import { dockerPortBindings } from './game-ports.mjs';
import { buildArmaDefinition } from './arma.mjs';
import { buildDayzDefinition, DAYZ_RUNTIME_IMAGE } from './dayz.mjs';

const minecraft = JSON.parse(fs.readFileSync(new URL('./templates/minecraft.json', import.meta.url), 'utf8'));
const gmod = JSON.parse(fs.readFileSync(new URL('./templates/gmod.json', import.meta.url), 'utf8'));

export function javaVersion(version) {
  if (version === 'latest' || Number(version.split('.')[0]) >= 26) return 25;
  const [, minor, patch = '0'] = version.split('.').map(Number);
  if (minor <= 16) return 8;
  if (minor === 17) return 16;
  if (minor < 20 || (minor === 20 && Number(patch) < 5)) return 17;
  return 21;
}

function docker(profile, config, image, containerRoot = '/pufferpanel') {
  const steamHome = ['gmod', 'squad', 'valheim'].includes(profile.gameId);
  return {
    type: 'docker', image, containerRoot, networkName: 'bridge',
    portBindings: dockerPortBindings(profile, config),
    config: { User: `${config.gameUid}:${config.gameGid}` },
    hostConfig: { CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], Memory: profile.memoryMb * 1024 * 1024, MemorySwap: profile.memoryMb * 1024 * 1024, NanoCpus: (profile.gameId === 'minecraft' ? config.cpuCores : Math.min(config.cpuCores, 6)) * 1_000_000_000, PidsLimit: 512, Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=512m', ...(steamHome ? { '/run/gameswitch-steam-home': `rw,exec,nosuid,nodev,size=512m,uid=${config.gameUid},gid=${config.gameGid},mode=0700` } : {}) }, Privileged: false },
  };
}

function variable(value, type = typeof value === 'number' ? 'integer' : 'string') {
  return { type, value, required: true, userEdit: false };
}

function privateValue(config, key, minimum, maximum) {
  const value = config.profileSecrets?.[key];
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum || !/^[A-Za-z0-9_-]+$/.test(value)) throw Object.assign(new Error('Das erforderliche private Servergeheimnis fehlt oder ist ungültig.'), { status: 400 });
  return value;
}

function newGameDefinition(profile, config, runtimeName) {
  // Fixed installation/launch primitives, verified against the publishers:
  // https://squad.fandom.com/wiki/Server_Installation
  // https://squad.fandom.com/wiki/Server_Configuration
  // https://www.valheimgame.com/support/a-guide-to-dedicated-servers/
  // https://terraria.org/api/download/pc-dedicated-server/terraria-server-1458.zip
  const common = { type: profile.gameId, name: runtimeName, node: config.nodeId, users: [], data: { port: variable(profile.port) }, uninstall: [], requirements: { os: 'linux', arch: 'amd64' } };
  const run = { autostart: false, autorecover: false, autorestart: false, stdin: { type: 'stdin' } };
  if (profile.gameId === 'arma3') return buildArmaDefinition(profile, config, runtimeName, docker(profile, config, 'steamcmd/steamcmd:latest'));
  if (profile.gameId === 'dayz') return buildDayzDefinition(profile, config, runtimeName, docker(profile, config, DAYZ_RUNTIME_IMAGE));
  if (profile.gameId === 'factorio') {
    const password = privateValue(config, 'serverPassword', 8, 64);
    const world = profile.worldName || 'World';
    const binary = '/pufferpanel/factorio/bin/x64/factorio';
    const args = '--config /pufferpanel/config.ini --mod-directory /pufferpanel/mods';
    // https://factorio.com/download and its official sha256sums/ release list.
    const settings = { name: profile.name, description: 'GameSwitch private server', max_players: profile.maxPlayers, visibility: { public: false, lan: false }, username: '', password: '', token: '', game_password: password, require_user_verification: true, allow_commands: 'admins-only', auto_pause: true, autosave_only_on_server: true, non_blocking_saving: false };
    return {
      ...common, display: 'Factorio 2.1.24',
      install: [
        { type: 'download', files: ['https://factorio.com/get-download/2.1.24/headless/linux64'] },
        { type: 'writefile', target: 'factorio.sha256', text: 'c49b66cff90aceff87b30f2973af0df7f51712cb2ee3153e0169d9bed46a964f  factorio-headless_linux_2.1.24.tar.xz\n' },
        { type: 'command', commands: ['sha256sum --check factorio.sha256'] },
        { type: 'extract', source: 'factorio-headless_linux_2.1.24.tar.xz', destination: '.' },
        { type: 'mkdir', target: 'state' }, { type: 'mkdir', target: 'state/saves' }, { type: 'mkdir', target: 'mods' },
        { if: '!file_exists("config.ini")', type: 'writefile', target: 'config.ini', text: '[path]\nread-data=/pufferpanel/factorio/data\nwrite-data=/pufferpanel/state\n' },
        { if: '!file_exists("mods/mod-list.json")', type: 'writefile', target: 'mods/mod-list.json', text: JSON.stringify({ mods: [{ name: 'base', enabled: true }, { name: 'space-age', enabled: false }, { name: 'quality', enabled: false }, { name: 'elevated-rails', enabled: false }] }) },
        { if: '!file_exists("server-settings.json")', type: 'writefile', target: 'server-settings.json', text: JSON.stringify(settings, null, 2) },
        { if: '!file_exists("server-adminlist.json")', type: 'writefile', target: 'server-adminlist.json', text: '[]\n' },
        { type: 'command', commands: ['chmod +x factorio/bin/x64/factorio'] },
        { if: `!file_exists("state/saves/${world}.zip")`, type: 'command', commands: [`${binary} ${args} --create /pufferpanel/state/saves/${world}.zip`] },
      ],
      run: { ...run, command: `${binary} ${args} --start-server /pufferpanel/state/saves/${world}.zip --server-settings /pufferpanel/server-settings.json --server-adminlist /pufferpanel/server-adminlist.json --port ${profile.port}`, stop: '/quit' },
      environment: docker(profile, config, 'steamcmd/steamcmd:latest'),
    };
  }
  if (profile.gameId === 'squad') {
    const password = privateValue(config, 'rconPassword', 16, 128);
    return {
      ...common, display: 'Squad Dedicated Server',
      data: { ...common.data, queryport: variable(profile.queryPort ?? 27165), beaconport: variable(profile.beaconPort ?? 15000), maxplayers: variable(profile.maxPlayers) },
      install: [
        { type: 'command', commands: ['steamcmd +@sSteamCmdForcePlatformType linux +force_install_dir /pufferpanel +login anonymous +app_info_update 1 +app_info_print 403240 +app_update 403240 validate +quit', 'chmod +x SquadGameServer.sh'] },
      ],
      run: { ...run, command: './SquadGameServer.sh Port=${port} QueryPort=${queryport} beaconport=${beaconport} FIXEDMAXPLAYERS=${maxplayers} RANDOM=NONE -log', stopCode: 2,
        // The socket listens inside the container. PufferPanel publishes it only
        // on host loopback, so no RCON password is placed in the launch command.
        stdin: { type: 'rcon', ip: '127.0.0.1', port: '21114', password }, environmentVars: { HOME: '/run/gameswitch-steam-home' },
        pre: [{ type: 'writefile', target: 'SquadGame/ServerConfig/Rcon.cfg', text: `IP=0.0.0.0\nPort=21114\nPassword=${password}\nMaxConnections=5\nSecondsBeforeTimeoutCheck=120\n` }],
      },
      environment: docker(profile, config, 'steamcmd/steamcmd:latest'),
    };
  }
  if (profile.gameId === 'valheim') {
    const password = privateValue(config, 'serverPassword', 8, 64);
    const world = profile.worldName || 'Dedicated';
    return {
      ...common, display: 'Valheim Dedicated Server',
      data: { ...common.data, world: variable(world) },
      install: [
        { type: 'command', commands: ['steamcmd +@sSteamCmdForcePlatformType linux +force_install_dir /pufferpanel +login anonymous +app_info_update 1 +app_update 896660 validate +quit', 'chmod +x valheim_server.x86_64'] },
        { type: 'mkdir', target: 'saves' },
      ],
      run: { ...run,
        // Only the shell inside the game container expands the quoted variable;
        // PufferPanel's command/console logs contain its name, not the secret.
        command: '/bin/sh -c \'exec ./valheim_server.x86_64 -nographics -batchmode -name "$GS_SERVER_NAME" -port ${port} -world ${world} -password "$GS_SERVER_PASSWORD" -savedir /pufferpanel/saves -public 1\'',
        stopCode: 2,
        environmentVars: { HOME: '/run/gameswitch-steam-home', GS_SERVER_NAME: profile.name, GS_SERVER_PASSWORD: password, LD_LIBRARY_PATH: '/pufferpanel/linux64' },
      },
      environment: docker(profile, config, 'steamcmd/steamcmd:latest'),
    };
  }
  if (profile.gameId === 'terraria') {
    const world = profile.worldName || 'World';
    const environment = docker(profile, config, 'steamcmd/steamcmd:latest');
    environment.config.WorkingDir = '/pufferpanel/1458/Linux';
    return {
      ...common, display: 'Terraria 1.4.5.8',
      install: [
        { type: 'download', files: ['https://terraria.org/api/download/pc-dedicated-server/terraria-server-1458.zip'] },
        { type: 'extract', source: 'terraria-server-1458.zip', destination: '.' },
        { type: 'command', commands: ['chmod +x TerrariaServer.bin.x86_64'] },
        { type: 'mkdir', target: 'worlds' },
        { if: '!file_exists("serverconfig.txt")', type: 'writefile', target: 'serverconfig.txt', text: `world=/pufferpanel/worlds/${world}.wld\nautocreate=1\nworldname=${world}\nmaxplayers=${profile.maxPlayers}\nport=${profile.port}\nsecure=1\nupnp=0\n` },
      ],
      run: { ...run, command: './TerrariaServer.bin.x86_64 -config /pufferpanel/serverconfig.txt -noupnp', stop: 'exit' },
      environment,
    };
  }
  throw Object.assign(new Error(profile.gameId === 'fs25' ? 'Farming Simulator 25 benötigt Windows und eine separate Spiellizenz; auf dieser Debian-VPS nicht verfügbar.' : 'Dieses Spiel hat keine unterstützte Linux-Servervorlage.'), { status: 400 });
}

export function buildDefinition(profile, config) {
  const java = profile.loader === 'ftb' && [8, 11, 16, 17, 21, 25].includes(profile.javaVersion) ? profile.javaVersion : javaVersion(profile.version);
  // PufferPanel's upstream server-name field is printable ASCII, max 40.
  const runtimeName = `GameSwitch-${profile.serverId || profile.id || 'server'}`.slice(0, 40);
  if (!['minecraft', 'gmod'].includes(profile.gameId)) return newGameDefinition(profile, config, runtimeName);
  if (['ftb', 'modrinth'].includes(profile.loader)) {
    const ftb = profile.loader === 'ftb';
    return {
      type: 'minecraft-java', display: ftb ? 'Minecraft Feed the Beast' : 'Minecraft Modrinth', name: runtimeName, node: config.nodeId, users: [],
      data: { port: { type: 'integer', value: profile.port, required: true, userEdit: false } },
      install: [], uninstall: [],
      run: { command: '/start', stop: 'stop', stdin: { type: 'stdin' }, autostart: false, autorecover: false, autorestart: false,
        environmentVars: { EULA: 'TRUE', ...(ftb ? { TYPE: 'FTBA', FTB_MODPACK_ID: profile.modpackId, FTB_MODPACK_VERSION_ID: profile.modpackVersion, FTB_BASE_URL: 'https://api.feed-the-beast.com/v1/modpacks', FTB_FORCE_REINSTALL: 'FALSE' } : { TYPE: 'MODRINTH', MODRINTH_MODPACK: profile.modpackId, MODRINTH_VERSION: profile.modpackVersion, VERSION: profile.version }), SERVER_PORT: String(profile.port), MEMORY: `${Math.max(512, profile.memoryMb - 768)}M`, ...(ftb ? ftbEnvironment(profile) : {}), MAX_PLAYERS: String(profile.maxPlayers), ONLINE_MODE: 'TRUE', ENABLE_RCON: 'FALSE', UID: String(config.gameUid), GID: String(config.gameGid) } },
      environment: docker(profile, config, `itzg/minecraft-server:java${java}`, '/data'),
      requirements: { os: 'linux', arch: 'amd64' },
    };
  }
  const definition = structuredClone(profile.gameId === 'gmod' ? gmod : minecraft);
  definition.name = runtimeName;
  definition.node = config.nodeId;
  definition.users = [];
  definition.environment = docker(profile, config, profile.gameId === 'gmod' ? 'steamcmd/steamcmd:latest' : `eclipse-temurin:${java}-jre`);
  delete definition.supportedEnvironments;
  definition.run.autostart = false;
  definition.run.autorecover = false;
  definition.run.autorestart = false;
  const values = profile.gameId === 'gmod'
    ? { port: profile.port, maxplayers: profile.maxPlayers, wscollection: profile.collectionId || '', mapname: profile.map || 'gm_construct', gamemode: profile.gamemode || 'sandbox' }
    : { port: profile.port, memory: Math.max(512, profile.memoryMb - 768), version: profile.version, modlauncher: profile.loader === 'vanilla' ? '' : profile.loader, eula: true, javaversion: String(java), jvmArgs: '' };
  for (const [key, value] of Object.entries(values)) if (definition.data[key]) definition.data[key].value = value;
  if (profile.gameId === 'minecraft') {
    const properties = definition.install.find(step => step.type === 'writefile' && step.target === 'server.properties');
    if (properties) properties.text += `max-players=${profile.maxPlayers}\nonline-mode=true\nenable-rcon=false\n`;
  }
  if (profile.gameId === 'gmod') { definition.run.command += ' +host_workshop_autoupdate 0'; definition.run.environmentVars = { ...definition.run.environmentVars, HOME: '/run/gameswitch-steam-home' }; }
  return definition;
}
