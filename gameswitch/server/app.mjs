import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readConfig } from './config.mjs';
import { openStore } from './store.mjs';
import { catalog, profileSchema, adminPasswordSchema, parseCollection, providers } from './catalog.mjs';
import { SandboxRuntime, PufferRuntime } from './runtime.mjs';
import { Controller } from './controller.mjs';
import { parseConsoleCommand, safeCommandVerb } from './console-command.mjs';
import { FTB_NATIVE_RESERVE_MB } from './minecraft-memory.mjs';
import { validateGamePorts } from './game-ports.mjs';
import { writeProfileSecrets } from './profile-secrets.mjs';
import { buildAdminAction } from './game-admin.mjs';
import { createDiagnostics, validCorrelationId, friendlyDiagnosticMessage } from './diagnostics.mjs';
import { gameLibraryStatus } from './game-library.mjs';
import { SteamSetup } from './steam-setup.mjs';

const token = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const hashPassword = (password, salt) => scryptSync(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 }).toString('hex');
const credentials = z.object({ username: z.string().regex(/^[a-zA-Z0-9_-]{3,32}$/), password: z.string().min(14).max(128) }).strict();
const asyncRoute = callback => (req, res, next) => Promise.resolve(callback(req, res, next)).catch(next);
const profileFields = ['id', 'name', 'gameId', 'version', 'loader', 'modpackId', 'modpackVersion', 'modpackName', 'modpackVersionName', 'javaVersion', 'minimumMemoryMb', 'recommendedMemoryMb', 'collectionId', 'gamemode', 'map', 'mission', 'workshopIds', 'adminSteamIds', 'maxPlayers', 'memoryMb', 'port', 'queryPort', 'beaconPort', 'worldName', 'serverId', 'installed', 'status', 'createdAt', 'serverPasswordSet', 'rconPasswordSet', 'adminPasswordSet', 'libraryUpdatedAt'];
const publicProfile = profile => ({
  ...Object.fromEntries(profileFields.filter(key => profile[key] !== undefined).map(key => [key, profile[key]])),
  consoleInput: catalog.find(game => game.id === profile.gameId)?.consoleInput ?? profile.gameId === 'minecraft',
  adminKind: catalog.find(game => game.id === profile.gameId)?.adminKind || 'none',
});

