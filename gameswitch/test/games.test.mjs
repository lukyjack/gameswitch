import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { catalog, profileSchema } from '../server/catalog.mjs';
import { gamePorts, validateGamePorts, dockerPortBindings, profilesHavePortCollision } from '../server/game-ports.mjs';
import { buildDefinition } from '../server/templates.mjs';
import { readConfig } from '../server/config.mjs';
import { readProfileSecrets, writeProfileSecrets, getProfileSecretFlags } from '../server/profile-secrets.mjs';

function profile(gameId, patch = {}) {
  const entry = catalog.find(game => game.id === gameId);
  return { name: `${entry.name} Freunde`, gameId, version: entry.defaultVersion || 'latest', loader: entry.loaders[0], maxPlayers: Math.min(10, entry.maxPlayers), memoryMb: entry.defaultMemoryMb, port: entry.defaultPort, ...(gameId === 'minecraft' ? { version: '1.21.4', eulaAccepted: true } : {}), ...(['valheim', 'factorio'].includes(gameId) ? { serverPassword: 'Private_Test_Only_2026' } : {}), ...patch };
}

test('game catalog declares accurate administration/console capabilities and unavailable Windows prerequisite', () => {
  assert.deepEqual(catalog.map(game => game.id), ['minecraft', 'gmod', 'arma3', 'dayz', 'squad', 'valheim', 'terraria', 'factorio', 'fs25']);
  for (const game of catalog) {
    assert.equal(typeof game.available, 'boolean'); assert.equal(typeof game.consoleInput, 'boolean');
    assert.ok(['minecraft', 'ulx', 'arma3', 'dayz', 'valheim', 'squad', 'none'].includes(game.adminKind));
  }
  assert.equal(catalog.find(game => game.id === 'valheim').consoleInput, false);
  assert.match(catalog.find(game => game.id === 'squad').notice, /Custom Browser/);
  const fs25 = catalog.find(game => game.id === 'fs25');
  assert.equal(fs25.available, false);
  assert.match(fs25.unavailableReason, /Windows.*separate/);
  const rejected = profileSchema.safeParse(profile('fs25'));
  assert.equal(rejected.success, false);
  assert.ok(rejected.error.issues.some(issue => issue.message.includes('Windows')));
  assert.throws(() => buildDefinition(profile('fs25'), readConfig({})), /Windows.*separate/);
});

test('typed game profiles accept supported choices and reject cross-game parameters, commands and unsafe worlds/passwords', () => {
  for (const gameId of ['minecraft', 'gmod', 'valheim', 'terraria', 'factorio']) assert.equal(profileSchema.safeParse(profile(gameId)).success, true, gameId);
  assert.equal(profileSchema.safeParse(profile('squad')).success, false);
  const invalid = [
    profile('minecraft', { loader: 'steam' }),
    profile('terraria', { version: '1.4.4.9' }),
    profile('terraria', { maxPlayers: 17 }),
    profile('terraria', { collectionId: '123456789' }),
    profile('minecraft', { map: 'gm_construct' }),
    profile('squad', { map: 'exec;quit' }),
    profile('squad', { memoryMb: 4096 }),
    profile('squad', { queryPort: '27165' }),
    profile('gmod', { queryPort: 27165 }),
    profile('gmod', { gamemode: 'terrortown;quit' }),
    profile('valheim', { maxPlayers: 11 }),
    profile('valheim', { serverPassword: undefined }),
    profile('valheim', { serverPassword: 'short' }),
    profile('valheim', { serverPassword: 'Bad_$(id)' }),
    profile('valheim', { worldName: '../other-world' }),
    profile('terraria', { worldName: 'world\nmaxplayers=999' }),
    profile('gmod', { serverPassword: 'Not_supported_here' }),
  ];
  for (const value of invalid) assert.equal(profileSchema.safeParse(value).success, false, `${value.gameId} ${JSON.stringify(value)}`);
});

