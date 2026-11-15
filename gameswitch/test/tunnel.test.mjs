import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../server/config.mjs';

test('production SSH tunnel exception remains explicitly restricted to loopback', () => {
  const env = { NODE_ENV: 'production', HOST: '127.0.0.1', PUBLIC_ORIGIN: 'http://127.0.0.1:3001', ALLOW_LOOPBACK_HTTP_OVER_SSH: 'true' };
  const config = readConfig(env);
  assert.equal(config.loopbackTunnel, true);
  assert.equal(config.secureCookies, false);
  assert.throws(() => readConfig({ ...env, HOST: '0.0.0.0' }));
  assert.throws(() => readConfig({ ...env, PUBLIC_ORIGIN: 'http://example.com:3001' }));
  assert.throws(() => readConfig({ ...env, ALLOW_LOOPBACK_HTTP_OVER_SSH: '' }));
  assert.equal(readConfig({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://example.com' }).secureCookies, true);
});
