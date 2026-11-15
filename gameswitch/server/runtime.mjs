import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { buildDefinition } from './templates.mjs';
import { catalog } from './catalog.mjs';
import { parseConsoleCommand } from './console-command.mjs';
import { ftbEnvironment } from './minecraft-memory.mjs';
import { readProfileSecrets } from './profile-secrets.mjs';
import { mergeAdminFile } from './game-admin.mjs';
import { executeLocalRcon } from './rcon-client.mjs';
import { validateGamePorts } from './game-ports.mjs';
import { validateRootSteamCache, validateSteamCacheEntries } from './steam-cache.mjs';
import { requireGameLibrary } from './game-library.mjs';
import { armaAdminConfig } from './arma.mjs';
import { upstreamFailure, networkFailure } from './diagnostics.mjs';

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
  async preflight(profile) { validateGamePorts(profile, this.config); }
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
    const { command } = parseConsoleCommand(profile, { command: input });
    const state = await this.read(profile);
    if (state.running !== true) throw Object.assign(new Error('Der Spielserver läuft gerade nicht.'), { status: 409 });
    state.lines.push(`Sandbox: > ${command}`, 'Sandbox: Befehl simuliert; keine echte Spielwelt verändert.');
    state.lines = state.lines.slice(-200);
    await this.write(profile, state);
  }
  async admin(profile, action) {
    const state = await this.read(profile);
    if (action.kind === 'command') {
      if (state.ulxAvailable === false) throw Object.assign(new Error('ULX und ULib müssen in der Workshop-Collection installiert sein.'), { status: 409 });
      await this.command(profile, action.command);
      return { simulated: true, requiresRestart: false };
    }
    if (state.running !== false) throw Object.assign(new Error('Für diese Adminliste muss ein gestopptes Profil bestätigt sein.'), { status: 409 });
    state.adminFiles ||= {};
    if (profile.gameId === 'arma3' && state.adminFiles[action.path] === undefined) state.adminFiles[action.path] = armaAdminConfig(profile.adminSteamIds);
    state.adminFiles[action.path] = mergeAdminFile(action, state.adminFiles[action.path] || '');
    state.lines.push('Sandbox: Adminliste simuliert gespeichert; keine echten Spielrechte verändert.');
    await this.write(profile, state);
    return { simulated: true, requiresRestart: true };
  }
}

