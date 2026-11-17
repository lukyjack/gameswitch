const administrativePorts = [22, 2222, 3000, 3001, 5173, 5657, 8080, 8443, 9090];

const invalid = message => Object.assign(new Error(message), { status: 400 });

export function gamePorts(profile) {
  const bind = (port, protocol = 'udp', purpose = 'game', hostIp = '0.0.0.0') => ({ port, protocol, hostIp, purpose });
  switch (profile.gameId) {
    case 'minecraft': return [bind(profile.port, 'tcp')];
    case 'gmod': return [bind(profile.port, 'tcp'), bind(profile.port)];
    case 'arma3': return Array.from({ length: 5 }, (_, offset) => bind(profile.port + offset));
    case 'dayz': return [bind(profile.port), bind(profile.port + 1), bind(profile.port + 2), bind(profile.queryPort ?? 27016, 'udp', 'query')];
    case 'valheim': return [bind(profile.port), bind(profile.port + 1)];
    case 'terraria': return [bind(profile.port, 'tcp')];
    case 'factorio': return [bind(profile.port)];
    case 'squad': {
      const query = profile.queryPort ?? 27165;
      const beacon = profile.beaconPort ?? 15000;
      return [bind(profile.port), bind(profile.port + 1), bind(query, 'udp', 'query'), bind(query + 1, 'udp', 'query'), bind(query, 'tcp', 'query'), bind(query + 1, 'tcp', 'query'), bind(beacon, 'udp', 'beacon'), bind(beacon, 'tcp', 'beacon'), bind(21114, 'tcp', 'rcon', '127.0.0.1')];
    }
    case 'fs25': throw invalid('Farming Simulator 25 ist auf dieser Debian-VPS nicht verfügbar: Windows und separate Spiellizenz erforderlich.');
    default: throw invalid('Unbekanntes Spiel.');
  }
}

export function validateGamePorts(profile, config = {}) {
  const reserved = new Set([...administrativePorts, config.port].filter(Number.isInteger));
  if (config.pufferUrl) {
    const url = new URL(config.pufferUrl);
    reserved.add(Number(url.port || (url.protocol === 'https:' ? 443 : 80)));
  }
  const ports = gamePorts(profile);
  const claims = new Set();
  for (const binding of ports) {
    if (!Number.isInteger(binding.port) || binding.port < 1024 || binding.port > 65535) throw invalid('Ein Spiel-Portbereich liegt außerhalb von 1024–65535.');
    if (reserved.has(binding.port)) throw invalid('Ein Spiel-Port kollidiert mit einem reservierten Administrationsport.');
    const key = `${binding.protocol}:${binding.port}`;
    if (claims.has(key)) throw invalid('Die Spiel-, Query-, Beacon- oder privaten RCON-Ports überschneiden sich innerhalb dieses Profils.');
    claims.add(key);
    if (binding.purpose === 'rcon' && binding.hostIp !== '127.0.0.1') throw invalid('RCON darf nur an Loopback gebunden werden.');
  }
  return ports;
}

export function dockerPortBindings(profile, config = {}) {
  // PufferPanel publishes stdin.port itself, bound to 127.0.0.1. Do not add it
  // a second time or expose it on a public host address.
  return validateGamePorts(profile, config).filter(binding => binding.purpose !== 'rcon').map(binding => `${binding.hostIp}:${binding.port}:${binding.port}/${binding.protocol}`);
}

export function profilesHavePortCollision(first, second) {
  const claims = new Set(gamePorts(first).map(binding => `${binding.protocol}:${binding.port}`));
  return gamePorts(second).some(binding => claims.has(`${binding.protocol}:${binding.port}`));
}
