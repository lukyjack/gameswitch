import { z } from 'zod';
import { DAYZ_MODS } from './dayz.mjs';

export const catalog = [
  { id: 'minecraft', name: 'Minecraft Java', description: 'Vanilla, Paper, Fabric, Forge, Feed the Beast und Modrinth-Modpacks', kind: 'minecraft', loaders: ['vanilla', 'paper', 'fabric', 'forge', 'ftb', 'modrinth'], defaultPort: 25565, defaultMemoryMb: 6144, available: true, consoleInput: true, adminKind: 'minecraft', minMemoryMb: 1024, maxPlayers: 128 },
  { id: 'gmod', name: "Garry’s Mod", description: 'Sandbox und TTT mit Steam-Workshop-Collection', kind: 'steam', loaders: ['steam'], defaultPort: 27015, defaultMemoryMb: 4096, available: true, consoleInput: true, adminKind: 'ulx', minMemoryMb: 1024, maxPlayers: 128, notice: 'Der Adminhelfer benötigt ULX/ULib in der ausgewählten Collection.' },
  { id: 'arma3', name: 'Arma 3', description: 'Linux-Server mit Koop-/Zeus-Missionen, Workshop-Mods und Steam-Administratoren', kind: 'steam', loaders: ['steam'], defaultPort: 2302, defaultMemoryMb: 6144, available: true, consoleInput: false, adminKind: 'arma3', minMemoryMb: 4096, maxPlayers: 32, notice: 'Serverdateien über Steam einrichten im Panel vorbereiten. In-Game-Admins melden sich mit #login an; Protokoll hier nur lesbar.' },
  { id: 'dayz', name: 'DayZ', description: 'Linux-Communityserver mit Chernarus, Workshop-Mods und persistentem Spielstand', kind: 'steam', loaders: ['steam'], defaultPort: 2302, defaultQueryPort: 27016, defaultMemoryMb: 8192, available: true, consoleInput: false, adminKind: 'dayz', minMemoryMb: 4096, maxPlayers: 40, notice: 'Steam-Serverdateien zuerst geschützt vorbereiten. Das Adminpasswort gilt für #login im Spiel und für VPPAdminTools; Steam-ID-Admins werden über VPPAdminTools vergeben. Serverprotokoll nur lesbar.' },
  { id: 'squad', name: 'Squad', description: 'Linux-Anbindung mit privatem RCON und Steam-Administratoren vorbereitet', kind: 'steam', loaders: ['steam'], defaultPort: 7787, defaultQueryPort: 27165, defaultBeaconPort: 15000, defaultMemoryMb: 12288, available: false, consoleInput: true, adminKind: 'squad', minMemoryMb: 8192, maxPlayers: 100, unavailableReason: 'Installation erfolgreich, aber der native Starttest auf dieser VPS stürzt beim Kartenladen mit Signal 11 ab. Start bis zur Behebung gesperrt. Lizenzierte Squad-Server sind auf VPS nicht zulässig.', notice: 'Auf dieser VPS nur als nicht lizenzierter Server für den Custom Browser. Offizielle Serverlizenzen sind für VPS/VM-Hosting nicht vorgesehen.' },
  { id: 'valheim', name: 'Valheim', description: 'Eigene Welt mit Serverpasswort und Administratorliste', kind: 'steam', loaders: ['steam'], defaultPort: 2456, defaultMemoryMb: 4096, available: true, consoleInput: false, adminKind: 'valheim', minMemoryMb: 2048, maxPlayers: 10, notice: 'Passwort wird getrennt vom Profil gespeichert. Kein Konsoleneingang; Administratoren werden über die Berechtigungsliste verwaltet.' },
  { id: 'terraria', name: 'Terraria', description: 'Offizieller Linux-Server 1.4.5.8 mit eigener Welt', kind: 'native', loaders: ['native'], defaultVersion: '1.4.5.8', defaultPort: 7777, defaultMemoryMb: 2048, available: true, consoleInput: true, adminKind: 'none', minMemoryMb: 1024, maxPlayers: 16, notice: 'Vanilla Terraria bietet keinen Minecraft-ähnlichen Operatorrang. Verwaltung über die Serverkonsole.' },
  { id: 'factorio', name: 'Factorio', description: 'Offizieller Headless-Server 2.1.24 mit eigener Fabrikwelt', kind: 'native', loaders: ['native'], defaultVersion: '2.1.24', defaultPort: 34197, defaultMemoryMb: 4096, available: true, consoleInput: true, adminKind: 'none', minMemoryMb: 2048, maxPlayers: 32, notice: 'Beitritt per IP und Serverpasswort mit aktiver Kontoprüfung. Administratoren über /promote Spielername verwalten; passende Clientversion erforderlich.' },
  { id: 'fs25', name: 'Farming Simulator 25', description: 'Landwirtschafts-Simulator 25 Dedicated Server', kind: 'native', loaders: ['native'], defaultPort: 10823, defaultMemoryMb: 8192, available: false, consoleInput: false, adminKind: 'none', minMemoryMb: 8192, maxPlayers: 16, unavailableReason: 'Der offizielle Dedicated Server benötigt Windows und eine separate Spiellizenz. Auf dieser Debian-VPS ist kein unterstützter nativer Betrieb eingerichtet.' },
];

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const adminPasswordSchema = z.string().min(8, 'Adminpasswort: mindestens 8 Zeichen.').max(32, 'Adminpasswort: höchstens 32 Zeichen.').regex(/^[A-Za-z0-9_-]+$/, 'Adminpasswort: nur Buchstaben, Ziffern, Unterstriche oder Bindestriche.');
const ftbId = z.string().regex(/^[1-9][0-9]{0,9}$/);
const ftbBase = 'https://api.feed-the-beast.com/v1/modpacks/public/modpack';
export const profileSchema = z.object({
  name: z.string().trim().min(2).max(60).regex(/^[^\x00-\x1f\x7f-\x9f\u2028\u2029]+$/),
  gameId: z.enum(['minecraft', 'gmod', 'arma3', 'dayz', 'squad', 'valheim', 'terraria', 'factorio', 'fs25']),
  version: z.string().regex(/^(latest|[a-zA-Z0-9][a-zA-Z0-9._-]{0,39})$/),
  loader: z.enum(['vanilla', 'paper', 'fabric', 'forge', 'ftb', 'modrinth', 'steam', 'native']),
  modpackId: id.optional(), modpackVersion: id.optional(),
  collectionId: z.string().max(180).optional(),
  mission: z.string().max(80).optional(),
  workshopIds: z.array(z.string().regex(/^[1-9][0-9]{4,19}$/)).max(30).refine(ids => new Set(ids).size === ids.length, 'Workshop-IDs dürfen nicht doppelt vorkommen.').optional(),
  adminSteamIds: z.array(z.string().regex(/^[0-9]{17}$/).refine(value => { if (!/^[0-9]{17}$/.test(value)) return false; const account = BigInt(value) - 76561197960265728n; return account > 0n && account <= 0xffffffffn; }, 'Ungültige Steam-Spieler-ID.')).max(20).refine(ids => new Set(ids).size === ids.length, 'Admin-IDs dürfen nicht doppelt vorkommen.').optional(),
  gamemode: z.enum(['sandbox', 'terrortown']).optional(),
  map: z.string().regex(/^[a-zA-Z0-9_/-]{1,80}$/).refine(value => !value.includes('..')).optional(),
  maxPlayers: z.number().int().min(1).max(128),
  memoryMb: z.number().int().min(1024).max(13312),
  port: z.number().int().min(1024).max(65535),
  queryPort: z.number().int().min(1024).max(65535).optional(),
  beaconPort: z.number().int().min(1024).max(65535).optional(),
  worldName: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Weltname: 1–40 Buchstaben, Ziffern, Unterstriche oder Bindestriche.').optional(),
  serverPassword: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Passwort: nur Buchstaben, Ziffern, Unterstriche oder Bindestriche.').optional(),
  adminPassword: adminPasswordSchema.optional(),
  eulaAccepted: z.boolean().optional(),
}).strict().superRefine((profile, ctx) => {
  const game = catalog.find(game => game.id === profile.gameId);
  if (!game.available) ctx.addIssue({ code: 'custom', message: game.unavailableReason });
  if (!game.loaders.includes(profile.loader)) ctx.addIssue({ code: 'custom', message: 'Dieser Loader passt nicht zum ausgewählten Spiel.' });
  if (profile.memoryMb < game.minMemoryMb) ctx.addIssue({ code: 'custom', message: `${game.name} benötigt mindestens ${game.minMemoryMb} MB Profil-RAM.` });
  if (profile.maxPlayers > game.maxPlayers) ctx.addIssue({ code: 'custom', message: `${game.name} unterstützt in dieser Vorlage höchstens ${game.maxPlayers} Spieler.` });
  if (profile.gameId === 'minecraft' && !profile.eulaAccepted) ctx.addIssue({ code: 'custom', message: 'Minecraft benötigt die EULA-Zustimmung.' });
  if (profile.gameId === 'gmod' && profile.loader !== 'steam') ctx.addIssue({ code: 'custom', message: 'Garry’s Mod benötigt Steam.' });
  if (profile.gameId !== 'gmod' && profile.gamemode !== undefined) ctx.addIssue({ code: 'custom', message: 'Spielmodi sind nur für Garry’s Mod erlaubt.' });
  if (profile.gameId !== 'gmod' && (profile.collectionId !== undefined || profile.map !== undefined)) ctx.addIssue({ code: 'custom', message: 'Workshop-Collection und Karte sind nur für Garry’s Mod erlaubt.' });
  if (!['valheim', 'terraria', 'factorio'].includes(profile.gameId) && profile.worldName !== undefined) ctx.addIssue({ code: 'custom', message: 'Ein Weltname ist nur für Valheim, Terraria oder Factorio erlaubt.' });
  if (['valheim', 'factorio', 'arma3', 'dayz'].includes(profile.gameId) && !profile.serverPassword) ctx.addIssue({ code: 'custom', message: 'Dieses Spiel benötigt ein Serverpasswort mit mindestens 8 Zeichen.' });
  if (!['valheim', 'factorio', 'arma3', 'dayz'].includes(profile.gameId) && profile.serverPassword !== undefined) ctx.addIssue({ code: 'custom', message: 'Serverpasswörter werden für dieses Spiel nicht unterstützt.' });
  if (profile.queryPort !== undefined && !['squad', 'dayz'].includes(profile.gameId)) ctx.addIssue({ code: 'custom', message: 'Query-Port ist nur für Squad und DayZ erlaubt.' });
  if (profile.beaconPort !== undefined && profile.gameId !== 'squad') ctx.addIssue({ code: 'custom', message: 'Beacon-Port ist nur für Squad erlaubt.' });
  if (['gmod', 'squad', 'valheim', 'arma3', 'dayz'].includes(profile.gameId) && profile.version !== 'latest') ctx.addIssue({ code: 'custom', message: 'Diese Steam-Vorlage installiert die aktuelle Dedicated-Server-Version.' });
  if (profile.gameId === 'arma3' && profile.mission !== undefined && !['MP_COOP_m01.Stratis', 'MP_COOP_m03.Altis', 'MP_ZGM_m11.Altis', 'MP_ZGM_m12.Stratis', 'MP_CombatPatrol_01.Altis'].includes(profile.mission)) ctx.addIssue({ code: 'custom', message: 'Diese Arma-Mission ist nicht freigegeben.' });
  if (profile.gameId === 'dayz' && profile.mission !== undefined && profile.mission !== 'dayzOffline.chernarusplus') ctx.addIssue({ code: 'custom', message: 'Diese DayZ-Vorlage unterstützt Chernarus.' });
  if (!['arma3', 'dayz'].includes(profile.gameId) && (profile.mission !== undefined || profile.workshopIds !== undefined)) ctx.addIssue({ code: 'custom', message: 'Missionen und Workshop-Listen sind hier nur für Arma 3 und DayZ erlaubt.' });
  if (!['arma3', 'dayz'].includes(profile.gameId) && profile.adminSteamIds !== undefined) ctx.addIssue({ code: 'custom', message: 'Die Steam-Adminliste ist hier nur für Arma 3 und DayZ erlaubt.' });
  if (profile.gameId !== 'dayz' && profile.adminPassword !== undefined) ctx.addIssue({ code: 'custom', message: 'Ein separates Adminpasswort ist hier nur für DayZ vorgesehen.' });
  if (profile.gameId === 'dayz') {
    const mods = profile.workshopIds || [];
    for (const [id, name] of [[DAYZ_MODS.vpp, 'VPPAdminTools'], [DAYZ_MODS.cot, 'Community Online Tools']]) {
      if (mods.includes(id) && !(mods.includes(DAYZ_MODS.cf) && mods.indexOf(DAYZ_MODS.cf) < mods.indexOf(id))) ctx.addIssue({ code: 'custom', message: `${name} (${id}) benötigt Community Framework (${DAYZ_MODS.cf}) weiter vorne in der Mod-Liste.` });
    }
    if (profile.adminSteamIds?.length && !mods.includes(DAYZ_MODS.vpp)) ctx.addIssue({ code: 'custom', message: `DayZ vergibt Steam-ID-Adminrechte über VPPAdminTools. Bitte CF (${DAYZ_MODS.cf}) und VPPAdminTools (${DAYZ_MODS.vpp}) in die Mod-Liste aufnehmen.` });
    if (mods.includes(DAYZ_MODS.vpp) && !profile.adminPassword) ctx.addIssue({ code: 'custom', message: 'VPPAdminTools benötigt ein Adminpasswort mit 8–32 Zeichen.' });
  }
  if (profile.gameId === 'terraria' && profile.version !== '1.4.5.8') ctx.addIssue({ code: 'custom', message: 'Diese Terraria-Vorlage unterstützt Version 1.4.5.8.' });
  if (profile.gameId === 'factorio' && profile.version !== '2.1.24') ctx.addIssue({ code: 'custom', message: 'Diese Factorio-Vorlage unterstützt Version 2.1.24.' });
  if (profile.gameId !== 'minecraft' && (profile.modpackId || profile.modpackVersion)) ctx.addIssue({ code: 'custom', message: 'Minecraft-Modpacks sind nur für Minecraft erlaubt.' });
  if (['ftb', 'modrinth'].includes(profile.loader) && (!profile.modpackId || !profile.modpackVersion)) ctx.addIssue({ code: 'custom', message: 'Modpack und feste Modpack-Version auswählen.' });
  if (!['ftb', 'modrinth'].includes(profile.loader) && (profile.modpackId || profile.modpackVersion)) ctx.addIssue({ code: 'custom', message: 'Modpack nur mit FTB- oder Modrinth-Loader erlaubt.' });
  if (profile.loader === 'ftb' && (!ftbId.safeParse(profile.modpackId).success || !ftbId.safeParse(profile.modpackVersion).success)) ctx.addIssue({ code: 'custom', message: 'FTB benötigt feste numerische Pack- und Versions-IDs.' });
});

