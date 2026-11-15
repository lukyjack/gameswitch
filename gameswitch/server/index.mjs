import { createApp } from './app.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const instance = await createApp();
if (instance.config.production && instance.bootstrapToken) {
  await fs.writeFile(path.join(instance.config.dataDir, 'setup-token'), instance.bootstrapToken + '\n', { mode: 0o600 });
}
const server = instance.app.listen(instance.config.port, instance.config.host, () => {
  console.log(`GameSwitch API: http://${instance.config.host}:${instance.config.port}`);
  console.log(`Runtime: ${instance.config.mode === 'sandbox' ? 'SANDBOX (keine echten Spielserver)' : 'PufferPanel'}`);
  if (instance.bootstrapToken) {
    if (instance.config.production) console.log('Einrichtung erforderlich. Einrichtungstoken liegt geschützt im Datenverzeichnis.');
    else console.log(`Einmaliger Einrichtungsschlüssel (lokal, nicht weitergeben): ${instance.bootstrapToken}`);
  }
});
server.requestTimeout = 20000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
let stopping = false;
const shutdown = () => {
  if (stopping) return; stopping = true;
  // Close authenticated event streams and the private setup connection before
  // waiting for HTTP shutdown; an SSE stream must not hold this process open.
  const closing = instance.close();
  server.close(async () => { await closing; process.exit(0); });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