test('port sets publish exact game protocols and keep Squad RCON private', () => {
  const config = readConfig({});
  assert.deepEqual(gamePorts(profile('minecraft')).map(port => [port.protocol, port.port]), [['tcp', 25565]]);
  assert.deepEqual(gamePorts(profile('gmod')).map(port => [port.protocol, port.port]), [['tcp', 27015], ['udp', 27015]]);
  assert.deepEqual(gamePorts(profile('valheim')).map(port => [port.protocol, port.port]), [['udp', 2456], ['udp', 2457]]);
  assert.deepEqual(gamePorts(profile('terraria')).map(port => [port.protocol, port.port]), [['tcp', 7777]]);
  const squad = gamePorts(profile('squad'));
  assert.equal(squad.length, 9);
  assert.deepEqual(squad.find(port => port.purpose === 'rcon'), { protocol: 'tcp', port: 21114, hostIp: '127.0.0.1', purpose: 'rcon' });
  const published = dockerPortBindings(profile('squad'), config);
  assert.equal(published.length, 8);
  assert.ok(!published.some(port => port.includes('21114')));
  assert.ok(published.includes('0.0.0.0:27165:27165/tcp'));
  assert.ok(published.includes('0.0.0.0:27166:27166/udp'));
  assert.ok(published.includes('0.0.0.0:15000:15000/tcp'));
  const custom = validateGamePorts(profile('squad', { queryPort: 28000, beaconPort: 16000 }), config);
  assert.ok(custom.some(port => port.purpose === 'query' && port.port === 28001));
});

test('port validation rejects reserved administration, range overflow and in-profile collisions while allowing stopped profile reuse', () => {
  const config = readConfig({ PORT: '3200' });
  for (const value of [
    profile('gmod', { port: 5657 }), profile('gmod', { port: 8080 }), profile('terraria', { port: 3200 }),
    profile('valheim', { port: 65535 }), profile('valheim', { port: 5656 }),
    profile('squad', { queryPort: 65535 }), profile('squad', { queryPort: 7787 }),
    profile('squad', { beaconPort: 27165 }), profile('squad', { queryPort: 21114 }),
  ]) assert.throws(() => validateGamePorts(value, config), error => error.status === 400);
  const first = profile('minecraft', { id: 'one', status: 'stopped' });
  const second = profile('minecraft', { id: 'two', status: 'stopped' });
  assert.doesNotThrow(() => validateGamePorts(first, config));
  assert.doesNotThrow(() => validateGamePorts(second, config));
  assert.equal(profilesHavePortCollision(first, second), true);
});

