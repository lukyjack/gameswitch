import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readConfig } from './config.mjs';
import { openStore } from './store.mjs';
import { catalog, profileSchema, parseCollection, providers } from './catalog.mjs';
import { SandboxRuntime, PufferRuntime } from './runtime.mjs';
import { Controller } from './controller.mjs';

const token = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const hashPassword = (password, salt) => scryptSync(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 }).toString('hex');
const credentials = z.object({ username: z.string().regex(/^[a-zA-Z0-9_-]{3,32}$/), password: z.string().min(14).max(128) }).strict();
const asyncRoute = callback => (req, res, next) => Promise.resolve(callback(req, res, next)).catch(next);

export async function createApp(options = {}) {
  const config = options.config || readConfig();
  const store = options.store || await openStore(config.dataDir);
  const runtime = options.runtime || (config.mode === 'pufferpanel' ? new PufferRuntime(config, options.fetcher) : new SandboxRuntime(config));
  const controller = new Controller(store, runtime);
  const catalogProvider = options.providers || providers(options.fetcher);
  const bootstrapToken = store.state.admin ? null : token();
  const sessions = new Map();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] } }, strictTransportSecurity: config.production ? undefined : false }));
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
    sessions.clear();
    const raw = token();
    const session = { username, csrfToken: token(), expires: Date.now() + config.sessionHours * 3600000 };
    sessions.set(digest(raw), session);
    res.cookie('gameswitch_session', raw, { httpOnly: true, secure: config.production, sameSite: 'strict', path: '/', maxAge: config.sessionHours * 3600000 });
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
  app.post('/api/logout', (req, res) => { sessions.clear(); res.clearCookie('gameswitch_session', { path: '/', httpOnly: true, secure: config.production, sameSite: 'strict' }); res.json({ ok: true }); });
  app.get('/api/state', asyncRoute(async (req, res) => {
    if (!controller.busy) {
      try { await controller.reconcile(); } catch { /* Unknown state is displayed; mutation still fails closed. */ }
    }
    const { profiles, activeProfileId, job, backups, events } = store.state;
    res.json({ mode: config.mode, profiles, activeProfileId, job, backups, events, catalog,
      host: { name: config.mode === 'sandbox' ? 'Lokale Sandbox · VPS-Zielkonfiguration' : 'Netcup VPS', cpuCores: config.cpuCores, memoryMb: config.memoryMb, reservedMemoryMb: config.reservedMemoryMb },
      security: { authenticated: true, csrf: true, localOnly: ['127.0.0.1', '::1', 'localhost'].includes(config.host) } });
  }));
  app.post('/api/profiles', asyncRoute(async (req, res) => {
    if (!store.healthy) return res.status(503).json({ error: 'Persistenzfehler. Dienst nach Behebung neu starten.' });
    if (controller.busy) return res.status(409).json({ error: 'Bitte laufende Aktion abwarten.' });
    if (store.state.profiles.length >= 50) return res.status(409).json({ error: 'Maximal 50 Profile erlaubt.' });
    const input = profileSchema.parse(req.body);
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
      if (selected.minimumMemoryMb && input.memoryMb - 768 < selected.minimumMemoryMb) return res.status(400).json({ error: `FTB benötigt mindestens ${selected.minimumMemoryMb} MB Java-RAM; inklusive Prozessreserve mindestens ${selected.minimumMemoryMb + 768} MB Profil-RAM wählen.` });
      input.modpackName = available.pack.name;
      input.modpackVersionName = selected.name;
      input.javaVersion = selected.javaVersion;
      input.minimumMemoryMb = selected.minimumMemoryMb;
      input.recommendedMemoryMb = selected.recommendedMemoryMb;
    }
    if (controller.busy || store.state.profiles.length >= 50) return res.status(409).json({ error: 'Profilanlage gerade nicht möglich. Bitte erneut versuchen.' });
    const profile = { ...input, id: randomUUID(), serverId: randomUUID().replaceAll('-', '').slice(0, 16), installed: false, status: 'stopped', createdAt: new Date().toISOString() };
    store.state.profiles.push(profile); store.event(`Profil „${profile.name}“ angelegt.`); await store.save();
    res.status(201).json({ profile });
  }));
  for (const action of ['activate', 'stop', 'backup']) app.post(`/api/profiles/:id/${action}`, (req, res, next) => { try { res.status(202).json({ job: controller.begin(action, req.params.id) }); } catch (error) { next(error); } });
  app.post('/api/backups/:id/restore', (req, res, next) => {
    const backup = store.state.backups.find(item => item.id === req.params.id);
    if (!backup) return res.status(404).json({ error: 'Sicherung nicht gefunden.' });
    try { res.status(202).json({ job: controller.begin('restore', backup.profileId, backup.id) }); } catch (error) { next(error); }
  });
  app.get('/api/profiles/:id/console', asyncRoute(async (req, res) => res.json({ lines: await runtime.console(controller.profile(req.params.id)) })));
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
    const status = error instanceof z.ZodError || error.type === 'entity.parse.failed' ? 400 : error.type === 'entity.too.large' ? 413 : error.status || 500;
    const message = error instanceof z.ZodError ? error.issues[0]?.message || 'Ungültige Eingabe.' : status >= 500 ? 'Serveraktion fehlgeschlagen. Verbindung und Konfiguration prüfen.' : error.message;
    res.status(status).json({ error: message });
  });
  return { app, config, store, runtime, controller, bootstrapToken, close: async () => { await controller.pending; await store.flush(); sessions.clear(); } };
}
