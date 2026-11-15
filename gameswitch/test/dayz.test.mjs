import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayzDefinition, dayzSettings, dayzServerConfig, DAYZ_APP_ID, DAYZ_WORKSHOP_APP_ID, DAYZ_DEFAULT_MISSION } from '../server/dayz.mjs';

const profile = patch => ({ gameId: 'dayz', loader: 'steam', version: 'latest', name: 'Freunde Überleben', port: 2302, queryPort: 27016, maxPlayers: 20, memoryMb: 8192, ...patch });
const secrets = { serverPassword: 'Fixture_Only_DayZ_Password' };
const environment = () => ({ type: 'docker', image: 'steamcmd/steamcmd:latest', config: { User: '1000:1000' }, hostConfig: { CapDrop: ['ALL'], Privileged: false, SecurityOpt: ['no-new-privileges:true'], Memory: 8192 * 1024 * 1024, NanoCpus: 6_000_000_000, Binds: [] }, portBindings: ['0.0.0.0:2302:2302/udp', '0.0.0.0:2303:2303/udp', '0.0.0.0:27016:27016/udp'] });
const definition = (patch = {}, env = environment()) => buildDayzDefinition(profile(patch), { nodeId: 0, gameUid: 1000, gameGid: 1000, profileSecrets: secrets }, 'GameSwitch-fixture', env);
const launch = value => value.install.find(step => step.target === 'dayz-launch.sh').text;

test('DayZ uses the stable native Linux library without Steam authentication in game definitions', () => {
  const value = definition();
  assert.equal(DAYZ_APP_ID, '223350');
  assert.equal(DAYZ_WORKSHOP_APP_ID, '221100');
  assert.deepEqual(value.requirements, { os: 'linux', arch: 'amd64' });
  assert.equal(value.type, 'dayz');
  assert.ok(value.environment.hostConfig.Binds.includes('/var/lib/gameswitch-libraries/dayz:/gameswitch-library:ro'));
  const commands = value.install.flatMap(step => step.commands || []).join('\n');
  assert.ok(commands.includes('/gameswitch-library/server/DayZServer'));
  assert.ok(commands.includes('cp -a --no-preserve=ownership /gameswitch-library/server/. /pufferpanel/'));
  assert.ok(!/steamcmd \+|\+login|steam-password|credentials|workshop_download/.test(commands));
  assert.ok(!JSON.stringify(value.run).includes(secrets.serverPassword));
  assert.ok(!JSON.stringify(value.environment).includes(secrets.serverPassword));
  assert.equal(value.environment.config.User, '1000:1000');
  assert.deepEqual(value.environment.hostConfig.CapDrop, ['ALL']);
  assert.equal(value.environment.hostConfig.Privileged, false);
});

test('DayZ preserves native persistence and logs inside the backed-up profile volume', () => {
  const value = definition();
  assert.equal(value.run.environmentVars.HOME, '/pufferpanel/dayz-home');
  assert.equal(value.run.command, '/bin/sh /pufferpanel/dayz-launch.sh');
  assert.ok(launch(value).includes('exec /pufferpanel/DayZServer '));
  assert.ok(launch(value).includes('-profiles=/pufferpanel/profiles'));
  assert.ok(launch(value).includes('-dologs -adminlog -netlog -freezecheck'));
  assert.ok(!launch(value).includes('-noLogs'));
  assert.equal(value.environment.hostConfig.Tmpfs['/pufferpanel/dayz-home/.steam'], 'rw,exec,nosuid,nodev,size=128m,uid=1000,gid=1000,mode=0700');
  assert.equal(value.run.stopCode, 2);
  assert.equal(value.run.autorestart, false);
  assert.equal(value.run.autorecover, false);
  assert.equal(value.run.stdin.type, 'stdin');
  assert.equal(value.run.stdin.password, undefined);
  assert.equal(value.run.stdin.port, undefined);
  assert.ok(!JSON.stringify(value).includes('RConPassword'));
});