test('trusted Squad, Valheim and Terraria definitions use fixed installers and validated private configuration', () => {
  const config = { ...readConfig({}), profileSecrets: { serverPassword: 'Test_Only_Valheim_Secret', rconPassword: 'Test_Only_Squad_Rcon_Secret' } };
  const squad = buildDefinition(profile('squad', { queryPort: 28000, beaconPort: 16000 }), config);
  assert.match(JSON.stringify(squad.install), /app_update 403240 validate/);
  assert.equal(squad.data.queryport.value, 28000);
  assert.equal(squad.data.beaconport.value, 16000);
  assert.match(squad.run.command, /SquadGameServer\.sh/);
  assert.equal(squad.run.stopCode, 2);
  assert.equal(squad.run.stdin.type, 'rcon');
  assert.equal(squad.run.stdin.ip, '127.0.0.1');
  assert.equal(squad.run.stdin.port, '21114');
  assert.equal(squad.run.stdin.password, config.profileSecrets.rconPassword);
  assert.equal(squad.run.environmentVars.HOME, '/run/gameswitch-steam-home');
  assert.ok(squad.run.pre.some(step => step.target === 'SquadGame/ServerConfig/Rcon.cfg' && step.text.includes('IP=0.0.0.0')));
  assert.ok(!squad.run.command.includes(config.profileSecrets.rconPassword));
  const valheim = buildDefinition(profile('valheim', { worldName: 'Freunde_Welt' }), config);
  assert.match(JSON.stringify(valheim.install), /app_update 896660 validate/);
  assert.match(valheim.install[0].commands[0], /\+@sSteamCmdForcePlatformType linux .*\+login anonymous \+app_info_update 1 \+app_update 896660 validate/);
  assert.match(valheim.run.command, /-password "\$GS_SERVER_PASSWORD"/);
  assert.ok(!valheim.run.command.includes(config.profileSecrets.serverPassword));
  assert.ok(!JSON.stringify(valheim.data).includes(config.profileSecrets.serverPassword));
  assert.equal(valheim.run.environmentVars.GS_SERVER_PASSWORD, config.profileSecrets.serverPassword);
  assert.equal(valheim.run.environmentVars.HOME, '/run/gameswitch-steam-home');
  const gmod = buildDefinition(profile('gmod'), config);
  assert.equal(gmod.run.environmentVars.HOME, '/run/gameswitch-steam-home');
  for (const definition of [squad, valheim, gmod]) {
    assert.match(definition.environment.hostConfig.Tmpfs['/run/gameswitch-steam-home'], /size=512m,uid=1000,gid=1000,mode=0700/);
    assert.match(definition.environment.hostConfig.Tmpfs['/tmp'], /noexec/);
  }
  assert.equal(valheim.run.stopCode, 2);
  assert.match(valheim.run.command, /-savedir \/pufferpanel\/saves/);
  const terraria = buildDefinition(profile('terraria', { worldName: 'Freunde' }), config);
  assert.ok(JSON.stringify(terraria.install).includes('https://terraria.org/api/download/pc-dedicated-server/terraria-server-1458.zip'));
  assert.equal(terraria.environment.config.WorkingDir, '/pufferpanel/1458/Linux');
  assert.equal(terraria.run.stop, 'exit');
  const settings = terraria.install.find(step => step.target === 'serverconfig.txt');
  assert.ok(settings.if.includes('!file_exists'));
  assert.match(settings.text, /world=\/pufferpanel\/worlds\/Freunde\.wld\nautocreate=1/);
  assert.match(settings.text, /maxplayers=10/);
  for (const definition of [squad, valheim, terraria]) {
    assert.equal(definition.environment.networkName, 'bridge');
    assert.deepEqual(definition.environment.hostConfig.CapDrop, ['ALL']);
    assert.equal(definition.environment.hostConfig.Privileged, false);
    assert.equal(definition.run.autostart, false);
    assert.equal(definition.run.autorestart, false);
  }
  assert.throws(() => buildDefinition(profile('valheim'), readConfig({})), /private Servergeheimnis/);
  assert.throws(() => buildDefinition(profile('squad'), { ...config, profileSecrets: { rconPassword: 'password\nPort=9' } }), /private Servergeheimnis/);
});

test('profile secrets remain separate, atomically merge private files and return only presence flags', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-profile-secrets-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = { dataDir: directory };
  const id = randomUUID();
  assert.deepEqual(await readProfileSecrets(config, id), {});
  const first = await writeProfileSecrets(config, id, { serverPassword: 'First_Test_Only_Password' });
  assert.deepEqual(first, { serverPasswordSet: true, rconPasswordSet: false, adminPasswordSet: false });
  const second = await writeProfileSecrets(config, id, { rconPassword: 'Second_Test_Only_Password' });
  assert.deepEqual(second, { serverPasswordSet: true, rconPasswordSet: true, adminPasswordSet: false });
  assert.deepEqual(await readProfileSecrets(config, id), { serverPassword: 'First_Test_Only_Password', rconPassword: 'Second_Test_Only_Password' });
  assert.deepEqual(await getProfileSecretFlags(config, id), second);
  const third = await writeProfileSecrets(config, id, { adminPassword: 'Admin_Test_Only_1' });
  assert.deepEqual(third, { serverPasswordSet: true, rconPasswordSet: true, adminPasswordSet: true });
  assert.equal((await readProfileSecrets(config, id)).adminPassword, 'Admin_Test_Only_1');
  await assert.rejects(writeProfileSecrets(config, id, { adminPassword: 'x'.repeat(33) }));
  const file = path.join(directory, 'profile-secrets', `${id}.json`);
  assert.deepEqual((await fs.readdir(path.dirname(file))).sort(), [`${id}.json`]);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.dirname(file))).mode & 0o777, 0o700);
  }
  await assert.rejects(writeProfileSecrets(config, '../outside', { serverPassword: 'Test_Only_Password' }));
  await assert.rejects(readProfileSecrets(config, 'not-generated-profile-id'));
  await assert.rejects(writeProfileSecrets(config, id, { token: 'arbitrary' }));
  await assert.rejects(writeProfileSecrets(config, id, { serverPassword: 'Invalid\nPassword' }));
  await fs.writeFile(file, ' '.repeat(4097), { mode: 0o600 });
  await assert.rejects(readProfileSecrets(config, id), /große|groß/);
});
