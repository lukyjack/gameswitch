import net from 'node:net';
import { randomInt } from 'node:crypto';

const limit = 1024 * 1024;
const packet = (id, type, body = '') => {
  const content = Buffer.from(body, 'utf8');
  const result = Buffer.alloc(content.length + 14);
  result.writeInt32LE(content.length + 10, 0);
  result.writeInt32LE(id, 4);
  result.writeInt32LE(type, 8);
  content.copy(result, 12);
  return result;
};

// Local-only Source RCON. Authentication and command are each sent once.
export function executeLocalRcon({ port, password, command, timeout = 8000 }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || typeof password !== 'string' || !password || typeof command !== 'string' || !command || Buffer.byteLength(command) > 8192) {
    return Promise.reject(new Error('Ungültige interne RCON-Konfiguration.'));
  }
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const authId = randomInt(1000, 1_000_000);
    const commandId = authId + 1;
    const markerId = authId + 2;
    let buffer = Buffer.alloc(0), bytes = 0, dispatched = false, done = false;
    const replies = [];
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(deadline); socket.destroy();
      if (error) {
        if (dispatched) { error.code = 'CONSOLE_DELIVERY_UNCERTAIN'; error.partialOutput = Buffer.concat(replies).toString('utf8').replace(/\x00/g, ''); }
        reject(error);
      } else resolve(Buffer.concat(replies).toString('utf8').replace(/\x00/g, ''));
    };
    const deadline = setTimeout(() => finish(new Error('RCON-Bestätigung nicht rechtzeitig erhalten.')), timeout);
    socket.once('connect', () => socket.write(packet(authId, 3, password)));
    socket.on('error', () => finish(new Error('Interne RCON-Verbindung fehlgeschlagen.')));
    socket.on('close', () => { if (!done) finish(new Error('Interne RCON-Verbindung vor der Bestätigung geschlossen.')); });
    socket.on('data', chunk => {
      try {
        bytes += chunk.length;
        if (bytes > limit) throw new Error('RCON-Antwort überschreitet die Größenbegrenzung.');
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
          const size = buffer.readInt32LE(0);
          if (size < 10 || size > limit) throw new Error('Ungültige RCON-Paketlänge.');
          if (buffer.length < size + 4) break;
          const current = buffer.subarray(0, size + 4);
          buffer = buffer.subarray(size + 4);
          if (current[current.length - 1] !== 0 || current[current.length - 2] !== 0) throw new Error('Ungültiges RCON-Paketende.');
          const id = current.readInt32LE(4), type = current.readInt32LE(8);
          if (id === -1) throw new Error('Interne RCON-Anmeldung fehlgeschlagen.');
          if (!dispatched && id === authId && type === 2) {
            dispatched = true;
            socket.write(packet(commandId, 2, command));
            socket.write(packet(markerId, 0));
          } else if (dispatched && id === commandId && type === 0) {
            replies.push(current.subarray(12, current.length - 2));
          } else if (dispatched && id === markerId && type === 0) {
            finish(); return;
          }
        }
      } catch (error) { finish(error); }
    });
  });
}
