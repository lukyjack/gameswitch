import fs from 'node:fs';

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
  return {
    type: 'docker', image, containerRoot, networkName: 'bridge',
    portBindings: [`0.0.0.0:${profile.port}:${profile.port}/tcp`, ...(profile.gameId === 'gmod' ? [`0.0.0.0:${profile.port}:${profile.port}/udp`] : [])],
    config: { User: `${config.gameUid}:${config.gameGid}` },
    hostConfig: { CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], Memory: profile.memoryMb * 1024 * 1024, MemorySwap: profile.memoryMb * 1024 * 1024, NanoCpus: Math.min(config.cpuCores, 6) * 1_000_000_000, PidsLimit: 512, Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=512m' }, Privileged: false },
  };
}

export function buildDefinition(profile, config) {
  const java = profile.loader === 'ftb' && [8, 11, 16, 17, 21, 25].includes(profile.javaVersion) ? profile.javaVersion : javaVersion(profile.version);
  // PufferPanel's upstream server-name field is printable ASCII, max 40.
  const runtimeName = `GameSwitch-${profile.serverId || profile.id || 'server'}`.slice(0, 40);
  if (['ftb', 'modrinth'].includes(profile.loader)) {
    const ftb = profile.loader === 'ftb';
    return {
      type: 'minecraft-java', display: ftb ? 'Minecraft Feed the Beast' : 'Minecraft Modrinth', name: runtimeName, node: config.nodeId, users: [],
      data: { port: { type: 'integer', value: profile.port, required: true, userEdit: false } },
      install: [], uninstall: [],
      run: { command: '/start', stop: 'stop', stdin: { type: 'stdin' }, autostart: false, autorecover: false, autorestart: false,
        environmentVars: { EULA: 'TRUE', ...(ftb ? { TYPE: 'FTBA', FTB_MODPACK_ID: profile.modpackId, FTB_MODPACK_VERSION_ID: profile.modpackVersion, FTB_BASE_URL: 'https://api.feed-the-beast.com/v1/modpacks', FTB_FORCE_REINSTALL: 'FALSE' } : { TYPE: 'MODRINTH', MODRINTH_MODPACK: profile.modpackId, MODRINTH_VERSION: profile.modpackVersion, VERSION: profile.version }), SERVER_PORT: String(profile.port), MEMORY: `${Math.max(512, profile.memoryMb - 768)}M`, MAX_PLAYERS: String(profile.maxPlayers), ONLINE_MODE: 'TRUE', ENABLE_RCON: 'FALSE', UID: String(config.gameUid), GID: String(config.gameGid) } },
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
  if (profile.gameId === 'gmod') definition.run.command += ' +host_workshop_autoupdate 0';
  return definition;
}
