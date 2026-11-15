import test from 'node:test';
import assert from 'node:assert/strict';
import { profileSchema } from '../server/catalog.mjs';
import { readConfig } from '../server/config.mjs';
import { buildDefinition } from '../server/templates.mjs';
import { parseConsoleCommand } from '../server/console-command.mjs';
import { PufferRuntime } from '../server/runtime.mjs';

const profile = () => ({ gameId: 'factorio', name: 'Factory friends', version: '2.1.24', loader: 'native', memoryMb: 4096, maxPlayers: 16, port: 34197, worldName: 'Factory_Test', serverPassword: 'Fixture_only_password' });

test('Factorio pins vendor integrity, keeps private authenticated joins and creates/loads the same native save location', () => {
  const value = profileSchema.parse(profile());
  const definition = buildDefinition(value, { ...readConfig({}), profileSecrets: { serverPassword: value.serverPassword } });
  const settings = JSON.parse(definition.install.find(step => step.target === 'server-settings.json').text);
  assert.deepEqual(settings.visibility, { public: false, lan: false });
  assert.equal(settings.require_user_verification, true);
  assert.equal(settings.allow_commands, 'admins-only');
  assert.equal(settings.game_password, value.serverPassword);
  assert.equal(settings.token, '');
  assert.equal(settings.non_blocking_saving, false);
  assert.ok(!definition.run.command.includes(value.serverPassword));
  const checksum = definition.install.find(step => step.target === 'factorio.sha256').text;
  assert.equal(checksum, 'c49b66cff90aceff87b30f2973af0df7f51712cb2ee3153e0169d9bed46a964f  factorio-headless_linux_2.1.24.tar.xz\n');
  const config = definition.install.find(step => step.target === 'config.ini').text;
  const writeData = /^write-data=(.+)$/m.exec(config)[1];
  const expected = `${writeData}/saves/${value.worldName}.zip`;
  const create = definition.install.flatMap(step => step.commands || []).find(command => command.includes('--create'));
  assert.ok(create.endsWith(`--create ${expected}`));
  assert.ok(definition.run.command.includes(`--start-server ${expected} `));
  assert.equal(definition.run.stop, '/quit');
  const mods = JSON.parse(definition.install.find(step => step.target === 'mods/mod-list.json').text).mods;
  assert.deepEqual(mods.filter(mod => mod.enabled).map(mod => mod.name), ['base']);
  assert.equal(profileSchema.safeParse({ ...value, version: 'latest' }).success, false);
  assert.equal(profileSchema.safeParse({ ...value, serverPassword: undefined }).success, false);
});

test('Factorio preserves required command slashes and saves through the native console basename', async () => {
  const value = profile();
  for (const command of ['/help', 'help']) assert.equal(parseConsoleCommand(value, { command }).command, '/help');
  assert.equal(parseConsoleCommand(value, { command: '/promote Factory_Player' }).command, '/promote Factory_Player');
  for (const command of ['/quit', '/exit', '/help;quit', '/"quit"']) assert.throws(() => parseConsoleCommand(value, { command }));
  const requests = [];
  const runtime = new PufferRuntime({ pufferUrl: 'https://runtime.example' }, async (url, options) => {
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'fixture' });
    requests.push({ url, ...options });
    return new Response(null, { status: 204 });
  });
  await runtime.save({ ...value, serverId: 'fixture' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body, '/save Factory_Test');
});
