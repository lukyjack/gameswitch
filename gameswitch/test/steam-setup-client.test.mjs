import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setImmediate as immediate } from 'node:timers/promises';
import { SteamSetup } from '../server/steam-setup.mjs';

const privateFixture = 'Fixture_Private_Steam_Input_2026';

async function waitFor(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('The local fake broker did not complete its expected transition');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function fixture(t, onFrame = (frame, socket, send) => {
  if (frame.type === 'start') send(socket, { type: 'started' });
  if (frame.type === 'cancel') send(socket, { type: 'exit', code: 130 });
}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gameswitch-steam-client-'));
  const socketPath = process.platform === 'win32' ? String.raw`\\.\pipe\gameswitch-steam-test-${randomUUID()}` : path.join(directory, 'control.sock');
  const sockets = new Set(), frames = [];
  const send = (socket, event) => socket.write(JSON.stringify(event) + '\n');
  let currentSocket;
  const server = net.createServer(socket => {
    currentSocket = socket;
    sockets.add(socket);
    let pending = '';
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.on('data', chunk => {
      pending += chunk.toString('utf8');
      let offset;
      while ((offset = pending.indexOf('\n')) >= 0) {
        const frame = JSON.parse(pending.slice(0, offset));
        pending = pending.slice(offset + 1);
        frames.push(frame);
        onFrame(frame, socket, send);
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  if (process.platform !== 'win32') await fs.chmod(socketPath, 0o660);
  const manager = new SteamSetup({ steamSetupSocket: socketPath });
  if (process.platform === 'win32' || process.getuid?.() !== 0) {
    // Named pipes do not have a Unix socket inode; non-root test runners cannot
    // create a root-owned fixture. Linux root QA exercises the real check.
    const status = manager.status.bind(manager);
    manager.status = async () => ({ ...await status(), enabled: true });
  }
  t.after(async () => {
    await manager.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { manager, frames, send, socket: () => currentSocket };
}

test('Steam IPC handshake, private input and cancel each use one fixed frame without retaining credentials', async t => {
  const f = await fixture(t);
  const session = await f.manager.start({ gameId: 'dayz', workshopIds: ['1559212036'] });
  assert.equal(session.gameId, 'dayz');
  assert.equal(session.state, 'running');
  assert.deepEqual(f.frames, [{ type: 'start', gameId: 'dayz', workshopIds: ['1559212036'] }]);
  await assert.rejects(f.manager.start({ gameId: 'arma3', workshopIds: [] }), error => error.status === 409);
  await f.manager.input(session.id, `  ${privateFixture}  `);
  await waitFor(() => f.frames.some(frame => frame.type === 'input'));
  assert.deepEqual(f.frames.filter(frame => frame.type === 'input'), [{ type: 'input', data: `  ${privateFixture}  ` }]);
  assert.ok(!JSON.stringify(await f.manager.status()).includes(privateFixture));
  assert.ok(!JSON.stringify(f.manager.session.events).includes(privateFixture));
  await f.manager.cancel(session.id);
  await waitFor(() => f.manager.session.state === 'cancelled');
  assert.deepEqual(f.frames.filter(frame => frame.type === 'cancel'), [{ type: 'cancel' }]);
  assert.equal((await f.manager.status()).active, false);
  const before = f.frames.length;
  await assert.rejects(f.manager.input(session.id, privateFixture), error => error.status === 409);
  assert.equal(f.frames.length, before);
});

test('malformed or private broker failure frames fail closed without raw errors or process crashes', async t => {
  for (const raw of ['null\n', '[]\n', JSON.stringify({ type: 'error', reason: privateFixture }) + '\n', 'x'.repeat(8193) + '\n']) {
    await t.test(raw.startsWith('x') ? 'oversized frame' : raw.startsWith('{') ? 'unknown private reason' : raw.trim(), async st => {
      const f = await fixture(st, (frame, socket) => { if (frame.type === 'start') socket.write(raw); });
      await assert.rejects(f.manager.start({ gameId: 'arma3', workshopIds: [] }), error => error.status === 503 && !error.message.includes(privateFixture));
      assert.equal((await f.manager.status()).active, false);
      assert.ok(!JSON.stringify(f.manager.session.events).includes(privateFixture));
    });
  }
});

test('Steam output history is bounded and a throwing subscriber cannot interrupt later output or completion', async t => {
  const f = await fixture(t);
  const session = await f.manager.start({ gameId: 'arma3', workshopIds: [] });
  f.manager.subscribe(session.id, () => { throw new Error(privateFixture); });
  await immediate();
  assert.equal(f.manager.session.subscribers.size, 0);
  for (let index = 0; index < 100; index++) {
    f.send(f.socket(), { type: 'output', data: Buffer.from(`chunk-${index}:` + 'x'.repeat(4000)).toString('base64') });
    await immediate();
  }
  await waitFor(() => f.manager.session.events.some(item => item.event.type === 'output' && Buffer.from(item.event.data, 'base64').toString().startsWith('chunk-99:')));
  assert.ok(f.manager.session.bytes <= 65536);
  assert.ok(f.manager.session.events.length < 20);
  const replay = [];
  const unsubscribe = f.manager.subscribe(session.id, event => replay.push(event));
  await immediate();
  assert.ok(replay.some(event => event.type === 'output' && Buffer.from(event.data, 'base64').toString().startsWith('chunk-99:')));
  assert.ok(!JSON.stringify(replay).includes(privateFixture));
  f.send(f.socket(), { type: 'exit', code: 0 });
  await waitFor(() => f.manager.session.state === 'finished');
  assert.ok(replay.some(event => event.type === 'exit' && event.code === 0));
  unsubscribe();
  assert.equal((await f.manager.status()).active, false);
});

test('closing the panel setup manager cancels its own connection and leaves no live IPC session', async t => {
  const f = await fixture(t);
  await f.manager.start({ gameId: 'dayz', workshopIds: [] });
  await f.manager.close();
  await waitFor(() => f.manager.session.state === 'cancelled');
  assert.deepEqual(f.frames.filter(frame => frame.type === 'cancel'), [{ type: 'cancel' }]);
  await assert.rejects(f.manager.start({ gameId: 'arma3', workshopIds: [] }), error => error.status === 503);
});
