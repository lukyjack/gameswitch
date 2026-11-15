import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { buildDefinition } from './templates.mjs';
import { consoleCommandSchema } from './console-command.mjs';
import { ftbEnvironment } from './minecraft-memory.mjs';

export class SandboxRuntime {
  constructor(config) { this.config = config; this.directory = path.join(config.dataDir, 'sandbox'); }
  async read(profile) {
    try { return JSON.parse(await fs.readFile(path.join(this.directory, `${profile.id}.json`), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { running: false, installed: false, saves: 0, lines: ['Sandbox: Hier läuft kein echter Spielserver.'] }; }
  }
  async write(profile, state) {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, `${profile.id}.json`);
    const temporary = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await fs.rename(temporary, file);
  }
  async status(profile) { return this.read(profile); }
  async install(profile) { const state = await this.read(profile); state.installed = true; state.lines.push('Sandbox: Installation geprüft.'); await this.write(profile, state); await delay(200); }
  async save(profile) { const state = await this.read(profile); state.saves += 1; state.lines.push('Sandbox: Spielstand gespeichert.'); await this.write(profile, state); }
  async stop(profile) { const state = await this.read(profile); state.running = false; state.lines.push('Sandbox: Instanz sauber beendet.'); await this.write(profile, state); await delay(200); }
  async start(profile) { const state = await this.read(profile); state.running = true; state.lines.push('Sandbox: Instanz gestartet.'); await this.write(profile, state); await delay(250); }
  async backup(profile, name) {
    const state = await this.read(profile);
    if (state.running) throw new Error('Backups benötigen eine gestoppte Instanz.');
    const id = randomUUID();
    await fs.mkdir(path.join(this.directory, 'backups'), { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(this.directory, 'backups', `${id}.json`), JSON.stringify(state), { mode: 0o600, flag: 'wx' });
    await delay(200);
    return { runtimeId: id, name };
  }
  async restore(profile, backup) {
    if ((await this.read(profile)).running) throw new Error('Wiederherstellung benötigt eine gestoppte Instanz.');
    const state = JSON.parse(await fs.readFile(path.join(this.directory, 'backups', `${backup.runtimeId}.json`), 'utf8'));
    state.running = false;
    state.lines.push('Sandbox: Sicherung wiederhergestellt.');
    await this.write(profile, state);
  }
  async console(profile) { return (await this.read(profile)).lines.slice(-100); }
  async command(profile, input) {
    const { command } = consoleCommandSchema.parse({ command: input });
    const state = await this.read(profile);
    if (!state.running) throw Object.assign(new Error('Der Minecraft-Server läuft gerade nicht.'), { status: 409 });
    state.lines.push(`Sandbox: > ${command}`, 'Sandbox: Befehl simuliert; keine echte Spielwelt verändert.');
    state.lines = state.lines.slice(-200);
    await this.write(profile, state);
  }
}

export class PufferRuntime {
  constructor(config, fetcher = fetch) { this.config = config; this.fetcher = fetcher; this.token = null; this.expires = 0; }
  async authorize() {
    if (this.token && this.expires > Date.now()) return this.token;
    const response = await this.fetcher(`${this.config.pufferUrl}/oauth2/token`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.config.clientId, client_secret: this.config.clientSecret }),
    });
    if (!response.ok) throw new Error('Anmeldung bei der Laufzeit fehlgeschlagen. OAuth-Zugang serverseitig prüfen.');
    const data = await response.json();
    if (typeof data.access_token !== 'string') throw new Error('Ungültige Laufzeit-Anmeldung.');
    this.token = data.access_token;
    this.expires = Date.now() + (Number(data.expires_in || 300) - 30) * 1000;
    return this.token;
  }
  async request(endpoint, { method = 'GET', body, text = false, timeout = 120000 } = {}) {
    const token = await this.authorize();
    const response = await this.fetcher(`${this.config.pufferUrl}${endpoint}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': text ? 'text/plain' : 'application/json' } : {}) },
      ...(body !== undefined ? { body: text ? body : JSON.stringify(body) } : {}),
    });
    if (!response.ok) { const error = new Error(`Laufzeit-Anfrage fehlgeschlagen (${response.status}). Aktion wurde angehalten.`); error.status = response.status; throw error; }
    if (response.status === 204) return null;
    const reader = response.body?.getReader();
    const chunks = []; let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 8_000_000) { await reader.cancel(); throw new Error('Laufzeit-Antwort zu groß.'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    const content = Buffer.concat(chunks).toString('utf8');
    return content ? JSON.parse(content) : null;
  }
  endpoint(profile) { return `/api/servers/${encodeURIComponent(profile.serverId)}`; }
  async status(profile) {
    try {
      const status = await this.request(`${this.endpoint(profile)}/status`);
      if (status.gameswitchVersion !== 1) throw new Error('Die Laufzeit benötigt den GameSwitch-Backup-Sicherheitspatch.');
      if (status.backingUp || status.restoring || status.installing) throw new Error('Die Laufzeit arbeitet noch an Installation oder Sicherung.');
      return status;
    } catch (error) { if (error.status === 404 && !profile.installed) return { running: false, provisioned: false }; throw error; }
  }
  async install(profile) {
    let exists = false;
    try { await this.request(this.endpoint(profile)); exists = true; }
    catch (error) { if (error.status !== 404) throw error; }
    if (!exists) await this.request(this.endpoint(profile), { method: 'PUT', body: buildDefinition(profile, this.config) });
    await this.status(profile); // Require patched daemon before any installation/start.
    await this.request(`${this.endpoint(profile)}/install?wait=true`, { method: 'POST', timeout: 1800000 });
  }
  async save(profile) {
    if (profile.gameId === 'minecraft') await this.request(`${this.endpoint(profile)}/console`, { method: 'POST', body: 'save-all flush', text: true });
    // GMod persists game state via its graceful exit; no arbitrary user commands.
  }
  async stop(profile) {
    await this.request(`${this.endpoint(profile)}/stop?wait=true&skipRestart=true`, { method: 'POST', timeout: 180000 });
    if ((await this.status(profile)).running) throw new Error('Instanz wurde nicht beendet. Wechsel abgebrochen.');
  }
  async start(profile) {
    if (profile.gameId === 'minecraft' && profile.loader === 'ftb') {
      if ((await this.status(profile)).running) throw Object.assign(new Error('Dieses Profil läuft bereits. Es wurde nicht neu gestartet.'), { status: 409 });
      const definition = await this.request(`${this.endpoint(profile)}/definition`);
      const environment = ftbEnvironment(profile, definition.run.environmentVars);
      const limit = profile.memoryMb * 1024 * 1024;
      const nanoCpus = this.config.cpuCores * 1_000_000_000;
      const changed = definition.environment.hostConfig.Memory !== limit || definition.environment.hostConfig.MemorySwap !== limit || definition.environment.hostConfig.NanoCpus !== nanoCpus || JSON.stringify(environment) !== JSON.stringify(definition.run.environmentVars);
      if (changed) {
        definition.run.environmentVars = environment;
        definition.environment.hostConfig.Memory = limit;
        definition.environment.hostConfig.MemorySwap = limit;
        definition.environment.hostConfig.NanoCpus = nanoCpus;
        await this.request(`${this.endpoint(profile)}/definition`, { method: 'PUT', body: definition });
      }
    }
    await this.request(`${this.endpoint(profile)}/start?wait=true`, { method: 'POST', timeout: 180000 });
    await delay(1200);
    if (!(await this.status(profile)).running) throw new Error('Spielprozess ist beim Start beendet worden. Konsole prüfen.');
  }
  async backup(profile, name) {
    if ((await this.status(profile)).running) throw new Error('Backups benötigen eine gestoppte Instanz.');
    await this.request(`${this.endpoint(profile)}/backup/create?${new URLSearchParams({ name, wait: 'true' })}`, { method: 'POST', timeout: 1800000 });
    const status = await this.status(profile);
    if (status.backup?.state !== 'succeeded') throw new Error('Laufzeit hat die Sicherung nicht erfolgreich abgeschlossen.');
    const backups = await this.request(`${this.endpoint(profile)}/backup`);
    const backup = (Array.isArray(backups) ? backups : backups?.backups || []).find(item => item.name === name && item.fileName === status.backup.fileName);
    if (!backup) throw new Error('Abgeschlossene Sicherung ist im Sicherungskatalog nicht nachweisbar.');
    return { runtimeId: String(backup.id), name };
  }
  async restore(profile, backup) {
    if ((await this.status(profile)).running) throw new Error('Wiederherstellung benötigt eine gestoppte Instanz.');
    await this.request(`${this.endpoint(profile)}/backup/restore/${encodeURIComponent(backup.runtimeId)}?wait=true`, { method: 'POST', timeout: 1800000 });
    const status = await this.status(profile);
    if (status.restore?.state !== 'succeeded') throw new Error('Wiederherstellung wurde nicht bestätigt. Instanz bleibt gestoppt.');
  }
  async console(profile) {
    const data = await this.request(`${this.endpoint(profile)}/console`, { timeout: 15000 });
    const text = typeof data?.logs === 'string' ? Buffer.from(data.logs, 'base64').toString('utf8') : '';
    return text.slice(-32000).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/).slice(-150);
  }
  async command(profile, input) {
    const { command } = consoleCommandSchema.parse({ command: input });
    const status = await this.status(profile);
    if (!status.running) throw Object.assign(new Error('Der Minecraft-Server läuft gerade nicht.'), { status: 409 });
    try {
      await this.request(`${this.endpoint(profile)}/console`, { method: 'POST', body: command, text: true, timeout: 15000 });
    } catch {
      throw Object.assign(new Error('Die Bestätigung fehlt. Der Befehl kann bereits ausgeführt worden sein. Bitte die Konsole prüfen; es wird nicht automatisch erneut gesendet.'), { code: 'CONSOLE_DELIVERY_UNCERTAIN' });
    }
  }
}