export class PufferRuntime {
  constructor(config, fetcher = fetch) { this.config = config; this.fetcher = fetcher; this.token = null; this.expires = 0; this.commandOutputs = new Map(); }
  async authorize() {
    if (this.token && this.expires > Date.now()) return this.token;
    let response;
    try { response = await this.fetcher(`${this.config.pufferUrl}/oauth2/token`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.config.clientId, client_secret: this.config.clientSecret }),
    }); } catch (error) { throw networkFailure(error); }
    if (!response.ok) throw await upstreamFailure(response, 'oauth');
    let data;
    try { data = await response.json(); }
    catch { throw Object.assign(new Error('Die Server-Laufzeit hat ungültiges JSON geliefert.'), { diagnosticReason: 'invalid_upstream_response' }); }
    if (typeof data.access_token !== 'string') throw Object.assign(new Error('Ungültige Laufzeit-Anmeldung.'), { diagnosticReason: 'upstream_auth' });
    this.token = data.access_token;
    this.expires = Date.now() + (Number(data.expires_in || 300) - 30) * 1000;
    return this.token;
  }
  async request(endpoint, { method = 'GET', body, text = false, raw = false, maxBytes = 8_000_000, timeout = 120000 } = {}) {
    const token = await this.authorize();
    let response;
    try { response = await this.fetcher(`${this.config.pufferUrl}${endpoint}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': text ? 'text/plain' : 'application/json' } : {}) },
      ...(body !== undefined ? { body: text ? body : JSON.stringify(body) } : {}),
    }); } catch (error) { throw networkFailure(error); }
    if (!response.ok) {
      const cleanPath = endpoint.split('?')[0];
      const operation = cleanPath.includes('/backup/restore/') ? 'restore' : cleanPath.includes('/backup') ? 'backup' : cleanPath.includes('/file/') ? 'file' : ['status', 'start', 'stop', 'install', 'console', 'definition'].find(value => cleanPath.endsWith(`/${value}`)) || 'server';
      throw await upstreamFailure(response, operation);
    }
    if (response.status === 204) return null;
    const reader = response.body?.getReader();
    const chunks = []; let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) { await reader.cancel(); throw Object.assign(new Error('Laufzeit-Antwort zu groß.'), { diagnosticReason: 'response_too_large' }); }
          chunks.push(value);
        }
      } catch (error) {
        if (error.diagnosticReason === 'response_too_large') throw error;
        throw networkFailure(error);
      } finally { reader.releaseLock(); }
    }
    const content = Buffer.concat(chunks).toString('utf8');
    if (raw) return content;
    try { return content ? JSON.parse(content) : null; }
    catch { throw Object.assign(new Error('Die Server-Laufzeit hat ungültiges JSON geliefert.'), { diagnosticReason: 'invalid_upstream_response' }); }
  }
  endpoint(profile) { return `/api/servers/${encodeURIComponent(profile.serverId)}`; }
  async status(profile) {
    try {
      const status = await this.request(`${this.endpoint(profile)}/status`);
      if (status.gameswitchVersion !== 1) throw new Error('Die Laufzeit benötigt den GameSwitch-Backup-Sicherheitspatch.');
      if (typeof status.running !== 'boolean') throw new Error('Der Laufzeitstatus ist unklar. Aktion wurde angehalten.');
      if (status.backingUp || status.restoring || status.installing) throw new Error('Die Laufzeit arbeitet noch an Installation oder Sicherung.');
      return status;
    } catch (error) { if (error.status === 404 && !profile.installed) return { running: false, provisioned: false }; throw error; }
  }
  async install(profile) {
    await requireGameLibrary(this.config, profile);
    let exists = false;
    try { await this.request(this.endpoint(profile)); exists = true; }
    catch (error) { if (error.status !== 404) throw error; }
    if (!exists) {
      const profileSecrets = ['valheim', 'squad', 'factorio', 'arma3', 'dayz'].includes(profile.gameId) ? await readProfileSecrets(this.config, profile.id) : {};
      await this.request(this.endpoint(profile), { method: 'PUT', body: buildDefinition(profile, { ...this.config, profileSecrets }) });
    }
    await this.status(profile); // Require patched daemon before any installation/start.
    await this.request(`${this.endpoint(profile)}/install?wait=true`, { method: 'POST', timeout: 1800000 });
  }
  async preflight(profile) {
    await requireGameLibrary(this.config, profile);
    if (!catalog.some(game => game.id === profile.gameId && game.available !== false)) throw Object.assign(new Error('Dieses Spiel ist auf diesem Host nicht verfügbar.'), { status: 400 });
    validateGamePorts(profile, this.config);
    if (['valheim', 'squad', 'factorio', 'arma3', 'dayz'].includes(profile.gameId)) {
      const secrets = await readProfileSecrets(this.config, profile.id);
      if ((['valheim', 'factorio', 'arma3', 'dayz'].includes(profile.gameId) && !secrets.serverPassword) || (profile.gameId === 'squad' && !secrets.rconPassword)) throw Object.assign(new Error('Erforderliche private Spieleinstellungen fehlen. Die laufende Instanz bleibt unverändert.'), { status: 409 });
    }
  }
  async save(profile) {
    if (profile.gameId === 'minecraft') await this.request(`${this.endpoint(profile)}/console`, { method: 'POST', body: 'save-all flush', text: true });
    if (profile.gameId === 'terraria') await this.request(`${this.endpoint(profile)}/console`, { method: 'POST', body: 'save', text: true });
    if (profile.gameId === 'factorio') await this.request(`${this.endpoint(profile)}/console`, { method: 'POST', body: `/save ${profile.worldName || 'World'}`, text: true });
    // The other games persist through their server-specific graceful shutdown.
  }
  async stop(profile) {
    await this.request(`${this.endpoint(profile)}/stop?wait=true&skipRestart=true`, { method: 'POST', timeout: 180000 });
    if ((await this.status(profile)).running) throw new Error('Instanz wurde nicht beendet. Wechsel abgebrochen.');
  }
  async start(profile) {
    if (profile.gameId) validateGamePorts(profile, this.config);
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
    await this.prepareSteamCache(profile);
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
    let text = typeof data?.logs === 'string' ? Buffer.from(data.logs, 'base64').toString('utf8') : '';
    const replies = this.commandOutputs.get(profile.id) || [];
    if (replies.length) text += '\n' + replies.join('\n');
    if (['valheim', 'squad', 'factorio', 'arma3', 'dayz'].includes(profile.gameId)) {
      const secrets = await readProfileSecrets(this.config, profile.id);
      for (const value of Object.values(secrets)) if (value) text = text.split(value).join('[vertraulich]');
    }
    return text.slice(-32000).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/).slice(-180);
  }
  async command(profile, input) {
    const { command } = parseConsoleCommand(profile, { command: input });
    const status = await this.status(profile);
    if (status.running !== true) throw Object.assign(new Error('Der Spielserver läuft gerade nicht.'), { status: 409 });
    if (profile.gameId === 'squad') {
      const { rconPassword } = await readProfileSecrets(this.config, profile.id);
      if (!rconPassword) throw Object.assign(new Error('Die private RCON-Konfiguration fehlt. Bitte den Geheimnisspeicher prüfen.'), { status: 503 });
      try {
        const output = await executeLocalRcon({ port: 21114, password: rconPassword, command });
        this.commandOutputs.set(profile.id, [...(this.commandOutputs.get(profile.id) || []), ...output.split(/\r?\n/).map(line => `[RCON] ${line}`)].slice(-60));
      } catch (error) {
        if (error.partialOutput) this.commandOutputs.set(profile.id, [...(this.commandOutputs.get(profile.id) || []), ...error.partialOutput.split(/\r?\n/).map(line => `[RCON, unbestätigt] ${line}`)].slice(-60));
        throw error;
      }
      return;
    }
    try {
      await this.request(`${this.endpoint(profile)}/console`, { method: 'POST', body: command, text: true, timeout: 15000 });
    } catch {
      throw Object.assign(new Error('Die Bestätigung fehlt. Der Befehl kann bereits ausgeführt worden sein. Bitte die Konsole prüfen; es wird nicht automatisch erneut gesendet.'), { code: 'CONSOLE_DELIVERY_UNCERTAIN' });
    }
  }
  fileEndpoint(profile, file) { return `${this.endpoint(profile)}/file/${file.split('/').map(encodeURIComponent).join('/')}`; }
  async prepareSteamCache(profile) {
    if (!['gmod', 'valheim', 'squad'].includes(profile.gameId)) return;
    if ((await this.status(profile)).running !== false) throw Object.assign(new Error('Steam-Cache-Pflege benötigt einen bestätigten Stopp.'), { status: 409 });
    const root = await this.request(this.fileEndpoint(profile, ''), { maxBytes: 1024 * 1024, timeout: 15000 });
    if (validateRootSteamCache(root) === 'absent') return;
    const entries = await this.request(this.fileEndpoint(profile, '.steam'), { maxBytes: 32 * 1024, timeout: 15000 });
    validateSteamCacheEntries(entries);
    if ((await this.status(profile)).running !== false) throw Object.assign(new Error('Die Instanz läuft oder ihr Status ist unklar. Steam-Cache bleibt unverändert.'), { status: 409 });
    const freshRoot = await this.request(this.fileEndpoint(profile, ''), { maxBytes: 1024 * 1024, timeout: 15000 });
    if (validateRootSteamCache(freshRoot) === 'absent') return;
    const freshEntries = await this.request(this.fileEndpoint(profile, '.steam'), { maxBytes: 32 * 1024, timeout: 15000 });
    validateSteamCacheEntries(freshEntries);
    // Only the fixed, recreatable Steam cache is removed while stopped. The
    // daemon unlinks its child links without following them; archive checks stay strict.
    await this.request(this.fileEndpoint(profile, '.steam'), { method: 'DELETE', timeout: 15000 });
  }
  async readAdminFile(profile, file) {
    try { return await this.request(this.fileEndpoint(profile, file), { raw: true, maxBytes: 256 * 1024, timeout: 15000 }); }
    catch (error) { if (error.status === 404) return ''; throw error; }
  }
  async admin(profile, action) {
    if (action.kind === 'command') {
      try {
        for (const file of ['garrysmod/data/ulx', 'garrysmod/data/ulib']) await this.request(this.fileEndpoint(profile, file), { timeout: 15000 });
      } catch (error) {
        if (error.status === 404) throw Object.assign(new Error('Der ULX-Helfer benötigt ULX und ULib in der Workshop-Collection. Bitte erst installieren und starten.'), { status: 409 });
        throw error;
      }
      await this.command(profile, action.command);
      return { requiresRestart: false };
    }
    if ((await this.status(profile)).running !== false) throw Object.assign(new Error('Für diese Adminliste muss ein gestopptes Profil bestätigt sein.'), { status: 409 });
    const original = await this.readAdminFile(profile, action.path);
    const updated = mergeAdminFile(action, original);
    if (updated === original) return { requiresRestart: true };
    await this.request(this.fileEndpoint(profile, `${action.path}.gameswitch-${randomUUID()}.bak`), { method: 'PUT', body: original, text: true, timeout: 15000 });
    if ((await this.status(profile)).running !== false) throw Object.assign(new Error('Die Instanz läuft oder ihr Status ist unklar. Die Adminliste wurde nicht verändert.'), { status: 409 });
    try { await this.request(this.fileEndpoint(profile, action.path), { method: 'PUT', body: updated, text: true, timeout: 15000 }); }
    catch { throw Object.assign(new Error('Die Bestätigung der Adminliste fehlt. Bitte Konfiguration prüfen; es wird nicht automatisch erneut geschrieben.'), { code: 'ADMIN_WRITE_UNCERTAIN' }); }
    return { requiresRestart: true };
  }
}
