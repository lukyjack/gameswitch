import path from 'node:path';

export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const host = env.HOST || '127.0.0.1';
  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const origin = new URL(env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`);
  if (!['https:', 'http:'].includes(origin.protocol)) throw new Error('PUBLIC_ORIGIN must use HTTP(S)');
  if (origin.origin !== origin.href.replace(/\/$/, '') || origin.username || origin.password) throw new Error('PUBLIC_ORIGIN must contain an origin only');
  if (!['sandbox', 'pufferpanel'].includes(env.RUNTIME_MODE || 'sandbox')) throw new Error('Invalid RUNTIME_MODE');
  const loopbackTunnel = env.ALLOW_LOOPBACK_HTTP_OVER_SSH === 'true';
  if (loopbackTunnel && (host !== '127.0.0.1' || origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:')) throw new Error('SSH tunnel mode requires loopback HTTP on both listener and PUBLIC_ORIGIN');
  if (production && origin.protocol !== 'https:' && !loopbackTunnel) throw new Error('Production requires HTTPS or explicit loopback SSH tunnel mode');
  if (!production && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Non-production mode only binds to loopback');
  let pufferUrl;
  if ((env.RUNTIME_MODE || 'sandbox') === 'pufferpanel') {
    pufferUrl = new URL(env.PUFFERPANEL_URL || 'http://127.0.0.1:8080');
    if (!['http:', 'https:'].includes(pufferUrl.protocol) || pufferUrl.username || pufferUrl.password || pufferUrl.search || pufferUrl.hash || pufferUrl.pathname !== '/') throw new Error('Invalid PUFFERPANEL_URL');
    if (pufferUrl.protocol !== 'https:' && !['127.0.0.1', '[::1]', 'localhost'].includes(pufferUrl.hostname)) throw new Error('Remote PufferPanel requires HTTPS');
    if (!env.PUFFERPANEL_CLIENT_ID || !env.PUFFERPANEL_CLIENT_SECRET) throw new Error('PufferPanel OAuth client credentials required');
  }
  const positive = (value, fallback, max) => {
    const n = Number(value || fallback);
    if (!Number.isInteger(n) || n < 1 || n > max) throw new Error('Invalid resource configuration');
    return n;
  };
  return {
    production, host, port, origin: origin.origin, loopbackTunnel, secureCookies: origin.protocol === 'https:', trustLoopbackProxy: env.TRUST_LOOPBACK_PROXY === 'true',
    dataDir: path.resolve(env.DATA_DIR || './data'),
    gameLibraryDir: path.resolve('/var/lib/gameswitch-libraries'),
    mode: env.RUNTIME_MODE || 'sandbox',
    pufferUrl: pufferUrl?.origin,
    clientId: env.PUFFERPANEL_CLIENT_ID,
    clientSecret: env.PUFFERPANEL_CLIENT_SECRET,
    nodeId: Number(env.PUFFERPANEL_NODE_ID || 0),
    gameUid: positive(env.GAME_UID, 1000, 65535),
    gameGid: positive(env.GAME_GID, 1000, 65535),
    memoryMb: positive(env.HOST_MEMORY_MB, 16384, 1048576),
    reservedMemoryMb: positive(env.RESERVED_MEMORY_MB, 3072, 1048576),
    cpuCores: positive(env.HOST_CPU_CORES, 8, 1024),
    sessionHours: 8,
  };
}