test('DayZ security config enforces signatures and build matching without automatic damaged-storage replacement', () => {
  const config = dayzServerConfig(profile(), secrets);
  for (const statement of ['verifySignatures = 2;', 'forceSameBuild = 1;', 'BattlEye = 1;', 'allowFilePatching = 0;', 'storageAutoFix = 0;', 'serverTimePersistent = 1;', 'instanceId = 1;', 'steamQueryPort = 27016;']) assert.ok(config.includes(statement), statement);
  assert.ok(config.includes(`template = "${DAYZ_DEFAULT_MISSION}";`));
  assert.ok(config.includes(`password = "${secrets.serverPassword}";`));
  assert.ok(config.includes('passwordAdmin = "";'));
  assert.ok(!config.includes('admins[]'));
  assert.throws(() => dayzServerConfig(profile(), {}), error => error.status === 400);
  assert.throws(() => dayzServerConfig(profile(), { serverPassword: 'bad";verifySignatures=0;' }), error => error.status === 400);
});

test('DayZ protects new config inside a private parent and preserves it on retry/reinstall', () => {
  const value = definition();
  const index = value.install.findIndex(step => step.target === 'gameswitch-dayz/serverDZ.cfg');
  assert.ok(index > 0);
  const previous = value.install.slice(0, index).flatMap(step => step.commands || []).join('\n');
  assert.ok(previous.includes('chmod 700 /pufferpanel/gameswitch-dayz'));
  assert.ok(!previous.includes(': >'));
  assert.equal(value.install[index].if, '!file_exists("gameswitch-dayz/serverDZ.cfg")');
  assert.ok(!previous.includes(secrets.serverPassword));
  assert.ok(value.install.slice(index + 1).flatMap(step => step.commands || []).includes('chmod 600 /pufferpanel/gameswitch-dayz/serverDZ.cfg'));
});

test('DayZ only loads explicitly selected numeric Workshop items and copies regular keys instead of links', () => {
  const ids = ['1559212036', '1564026768'];
  const value = definition({ workshopIds: ids });
  assert.ok(launch(value).includes('"-mod=mods/1559212036;mods/1564026768"'));
  const commands = value.install.flatMap(step => step.commands || []).join('\n');
  for (const id of ids) {
    assert.ok(commands.includes(`/gameswitch-library/mods/${id}/. /pufferpanel/mods/${id}/`));
    assert.ok(commands.includes(`/gameswitch-library/mods/${id}/keys/*.bikey`));
  }
  assert.ok(commands.includes('! -type f ! -type d -printf x -quit'));
  assert.ok(commands.includes('-type f -links +1 -printf x -quit'));
  assert.ok(commands.includes('! cmp -s "$key" "$dest"'));
  assert.ok(commands.includes('cp --no-preserve=ownership "$key" "$dest"'));
  assert.ok(!commands.includes('ln -s'));
  assert.ok(!launch(definition()).includes('-mod='));
  const original = environment();
  definition({}, original);
  assert.deepEqual(original.hostConfig.Binds, []);
});

test('DayZ rejects unverified branches, maps, slot counts, Workshop payloads and unsafe port sets', () => {
  for (const patch of [
    { gameId: 'arma3' }, { loader: 'native' }, { version: 'experimental' }, { mission: '../secret' }, { mission: 'dayzOffline.enoch' },
    { workshopIds: ['1559212036;quit'] }, { workshopIds: [1559212036] }, { workshopIds: ['0'] }, { workshopIds: ['1559212036', '1559212036'] },
    { workshopIds: Array.from({ length: 31 }, (_, index) => String(1559212000 + index)) }, { port: 65535 }, { queryPort: 2302 }, { queryPort: 2303 },
    { maxPlayers: 0 }, { maxPlayers: 41 }, { name: 'Line\nbreak' },
  ]) assert.throws(() => dayzSettings(profile(patch)), error => error.status === 400, JSON.stringify(patch));
  assert.throws(() => buildDayzDefinition(profile(), { profileSecrets: secrets }, 'fixture', { type: 'host' }), error => error.status === 400);
});

test('DayZ presentation names cannot introduce engine config statements or expand Puffer variables', () => {
  const value = dayzServerConfig(profile({ name: 'Name";verifySignatures=0;${port}\\next' }), secrets);
  assert.equal((value.match(/verifySignatures\s*=/g) || []).length, 1);
  assert.ok(value.includes('verifySignatures = 2;'));
  assert.ok(!value.includes('${port}'));
  assert.ok(!value.includes('\\next'));
  assert.equal(dayzSettings(profile()).hostname, 'Freunde Uberleben');
});