export async function createApp(options = {}) {
  const config = options.config || readConfig();
  const store = options.store || await openStore(config.dataDir);
  const runtime = options.runtime || (config.mode === 'pufferpanel' ? new PufferRuntime(config, options.fetcher) : new SandboxRuntime(config));
  const diagnostics = options.diagnostics || createDiagnostics();
  const controller = new Controller(store, runtime, diagnostics);
  const steamSetup = options.steamSetup || new SteamSetup(config);
  const catalogProvider = options.providers || providers(options.fetcher);
  const bootstrapToken = store.state.admin ? null : token();
  const sessions = new Map();
  const steamStreams = new Set();
  const closeSteamStreams = () => { for (const close of [...steamStreams]) close(); };
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustLoopbackProxy ? 'loopback' : false);
  const failure = (error, req, res, status, message) => {
    let errorId = req.requestId;
    try {
      const reported = diagnostics.error(error, { requestId: req.requestId, operation: 'http', stage: 'request', method: req.method, status });
      if (validCorrelationId(reported)) errorId = reported;
    } catch { /* Diagnostics must never prevent an error response. */ }
    return res.status(status).json({ error: `${message} Fehler-ID: ${errorId}`, errorId, requestId: req.requestId });
  };
  app.use((req, res, next) => {
    // Correlation IDs come from this process, never from untrusted request headers.
    req.requestId = randomUUID();
    res.set('X-Request-ID', req.requestId);
    next();
  });
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], upgradeInsecureRequests: config.secureCookies ? [] : null } }, strictTransportSecurity: config.secureCookies ? undefined : false }));
  app.use((req, res, next) => {
    const publicHost = new URL(config.origin).host;
    const ownHost = `${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`;
    if (![publicHost, ownHost].includes(req.headers.host)) return res.status(403).json({ error: 'Unzulässiger Host.' });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.origin) return res.status(403).json({ error: 'Anfrage von fremder Herkunft abgewiesen.' });
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use('/api', rateLimit({ windowMs: 60000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Zu viele Anfragen. Bitte kurz warten.' } }));
  const authLimit = rateLimit({ windowMs: 15 * 60000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Zu viele Anmeldeversuche. Bitte 15 Minuten warten.' } });
  const consoleLimit = rateLimit({ windowMs: 60000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Zu viele Konsolenbefehle. Bitte kurz warten.' } });
  const steamCancelLimit = rateLimit({ windowMs: 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Zu viele Abbruchanfragen. Bitte kurz warten.' } });
  const getSession = req => {
    const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('gameswitch_session='));
    const raw = cookie?.slice('gameswitch_session='.length);
    if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
    const session = sessions.get(digest(raw));
    if (!session || session.expires < Date.now()) { if (session) sessions.delete(digest(raw)); return null; }
    return session;
  };
  const sessionResponse = session => ({ authenticated: Boolean(session), setupRequired: !store.state.admin, mode: config.mode, ...(session ? { csrfToken: session.csrfToken, username: session.username } : {}) });
  const makeSession = (res, username) => {
    // Bound sessions and expire all previous sessions at each login for the single administrator.
    closeSteamStreams();
    sessions.clear();
    const raw = token();
    const session = { username, csrfToken: token(), expires: Date.now() + config.sessionHours * 3600000 };
    sessions.set(digest(raw), session);
    res.cookie('gameswitch_session', raw, { httpOnly: true, secure: config.secureCookies, sameSite: 'strict', path: '/', maxAge: config.sessionHours * 3600000 });
    return session;
  };
  app.get('/api/session', (req, res) => res.json(sessionResponse(getSession(req))));
  app.post('/api/setup', authLimit, asyncRoute(async (req, res) => {
    if (store.state.admin) return res.status(409).json({ error: 'Administrator wurde bereits eingerichtet.' });
    const input = credentials.extend({ token: z.string().max(100) }).parse(req.body);
    if (!bootstrapToken || !timingSafeEqual(Buffer.from(digest(input.token)), Buffer.from(digest(bootstrapToken)))) return res.status(403).json({ error: 'Ungültiger Einrichtungsschlüssel.' });
    const salt = token();
    // Assignment happens before the first await: concurrent bootstrap requests cannot replace an administrator.
    store.state.admin = { username: input.username, salt, passwordHash: hashPassword(input.password, salt) };
    store.event('Administrator eingerichtet.'); await store.save();
    await fs.rm(path.join(config.dataDir, 'setup-token'), { force: true });
    res.status(201).json(sessionResponse(makeSession(res, input.username)));
  }));
  app.post('/api/login', authLimit, asyncRoute(async (req, res) => {
    const input = z.object({ username: z.string().max(100), password: z.string().max(128) }).strict().parse(req.body);
    const admin = store.state.admin;
    const passwordHash = hashPassword(input.password, admin?.salt || 'invalid-login-salt');
    const valid = admin && timingSafeEqual(Buffer.from(passwordHash), Buffer.from(admin.passwordHash));
    if (!valid || input.username !== admin.username) { store.event('Fehlgeschlagener Anmeldeversuch.', 'warning'); await store.save(); return res.status(401).json({ error: 'Benutzername oder Passwort ungültig.' }); }
    store.event('Administrator angemeldet.'); await store.save();
    res.json(sessionResponse(makeSession(res, admin.username)));
  }));
  app.use('/api', (req, res, next) => {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Bitte anmelden.' });
    req.session = session;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const csrf = req.headers['x-csrf-token'];
      if (typeof csrf !== 'string' || !timingSafeEqual(Buffer.from(digest(csrf)), Buffer.from(digest(session.csrfToken)))) return res.status(403).json({ error: 'Ungültiger CSRF-Schutzschlüssel.' });
    }
    next();
  });
  app.post('/api/logout', (req, res) => { closeSteamStreams(); sessions.clear(); res.clearCookie('gameswitch_session', { path: '/', httpOnly: true, secure: config.secureCookies, sameSite: 'strict' }); res.json({ ok: true }); });
  const steamStartSchema = z.object({ gameId: z.enum(['arma3', 'dayz']), workshopIds: z.array(z.string().regex(/^[1-9][0-9]{4,19}$/)).max(30).refine(ids => new Set(ids).size === ids.length, 'Workshop-IDs dürfen nicht doppelt sein.').default([]) }).strict();
  const steamInputSchema = z.object({ input: z.string().max(512).refine(input => Buffer.byteLength(input) <= 512 && !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(input), 'Nur eine Eingabe ohne Zeilenumbruch oder Steuerzeichen mit höchstens 512 UTF-8-Bytes ist erlaubt.') }).strict();
  const steamId = req => z.string().uuid().parse(req.params.id);
  app.get('/api/steam/setup/status', asyncRoute(async (req, res) => res.json(await steamSetup.status())));
  app.get('/api/storage/cleanup', asyncRoute(async (req, res) => {
    if (controller.busy) return res.status(409).json({ error: 'Eine Serveraktion läuft bereits.' });
    controller.busy = true;
    try { res.json(await steamSetup.cleanup({ type: 'cleanup-preview' })); }
    finally { controller.busy = false; }
  }));
  app.post('/api/storage/cleanup', consoleLimit, asyncRoute(async (req, res) => {
    const input = z.object({
      kind: z.enum(['cache', 'previous']),
      id: z.string().regex(/^(?:arma3|dayz)(?:\.previous\.[0-9]{8}T[0-9]{6}Z\.[a-f0-9]{8})?$/),
      version: z.string().regex(/^[0-9]{1,24}:[0-9]{1,24}:[0-9]{1,24}$/),
      confirm: z.literal(true),
    }).strict().parse(req.body);
    if (!store.healthy || controller.busy) return res.status(409).json({ error: 'Aufräumen gerade nicht möglich. Bitte laufende Aktionen abwarten.' });
    controller.busy = true;
    try {
      const result = await steamSetup.cleanup({ type: 'cleanup-delete', kind: input.kind, id: input.id, version: input.version });
      store.event('Ein ausgewählter Steam-Download oder älterer Bibliotheksstand wurde entfernt.');
      await store.save();
      res.json(result);
    } finally { controller.busy = false; }
  }));
  app.post('/api/steam/setup/start', consoleLimit, asyncRoute(async (req, res) => {
    const input = steamStartSchema.parse(req.body);
    if (!store.healthy) return failure(Object.assign(new Error('Persistenzfehler'), { diagnosticReason: 'persistence_failed' }), req, res, 503, 'Persistenzfehler. Die Steam-Einrichtung bleibt gesperrt.');
    if (controller.busy) return res.status(409).json({ error: 'Eine Serveraktion läuft bereits. Bitte deren Abschluss abwarten.' });
    controller.busy = true;
    try {
      store.event(`Steam-Einrichtung für ${input.gameId} angefordert.`);
      await store.save();
      res.status(201).json({ session: await steamSetup.start(input) });
    } finally { controller.busy = false; }
  }));
  app.post('/api/steam/setup/:id/input', consoleLimit, asyncRoute(async (req, res) => {
    const id = steamId(req);
    const { input } = steamInputSchema.parse(req.body);
    try { await steamSetup.input(id, input); }
    catch (error) {
      if (error.code === 'STEAM_INPUT_UNCERTAIN') return failure(error, req, res, 502, 'Die Zustellung ist unbestätigt. Bitte die Ausgabe prüfen; die Eingabe wird nicht automatisch wiederholt.');
      throw error;
    }
    res.json({ ok: true });
  }));
  app.post('/api/steam/setup/:id/cancel', steamCancelLimit, asyncRoute(async (req, res) => {
    const id = steamId(req); z.object({}).strict().parse(req.body ?? {});
    await steamSetup.cancel(id); res.json({ ok: true });
  }));
  app.get('/api/steam/setup/:id/events', (req, res, next) => {
    let unsubscribe = () => {}, heartbeat, ended = false;
    const finish = () => { if (ended) return; ended = true; clearInterval(heartbeat); unsubscribe(); steamStreams.delete(finish); res.end(); };
    try {
      const id = steamId(req);
      if ((req.headers.origin && req.headers.origin !== config.origin) || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Steam-Ausgabe nur von derselben Herkunft abrufbar.' });
      const session = req.session;
      const early = [];
      let initialized = false;
      const deliver = event => {
        if (!initialized) { early.push(event); return; }
        if (ended || getSession(req) !== session || res.writableLength > 131072) return finish();
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === 'exit' || event.type === 'error') finish();
      };
      unsubscribe = steamSetup.subscribe(id, deliver);
      res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      steamStreams.add(finish);
      heartbeat = setInterval(() => { if (getSession(req) !== session) return finish(); res.write(': keepalive\n\n'); }, 10000);
      heartbeat.unref(); req.on('close', finish);
      initialized = true;
      for (const event of early) deliver(event);
    } catch (error) { clearInterval(heartbeat); unsubscribe(); next(error); }
  });
  app.get('/api/state', asyncRoute(async (req, res) => {
    if (!controller.busy) {
      try { await controller.reconcile(); } catch { /* Unknown state is displayed; mutation still fails closed. */ }
    }
    const { profiles, activeProfileId, job, backups, events } = store.state;
    const [arma3, dayz] = await Promise.all(['arma3', 'dayz'].map(id => gameLibraryStatus(config, id)));
    res.json({ mode: config.mode, profiles: profiles.map(publicProfile), activeProfileId, job, backups, events, catalog, runtimeSetup: { arma3, dayz },
      host: { name: config.mode === 'sandbox' ? 'Lokale Sandbox · VPS-Zielkonfiguration' : 'Netcup VPS', cpuCores: config.cpuCores, memoryMb: config.memoryMb, reservedMemoryMb: config.reservedMemoryMb },
      security: { authenticated: true, csrf: true, localOnly: ['127.0.0.1', '::1', 'localhost'].includes(config.host) } });
  }));
  app.post('/api/profiles', asyncRoute(async (req, res) => {
    if (!store.healthy) return failure(Object.assign(new Error('Persistence unavailable'), { code: 'PERSISTENCE_UNAVAILABLE' }), req, res, 503, 'Persistenzfehler. Dienst nach Behebung neu starten.');
    if (controller.busy) return res.status(409).json({ error: 'Bitte laufende Aktion abwarten.' });
    if (store.state.profiles.length >= 50) return res.status(409).json({ error: 'Maximal 50 Profile erlaubt.' });
    const input = profileSchema.parse(req.body);
    validateGamePorts(input, config);
    if (input.memoryMb > config.memoryMb - config.reservedMemoryMb) return res.status(400).json({ error: 'RAM-Reserve für Betriebssystem und Panel unterschritten.' });
    if ([2222, 3000, 3001, 5173, 8080, 8443, 9090, config.port, Number(new URL(config.pufferUrl || 'http://127.0.0.1:8080').port)].includes(input.port)) return res.status(400).json({ error: 'Dieser Port ist für Administration oder Panel reserviert.' });
    if (input.gameId === 'gmod') { input.collectionId = parseCollection(input.collectionId); input.gamemode ||= 'sandbox'; }
    if (input.loader === 'modrinth') {
      const versions = await catalogProvider.versions(input.modpackId);
      const selected = versions.versions.find(version => version.id === input.modpackVersion && version.gameVersions.includes(input.version));
      if (!selected) return res.status(400).json({ error: 'Modpack-Version passt nicht zur Minecraft-Version.' });
    }
    if (input.loader === 'ftb') {
      // IDs and compatibility are resolved against the fixed official provider, never browser-supplied commands or installer URLs.
      const available = await catalogProvider.ftbVersions(input.modpackId);
      if (!available.versions.some(version => version.id === input.modpackVersion)) return res.status(400).json({ error: 'FTB-Version ist nicht als öffentliche Veröffentlichung verfügbar.' });
      const selected = await catalogProvider.ftbVersion(input.modpackId, input.modpackVersion);
      if (!selected.gameVersions.includes(input.version)) return res.status(400).json({ error: 'FTB-Pack-Version passt nicht zur Minecraft-Version.' });
      if (selected.minimumMemoryMb && input.memoryMb - FTB_NATIVE_RESERVE_MB < selected.minimumMemoryMb) return res.status(400).json({ error: `FTB benötigt mindestens ${selected.minimumMemoryMb} MB Java-RAM; inklusive nativer Reserve mindestens ${selected.minimumMemoryMb + FTB_NATIVE_RESERVE_MB} MB Profil-RAM wählen.` });
      input.modpackName = available.pack.name;
      input.modpackVersionName = selected.name;
      input.javaVersion = selected.javaVersion;
      input.minimumMemoryMb = selected.minimumMemoryMb;
      input.recommendedMemoryMb = selected.recommendedMemoryMb;
    }
    if (controller.busy || store.state.profiles.length >= 50) return res.status(409).json({ error: 'Profilanlage gerade nicht möglich. Bitte erneut versuchen.' });
    const { serverPassword, adminPassword, ...settings } = input;
    const profile = { ...settings, id: randomUUID(), serverId: randomUUID().replaceAll('-', '').slice(0, 16), installed: false, status: 'stopped', createdAt: new Date().toISOString() };
    if (serverPassword || adminPassword || input.gameId === 'squad') {
      const flags = await writeProfileSecrets(config, profile.id, { ...(serverPassword ? { serverPassword } : {}), ...(adminPassword ? { adminPassword } : {}), ...(input.gameId === 'squad' ? { rconPassword: token() } : {}) });
      Object.assign(profile, flags);
    }
    if (controller.busy || store.state.profiles.length >= 50) return res.status(409).json({ error: 'Profilanlage gerade nicht möglich. Bitte erneut versuchen.' });
    store.state.profiles.push(profile); store.event(`Profil „${profile.name}“ angelegt.`); await store.save();
    res.status(201).json({ profile: publicProfile(profile) });
  }));
  for (const action of ['activate', 'restart', 'stop', 'backup', 'update']) app.post(`/api/profiles/:id/${action}`, asyncRoute(async (req, res) => {
    if ((await steamSetup.status()).active) return res.status(409).json({ error: 'Steam-Einrichtung läuft. Vor einer Serveraktion deren Abschluss abwarten oder die Einrichtung abbrechen.' });
    if (['restart', 'update'].includes(action)) z.object({}).strict().parse(req.body ?? {});
    res.status(202).json({ job: controller.begin(action, req.params.id, undefined, { requestId: req.requestId }) });
  }));
  app.post('/api/backups/:id/restore', asyncRoute(async (req, res) => {
    if ((await steamSetup.status()).active) return res.status(409).json({ error: 'Steam-Einrichtung läuft. Vor einer Wiederherstellung deren Abschluss abwarten oder die Einrichtung abbrechen.' });
    const backup = store.state.backups.find(item => item.id === req.params.id);
    if (!backup) return res.status(404).json({ error: 'Sicherung nicht gefunden.' });
    res.status(202).json({ job: controller.begin('restore', backup.profileId, backup.id, { requestId: req.requestId }) });
  }));
  app.get('/api/profiles/:id/console', asyncRoute(async (req, res) => res.json({ lines: await runtime.console(controller.profile(req.params.id)) })));
  app.post('/api/profiles/:id/console', consoleLimit, asyncRoute(async (req, res) => {
    if (!store.healthy) return failure(Object.assign(new Error('Persistence unavailable'), { code: 'PERSISTENCE_UNAVAILABLE' }), req, res, 503, 'Persistenzfehler. Konsoleneingabe ist bis zur Behebung gesperrt.');
    if (controller.busy) return res.status(409).json({ error: 'Eine Serveraktion läuft bereits. Bitte kurz warten.' });
    const profile = controller.profile(req.params.id);
    const { command } = parseConsoleCommand(profile, req.body);
    // Reserve the same gate as start/stop/restore before awaiting any runtime I/O.
    controller.busy = true;
    try {
      // Persist only the command verb before dispatch; arguments may contain private messages or secrets.
      store.event(`Konsolenbefehl „${safeCommandVerb(command)}“ für „${profile.name}“ von ${req.session.username} angefordert.`);
      await store.save();
      try {
        await runtime.command(profile, command);
      } catch (error) {
        if (error.code === 'CONSOLE_DELIVERY_UNCERTAIN') return failure(error, req, res, 502, 'Die Bestätigung fehlt. Der Befehl kann bereits ausgeführt worden sein. Bitte die Konsole prüfen; es wird nicht automatisch erneut gesendet.');
        throw error;
      }
      res.json({ ok: true });
    } finally {
      controller.busy = false;
    }
  }));
  app.post('/api/profiles/:id/admin', consoleLimit, asyncRoute(async (req, res) => {
    if (!store.healthy) return failure(Object.assign(new Error('Persistence unavailable'), { code: 'PERSISTENCE_UNAVAILABLE' }), req, res, 503, 'Persistenzfehler. Admin-Einstellungen sind bis zur Behebung gesperrt.');
    if (controller.busy) return res.status(409).json({ error: 'Eine Serveraktion läuft bereits. Bitte kurz warten.' });
    const profile = controller.profile(req.params.id);
    const action = buildAdminAction(profile, req.body);
    if (!profile.installed) return res.status(409).json({ error: 'Dieses Profil muss zuerst erfolgreich installiert werden.' });
    controller.busy = true;
    try {
      store.event(`Admin-Einstellung (${req.body.role}) für „${profile.name}“ von ${req.session.username} angefordert.`);
      await store.save();
      try {
        const result = await runtime.admin(profile, action);
        res.json({ ok: true, notice: result.simulated ? 'Sandbox: Admin-Einstellung simuliert; keine echten Spielrechte verändert.' : action.notice, ...result });
      } catch (error) {
        if (error.code === 'CONSOLE_DELIVERY_UNCERTAIN') return failure(error, req, res, 502, 'Die Bestätigung fehlt. Der Admin-Befehl kann bereits ausgeführt worden sein. Bitte die Konsole prüfen; es wird nicht automatisch erneut gesendet.');
        if (error.code === 'ADMIN_WRITE_UNCERTAIN') return failure(error, req, res, 502, 'Die Bestätigung der Adminliste fehlt. Bitte Konfiguration prüfen; es wird nicht automatisch erneut geschrieben.');
        throw error;
      }
    } finally { controller.busy = false; }
  }));
  app.post('/api/profiles/:id/admin-password', consoleLimit, asyncRoute(async (req, res) => {
    if (!store.healthy) return failure(Object.assign(new Error('Persistence unavailable'), { code: 'PERSISTENCE_UNAVAILABLE' }), req, res, 503, 'Persistenzfehler. Admin-Einstellungen sind bis zur Behebung gesperrt.');
    if (controller.busy) return res.status(409).json({ error: 'Eine Serveraktion läuft bereits. Bitte kurz warten.' });
    const profile = controller.profile(req.params.id);
    if (profile.gameId !== 'dayz') return res.status(400).json({ error: 'Ein separates Adminpasswort wird hier nur für DayZ verwaltet.' });
    const { password } = z.object({ password: adminPasswordSchema }).strict().parse(req.body);
    controller.busy = true;
    try {
      // Never log or persist the value in events; only the action and its actor.
      store.event(`Adminpasswort für „${profile.name}“ von ${req.session.username} angefordert.`);
      await store.save();
      let result;
      try { result = await runtime.setAdminPassword(profile, password); }
      catch (error) {
        if (error.code === 'ADMIN_WRITE_UNCERTAIN') return failure(error, req, res, 502, error.message);
        throw error;
      }
      Object.assign(profile, await writeProfileSecrets(config, profile.id, { adminPassword: password }));
      store.event(`Adminpasswort für „${profile.name}“ gespeichert.`);
      await store.save();
      const notice = result.simulated ? 'Sandbox: Adminpasswort simuliert gespeichert; keine echte Serverkonfiguration verändert.'
        : profile.installed ? 'Adminpasswort gespeichert. Es gilt ab dem nächsten Start für #login und – falls geladen – VPPAdminTools. Es wurde kein Neustart ausgelöst.'
          : 'Adminpasswort gespeichert. Es wird bei der ersten Installation übernommen.';
      res.json({ ok: true, notice, requiresRestart: Boolean(result.requiresRestart), profile: publicProfile(profile) });
    } finally { controller.busy = false; }
  }));
  app.get('/api/catalog/modpacks', asyncRoute(async (req, res) => res.json(await catalogProvider.search(z.string().max(100).parse(req.query.q || '')))));
  app.get('/api/catalog/modpacks/:id/versions', asyncRoute(async (req, res) => res.json(await catalogProvider.versions(req.params.id))));
  app.get('/api/catalog/minecraft-versions', asyncRoute(async (req, res) => res.json(await catalogProvider.minecraft())));
  app.get('/api/catalog/ftb', asyncRoute(async (req, res) => res.json(await catalogProvider.ftbSearch(z.string().max(100).parse(req.query.q || '')))));
  app.get('/api/catalog/ftb/:id/versions', asyncRoute(async (req, res) => res.json(await catalogProvider.ftbVersions(req.params.id))));
  app.use('/api', (req, res) => res.status(404).json({ error: 'API-Endpunkt nicht gefunden.' }));
  const dist = path.resolve(import.meta.dirname, '../dist');
  try { await fs.access(path.join(dist, 'index.html')); app.use(express.static(dist, { dotfiles: 'deny', index: 'index.html' })); } catch { /* Vite handles development UI. */ }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error instanceof z.ZodError || error.type === 'entity.parse.failed' ? 400 : error.type === 'entity.too.large' ? 413 : Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    const message = error instanceof z.ZodError ? error.issues[0]?.message || 'Ungültige Eingabe.' : error.type === 'entity.parse.failed' ? 'Ungültiges JSON in der Anfrage.' : error.type === 'entity.too.large' ? 'Die Anfrage überschreitet die erlaubte Größe.' : status >= 500 ? friendlyDiagnosticMessage(error) : error.message;
    if (status >= 500) return failure(error, req, res, status, message);
    res.status(status).json({ error: message });
  });
  let closing;
  const close = () => closing ||= (async () => { closeSteamStreams(); await steamSetup.close(); await controller.pending; await store.flush(); sessions.clear(); })();
  return { app, config, store, runtime, controller, steamSetup, bootstrapToken, close };
}