export function parseCollection(value) {
  if (!value) return '';
  if (/^[1-9][0-9]{4,19}$/.test(value)) return value;
  let url;
  const invalid = message => Object.assign(new Error(message), { status: 400 });
  try { url = new URL(value); } catch { throw invalid('Ungültige Steam-Collection-ID oder URL.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'steamcommunity.com' || url.username || url.password || !['/sharedfiles/filedetails/', '/workshop/filedetails/'].includes(url.pathname) || !/^[1-9][0-9]{4,19}$/.test(url.searchParams.get('id') || '')) throw invalid('Nur offizielle Steam-Collection-URLs erlaubt.');
  return url.searchParams.get('id');
}

async function providerJson(url, fetcher = fetch) {
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'GameSwitch/0.1 (+https://github.com/lukyjack/gameswitch)' } });
  if (!response.ok) throw new Error('Spielekatalog momentan nicht erreichbar.');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 6_000_000) { await reader.cancel(); throw new Error('Katalogantwort zu groß.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function normalizeFtbVersion(version) {
  const minecraft = version.targets?.find(target => target.name === 'minecraft' && target.type === 'game');
  const runtime = version.targets?.find(target => target.name === 'java' && target.type === 'runtime');
  const loader = version.targets?.find(target => target.type === 'modloader');
  const major = runtime?.version?.startsWith('1.') ? Number(runtime.version.split('.')[1]) : Number(runtime?.version?.split('.')[0]);
  const memory = value => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 1048576 ? Math.ceil(Number(value)) : undefined;
  if (!minecraft || !/^[0-9][0-9A-Za-z._-]{0,39}$/.test(minecraft.version) || ![8, 11, 16, 17, 21, 25].includes(major) || !ftbId.safeParse(String(version.id)).success) return null;
  return {
    id: String(version.id), name: version.name, version: version.name,
    gameVersions: [minecraft.version], loaders: loader?.name ? [loader.name] : [],
    javaVersion: major, minimumMemoryMb: memory(version.specs?.minimum), recommendedMemoryMb: memory(version.specs?.recommended),
  };
}

const validFtbResponse = data => {
  if (data.status !== 'success') throw Object.assign(new Error('FTB-Pack oder Version nicht gefunden.'), { status: 404 });
  return data;
};

export function providers(fetcher = fetch) {
  return {
    async search(query = '') {
      const url = new URL('https://api.modrinth.com/v2/search');
      url.search = new URLSearchParams({ query: query.slice(0, 100), limit: '12', facets: JSON.stringify([['project_type:modpack'], ['server_side:required', 'server_side:optional']]) });
      const data = await providerJson(url, fetcher);
      return { hits: data.hits.map(hit => ({ id: hit.project_id, slug: hit.slug, title: hit.title, description: hit.description, downloads: hit.downloads, versions: hit.versions })) };
    },
    async versions(projectId) {
      id.parse(projectId);
      const data = await providerJson(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version`, fetcher);
      return { versions: data.filter(v => v.files?.some(f => f.filename.endsWith('.mrpack'))).slice(0, 100).map(v => ({ id: v.id, name: v.name, version: v.version_number, gameVersions: v.game_versions, loaders: v.loaders })) };
    },
    async minecraft() {
      const data = await providerJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', fetcher);
      return { versions: data.versions.filter(v => v.type === 'release').slice(0, 80).map(v => v.id) };
    },
    async ftbSearch(query = '') {
      const url = new URL(`${ftbBase}/search/12/detailed`);
      url.searchParams.set('term', query.trim().slice(0, 100) || 'FTB');
      const data = validFtbResponse(await providerJson(url, fetcher));
      return { hits: (data.packs || []).filter(pack => pack.provider === 'ftb' && ftbId.safeParse(String(pack.id)).success).slice(0, 12).map(pack => ({ id: String(pack.id), slug: String(pack.id), title: pack.name, description: pack.synopsis || '', downloads: Number(pack.installs) || 0, versions: [], provider: 'ftb' })) };
    },
    async ftbVersions(packId) {
      ftbId.parse(packId);
      const data = validFtbResponse(await providerJson(`${ftbBase}/${packId}`, fetcher));
      if (data.private || String(data.id) !== packId || !Array.isArray(data.versions)) throw Object.assign(new Error('FTB-Pack ist nicht öffentlich verfügbar.'), { status: 404 });
      const versions = data.versions.filter(version => !version.private && version.type === 'release').sort((a, b) => Number(b.released || b.updated) - Number(a.released || a.updated)).slice(0, 100).map(normalizeFtbVersion).filter(Boolean);
      return { pack: { id: String(data.id), name: data.name }, versions };
    },
    async ftbVersion(packId, versionId) {
      ftbId.parse(packId); ftbId.parse(versionId);
      // The pack lists exact per-version targets/specs. Its full version endpoint also includes huge file manifests, unnecessary for safe selection.
      const pack = validFtbResponse(await providerJson(`${ftbBase}/${packId}`, fetcher));
      const selected = pack.versions?.find(version => String(version.id) === versionId);
      const version = selected ? normalizeFtbVersion(selected) : null;
      if (pack.private || String(pack.id) !== packId || !version || selected.private || selected.type !== 'release') throw Object.assign(new Error('FTB-Version ist nicht öffentlich verfügbar oder inkompatibel.'), { status: 400 });
      return version;
    },
  };
}
