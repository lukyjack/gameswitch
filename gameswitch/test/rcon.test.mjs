import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { executeLocalRcon } from '../server/rcon-client.mjs';

function packet(id, type, text = '') {
  const body = Buffer.from(text);
  const result = Buffer.alloc(body.length + 14);
  result.writeInt32LE(body.length + 10, 0); result.writeInt32LE(id, 4); result.writeInt32LE(type, 8); body.copy(result, 12);
  return result;
}
async function fixture(t, onPacket) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', data => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 4 && buffer.length >= buffer.readInt32LE(0) + 4) {
        const length = buffer.readInt32LE(0) + 4;
        const value = buffer.subarray(0, length); buffer = buffer.subarray(length);
        onPacket(socket, { id: value.readInt32LE(4), type: value.readInt32LE(8), text: value.subarray(12, length - 2).toString() });
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return server.address().port;
}

test('local RCON authenticates once and reassembles fragmented multipart command replies', async t => {
  const commands = []; let auth = 0;
  const port = await fixture(t, (socket, message) => {
    if (message.type === 3) {
      auth++; assert.equal(message.text, 'fixture-secret');
      const reply = packet(message.id, 2);
      socket.write(Buffer.concat([packet(message.id, 0), reply.subarray(0, 7)]));
      setTimeout(() => socket.write(reply.subarray(7)), 5);
    } else if (message.type === 2) {
      commands.push(message.text);
      socket.write(Buffer.concat([packet(message.id, 0, 'First line\n'), packet(message.id, 0, 'Second line')]));
    } else socket.write(packet(message.id, 0));
  });
  assert.equal(await executeLocalRcon({ port, password: 'fixture-secret', command: 'ListPlayers' }), 'First line\nSecond line');
  assert.equal(auth, 1); assert.deepEqual(commands, ['ListPlayers']);
});

test('RCON authentication failure never dispatches a command or reveals credentials', async t => {
  let commands = 0;
  const port = await fixture(t, (socket, message) => {
    if (message.type === 3) socket.write(packet(-1, 2));
    else commands++;
  });
  await assert.rejects(executeLocalRcon({ port, password: 'fixture-secret', command: 'ListPlayers' }), error => !error.code && !error.message.includes('fixture-secret'));
  assert.equal(commands, 0);
});

test('RCON waits for the explicit marker and preserves lines split across delayed packets', async t => {
  let marker; let firstResponseSent = false;
  const port = await fixture(t, (socket, message) => {
    if (message.type === 3) socket.write(packet(message.id, 2));
    else if (message.type === 2) {
      firstResponseSent = true;
      socket.write(packet(message.id, 0, 'STEAM_0:1:'));
      setTimeout(() => { socket.write(packet(message.id, 0, '1234\n')); socket.write(packet(marker, 0)); }, 300);
    } else { assert.equal(firstResponseSent, true); marker = message.id; }
  });
  assert.equal(await executeLocalRcon({ port, password: 'fixture-secret', command: 'ListPlayers' }), 'STEAM_0:1:1234\n');
});

test('missing RCON confirmation is uncertain and the command is never retried', async t => {
  let commands = 0;
  const port = await fixture(t, (socket, message) => {
    if (message.type === 3) socket.write(packet(message.id, 2));
    else if (message.type === 2) commands++;
  });
  await assert.rejects(executeLocalRcon({ port, password: 'fixture-secret', command: 'AdminBroadcast hello', timeout: 100 }), error => error.code === 'CONSOLE_DELIVERY_UNCERTAIN');
  assert.equal(commands, 1);
});

test('RCON rejects oversized packets before command dispatch', async t => {
  let commands = 0;
  const port = await fixture(t, (socket, message) => {
    if (message.type === 3) { const invalid = Buffer.alloc(4); invalid.writeInt32LE(1024 * 1024 + 1); socket.write(invalid); }
    else commands++;
  });
  await assert.rejects(executeLocalRcon({ port, password: 'fixture-secret', command: 'ListPlayers' }), /Paketlänge/);
  assert.equal(commands, 0);
});
