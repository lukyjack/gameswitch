import { createApp } from './app.mjs';

const instance = await createApp();
const server = instance.app.listen(instance.config.port, instance.config.host, () => {
  console.log(`GameSwitch API: http://${instance.config.host}:${instance.config.port}`);
  console.log(`Runtime: ${instance.config.mode === 'sandbox' ? 'SANDBOX (keine echten Spielserver)' : 'PufferPanel'}`);
  if (instance.bootstrapToken) console.log(`Einmaliger Einrichtungsschlüssel (lokal, nicht weitergeben): ${instance.bootstrapToken}`);
});
server.requestTimeout = 20000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
const shutdown = () => { server.close(async () => { await instance.close(); process.exit(0); }); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
