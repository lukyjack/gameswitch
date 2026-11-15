import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ARMA_APP_ID, ARMA_WORKSHOP_APP_ID, ARMA_DEFAULT_MISSION, ARMA_MISSIONS, armaMission, armaWorkshopIds, armaAdminSteamIds, armaAdminConfig, armaServerConfig, buildArmaDefinition } from '../server/arma.mjs';
import { buildDefinition } from '../server/templates.mjs';
import { readConfig } from '../server/config.mjs';

const profile = patch => ({ gameId: 'arma3', loader: 'steam', version: 'latest', name: 'Freunde auf Stratis', port: 2302, maxPlayers: 10, memoryMb: 6144, mission: ARMA_DEFAULT_MISSION, workshopIds: [], adminSteamIds: [], ...patch });
const privatePassword = 'Fixture_Only_Arma_Password';
const environment = () => ({ type: 'docker', image: 'steamcmd/steamcmd:latest', config: { User: '1000:1000' }, hostConfig: { CapDrop: ['ALL'], Privileged: false, SecurityOpt: ['no-new-privileges:true'], Memory: 6144 * 1024 * 1024, Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=512m' } }, portBindings: [2302, 2303, 2304, 2305, 2306].map(port => `0.0.0.0:${port}:${port}/udp`) });
const config = () => ({ ...readConfig({}), profileSecrets: { serverPassword: privatePassword } });
const definition = (patch = {}, env = environment()) => buildArmaDefinition(profile(patch), config(), 'GameSwitch-fixture', env);
const launch = value => value.install.find(step => step.target === 'arma/launch.sh').text;
const commands = value => value.install.flatMap(step => step.commands || []).join('\n');
const invalid = action => assert.throws(action, error => error.status === 400);

test('Arma library template uses the native stable server without Steam authentication in game definitions', () => {
  const value = definition();
  assert.equal(ARMA_APP_ID, '233780'); assert.equal(ARMA_WORKSHOP_APP_ID, '107410');
  assert.equal(value.type, 'arma3'); assert.deepEqual(value.requirements, { os: 'linux', arch: 'amd64' });
  assert.deepEqual(value.environment.hostConfig.Binds, ['/var/lib/gameswitch-libraries/arma3:/gameswitch-library:ro']);
  assert.match(commands(value), /cp -R --no-preserve=ownership \/gameswitch-library\/server\/\. \/pufferpanel\//);
  assert.ok(!/\+login|workshop_download_item|steamcmd \+|STEAM_(?:USER|PASS)|credentials/i.test(JSON.stringify(value)));
  assert.ok(!JSON.stringify(value.run).includes(privatePassword));
  assert.ok(!JSON.stringify(value.environment).includes(privatePassword));
  assert.ok(!commands(value).includes(privatePassword));
  assert.equal(value.environment.config.User, '1000:1000');
  assert.deepEqual(value.environment.hostConfig.CapDrop, ['ALL']);
  assert.deepEqual(value.environment.hostConfig.SecurityOpt, ['no-new-privileges:true']);
  assert.equal(value.environment.hostConfig.Privileged, false);
});

test('Arma mission selection is a fixed official vanilla allowlist with a real default', () => {
  assert.equal(armaMission(), 'MP_COOP_m01.Stratis');
  assert.equal(ARMA_MISSIONS.length, 5);
  for (const mission of ARMA_MISSIONS) assert.equal(armaMission(mission.id), mission.id);
  for (const mission of ['', 'MP_COOP_m01.Stratis.pbo', '../private.cfg', 'https://example.test/mission', 'mission;shutdown', 'MyCustom.Altis', { toString: () => ARMA_DEFAULT_MISSION }]) invalid(() => armaMission(mission));
});

test('Arma private config enforces signature, anti-cheat and admin security while isolating the editable admin fragment', () => {
  const value = definition({ adminSteamIds: ['76561198000000001'] });
  const main = value.install.find(step => step.target === 'arma/server.cfg');
  const admins = value.install.find(step => step.target === 'arma/admins.cfg');
  assert.match(main.text, /verifySignatures = 2;/); assert.match(main.text, /BattlEye = 1;/);
  assert.match(main.text, /allowedFilePatching = 0;/); assert.match(main.text, /filePatchingExceptions\[\] = \{\};/);
  assert.match(main.text, /voteThreshold = 1;/); assert.match(main.text, /allowedVoteCmds\[\] = \{\};/); assert.match(main.text, /allowedVotedAdminCmds\[\] = \{\};/);
  assert.match(main.text, /passwordAdmin = "";/); assert.match(main.text, /serverCommandPassword = "";/);
  assert.match(main.text, /#include "admins\.cfg"/);
  assert.ok(!main.text.includes('76561198000000001'));
  assert.equal(admins.text, 'admins[] = {"76561198000000001"};\n');
  assert.equal(main.if, '!file_exists("arma/server.cfg")');
  assert.equal(admins.if, '!file_exists("arma/admins.cfg")');
  const copyIndex = value.install.findIndex(step => step.commands?.some(command => command.includes('/gameswitch-library/server')));
  const cfgIndex = value.install.indexOf(main);
  assert.ok(copyIndex < cfgIndex);
  assert.match(value.install[copyIndex].commands[0], /chmod 700 \/pufferpanel\/arma /);
  assert.match(commands(value), /chmod 600 arma\/server\.cfg arma\/admins\.cfg arma\/basic\.cfg/);
});

test('Arma config cannot gain statements or template substitutions from profile names or invalid secret values', () => {
  const cfg = armaServerConfig(profile({ name: '"; admins[]={"76561198000000001"}; ${port} \\ #include' }), { serverPassword: privatePassword });
  assert.ok(!cfg.includes('${port}')); assert.ok(!cfg.includes('\\'));
  assert.ok(!cfg.includes('admins[]={'));
  assert.equal((cfg.match(/^password = /gm) || []).length, 1);
  assert.equal((cfg.match(/^#include /gm) || []).length, 1);
  for (const password of [undefined, 'short', '12345678";passwordAdmin="x', 'bad\nconfig', '$(id)_long_enough']) invalid(() => armaServerConfig(profile(), { serverPassword: password }));
});

test('Arma mod and admin identity inputs reject traversal, chaining, duplicate IDs and non-player accounts', () => {
  assert.deepEqual(armaWorkshopIds(['123456', '789012']), ['123456', '789012']);
  for (const values of [['../other'], ['123456;exit'], ['012345'], [123456], ['123456', '123456'], ['123456\nquit'], Array.from({ length: 31 }, (_, index) => String(100000 + index)), '123456']) invalid(() => armaWorkshopIds(values));
  assert.deepEqual(armaAdminSteamIds(['76561198000000001']), ['76561198000000001']);
  assert.equal(armaAdminConfig([]), 'admins[] = {};\n');
  for (const values of [['76561197960265728'], ['76561202255233024'], ['STEAM_0:1:12345'], ['76561198000000001', '76561198000000001'], [76561198000000001], ['76561198000000001";'], Array.from({ length: 21 }, (_, index) => String(76561198000000001n + BigInt(index)))]) invalid(() => armaAdminSteamIds(values));
  for (const patch of [{ port: '2302;id' }, { port: 65532 }, { port: 22 }, { loader: 'native' }, { version: 'development' }, { gameId: 'minecraft' }, { maxPlayers: 33 }]) invalid(() => definition(patch));
});

test('Arma installer copies only selected numeric mod directories and signature keys after rejecting unsafe library objects', () => {
  const value = definition({ workshopIds: ['123456', '789012'] });
  const install = commands(value);
  assert.match(install, /find \/gameswitch-library\/server -mindepth 1 ! -type f ! -type d -printf x -quit/);
  assert.match(install, /find \/gameswitch-library\/mods\/123456 -type f -links \+1/);
  assert.match(install, /cp -R --no-preserve=ownership \/gameswitch-library\/mods\/123456 \/pufferpanel\/mods\//);
  assert.match(install, /\/gameswitch-library\/mods\/789012\/keys\/\*\.bikey/);
  assert.ok(!install.includes('/gameswitch-library/mods/.'));
  assert.ok(!install.includes('/gameswitch-library/keys'));
  assert.match(install, /Conflicting game signature keys/);
  assert.match(launch(value), /"-mod=mods\/123456;mods\/789012"/);
});

test('Arma keeps profiles and logs persistent while Steam API cache is ephemeral and shutdown is graceful', () => {
  const value = definition();
  assert.equal(value.run.environmentVars.HOME, '/pufferpanel/arma-home');
  assert.equal(value.run.command, '/bin/sh /pufferpanel/arma/launch.sh');
  assert.match(launch(value), /exec \/pufferpanel\/arma3server_x64 /);
  assert.match(launch(value), /\.local\/share\/Arma 3 - Other Profiles/);
  assert.match(launch(value), /\.steam\/sdk64\/steamclient\.so/);
  assert.ok(!launch(value).includes('-profiles=')); assert.ok(!launch(value).includes('-noLogs'));
  assert.match(value.environment.hostConfig.Tmpfs['/pufferpanel/arma-home/.steam'], /uid=1000,gid=1000,mode=0700/);
  assert.equal(value.environment.hostConfig.Tmpfs['/tmp'], 'rw,noexec,nosuid,size=512m');
  const homeIndex = value.install.findIndex(step => step.target === 'arma-home/.steam');
  const containerIndex = value.install.findIndex(step => step.type === 'command');
  assert.ok(homeIndex >= 0 && homeIndex < containerIndex, 'Puffer must own the nested mount parent before the first container');
  assert.equal(value.run.stopCode, 2); assert.equal(value.run.stdin.type, 'stdin');
  assert.equal(value.run.autorecover, false); assert.equal(value.run.autorestart, false);
  assert.ok(!value.environment.portBindings.some(port => /\/tcp$/.test(port)));
});

test('generated Arma install and launch shell is syntactically valid without executing any installer', t => {
  const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh';
  if (!fs.existsSync(shell)) return t.skip('No local POSIX shell is available for syntax-only validation');
  const value = definition({ workshopIds: ['123456', '789012'] });
  for (const script of [...value.install.flatMap(step => step.commands || []), launch(value)]) {
    const result = spawnSync(shell, ['-n'], { input: script, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('shared definition factory routes Arma to the hardened library-backed template', () => {
  const value = buildDefinition(profile(), config());
  assert.equal(value.type, 'arma3');
  assert.deepEqual(value.environment.portBindings, [2302, 2303, 2304, 2305, 2306].map(port => `0.0.0.0:${port}:${port}/udp`));
});
