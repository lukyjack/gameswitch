import net from 'node:net';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const activeStates = new Set(['starting', 'running']);
const failure = (message, status = 503, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const unavailable = () => failure('Die geschützte Steam-Einrichtung ist momentan nicht erreichbar.');
const publicSession = session => ({ id: session.id, gameId: session.gameId, startedAt: session.startedAt, state: session.state });

export class SteamSetup {
  constructor(config) {
    this.socketPath = config.steamSetupSocket || '/run/gameswitch-steam-setup/control.sock';
    this.session = null; this.closed = false;
  }
  async status() {
    let enabled = false;
    try {
      const stat = await fs.lstat(this.socketPath);
      enabled = stat.isSocket() && (process.platform === 'win32' || (stat.uid === 0 && !(stat.mode & 0o007)));
    } catch { /* A missing local broker is a setup state, never an HTTP failure. */ }
    const session = this.session;
    return { enabled, active: Boolean(session && activeStates.has(session.state)), ...(session ? { session: publicSession(session) } : {}), ...(!enabled ? { reason: 'Die Steam-Einrichtung muss auf dem VPS aktiviert sein.' } : {}) };
  }
  get(id) {
    if (!this.session || this.session.id !== id) throw failure('Steam-Einrichtung nicht gefunden.', 404);
    return this.session;
  }
  emit(session, event) {
    const size = Buffer.byteLength(JSON.stringify(event));
    if (size > 8192) return;
    session.events.push({ event, size }); session.bytes += size;
    while (session.bytes > 65536 && session.events.length > 1) session.bytes -= session.events.shift().size;
    for (const callback of session.subscribers) { try { callback(event); } catch { session.subscribers.delete(callback); } }
  }
  finish(session, event) {
    if (!activeStates.has(session.state)) return;
    session.state = event.type === 'exit' && event.code === 0 ? 'finished' : session.cancelling ? 'cancelled' : 'failed';
    clearTimeout(session.deadline);
    this.emit(session, event);
    session.socket?.destroy();
  }
  async start({ gameId, workshopIds = [] }) {
    if (this.closed || !(await this.status()).enabled) throw unavailable();
    if (this.session && activeStates.has(this.session.state)) throw failure('Eine Steam-Einrichtung läuft bereits.', 409);
    const session = { id: randomUUID(), gameId, startedAt: new Date().toISOString(), state: 'starting', events: [], bytes: 0, subscribers: new Set(), cancelling: false };
    this.session = session;
    const socket = net.createConnection(this.socketPath);
    session.socket = socket;
    socket.setNoDelay(true);
    let pending = Buffer.alloc(0), confirmed = false;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.destroy(); reject(unavailable()); }, 10000);
        const settle = (error) => { clearTimeout(timer); error ? reject(error) : resolve(); };
        socket.once('connect', () => socket.write(JSON.stringify({ type: 'start', gameId, workshopIds }) + '\n'));
        socket.on('data', chunk => {
          pending = Buffer.concat([pending, chunk]);
          if (pending.length > 262144) { settle(unavailable()); this.finish(session, { type: 'error', reason: 'invalid_response' }); return; }
          let offset;
          while ((offset = pending.indexOf(10)) >= 0) {
            const line = pending.subarray(0, offset); pending = pending.subarray(offset + 1);
            let event;
            try { if (line.length > 8192) throw new Error(); event = JSON.parse(line.toString('utf8')); if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error(); } catch { settle(unavailable()); this.finish(session, { type: 'error', reason: 'invalid_response' }); return; }
            if (event.type === 'started') {
              if (confirmed) continue;
              confirmed = true; session.state = 'running'; this.emit(session, { type: 'started' }); settle();
            } else if (event.type === 'output' && typeof event.data === 'string' && event.data.length <= 6000 && /^[A-Za-z0-9+/]*={0,2}$/.test(event.data)) {
              this.emit(session, { type: 'output', data: event.data });
            } else if (event.type === 'exit' && Number.isInteger(event.code) && event.code >= -255 && event.code <= 255) {
              if (!confirmed) settle(unavailable());
              this.finish(session, { type: 'exit', code: event.code });
            } else if (event.type === 'error') {
              // Never reflect broker messages: only a closed reason vocabulary.
              const reason = ['busy', 'invalid_request', 'timeout', 'setup_failed', 'cancelled', 'unavailable'].includes(event.reason) ? event.reason : 'setup_failed';
              if (!confirmed) settle(reason === 'busy' ? failure('Eine Steam-Einrichtung läuft bereits.', 409) : unavailable());
              this.finish(session, { type: 'error', reason });
            } else { settle(unavailable()); this.finish(session, { type: 'error', reason: 'invalid_response' }); return; }
          }
          if (pending.length > 8192) { settle(unavailable()); this.finish(session, { type: 'error', reason: 'invalid_response' }); }
        });
        socket.on('error', () => { settle(unavailable()); this.finish(session, { type: 'error', reason: 'connection_closed' }); });
        socket.on('close', () => { if (!confirmed) settle(unavailable()); this.finish(session, { type: 'error', reason: 'connection_closed' }); });
      });
      if (activeStates.has(session.state)) {
        session.deadline = setTimeout(() => { this.cancel(session.id).catch(() => {}); }, 2 * 3600 * 1000);
        session.deadline.unref();
      }
      return publicSession(session);
    } catch (error) {
      this.finish(session, { type: 'error', reason: 'unavailable' });
      throw error;
    }
  }
  subscribe(id, callback) {
    const session = this.get(id);
    const history = session.events.map(item => item.event);
    session.subscribers.add(callback);
    queueMicrotask(() => { for (const event of history) { if (!session.subscribers.has(callback)) break; try { callback(event); } catch { session.subscribers.delete(callback); break; } } });
    return () => session.subscribers.delete(callback);
  }
  async send(session, frame) {
    if (!activeStates.has(session.state) || !session.socket || session.socket.destroyed) throw failure('Die Steam-Einrichtung nimmt gerade keine Eingabe an.', 409);
    if (session.cancelling && frame.type === 'input') throw failure('Die Steam-Einrichtung wird gerade beendet.', 409);
    await new Promise((resolve, reject) => session.socket.write(JSON.stringify(frame) + '\n', error => error ? reject(failure('Die Zustellung ist unbestätigt. Bitte die Ausgabe prüfen und die Eingabe nicht automatisch wiederholen.', 502, 'STEAM_INPUT_UNCERTAIN')) : resolve()));
  }
  async input(id, input) { await this.send(this.get(id), { type: 'input', data: input }); }
  async cancel(id) {
    const session = this.get(id);
    if (!activeStates.has(session.state)) return;
    session.cancelling = true;
    try { await this.send(session, { type: 'cancel' }); } catch { session.socket?.destroy(); }
  }
  async close() {
    this.closed = true;
    const session = this.session;
    if (!session || !activeStates.has(session.state)) return;
    await this.cancel(session.id);
    await new Promise(resolve => {
      if (!activeStates.has(session.state)) return resolve();
      const timer = setTimeout(() => { session.socket?.destroy(); resolve(); }, 12000);
      timer.unref();
      session.socket?.once('close', () => { clearTimeout(timer); resolve(); });
    });
  }
}
