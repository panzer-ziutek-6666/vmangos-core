import { buildApp } from '../../server/app.js';

// The panel over stub pools, for route tests. Was copied into seven db-*
// test files byte for byte; the soap stub carries queueDepth because
// server/status.js calls it on every operator-layout page, and counts
// execute() so a test can assert a browser page never reached SOAP.
export const CONFIG = {
  panel: { port: 8099 },
  soap: { host: '127.0.0.1', port: 7878, user: 'ADMIN', pass: 'x' },
  mysql: { logon: { database: 'realmd' }, world: { database: 'mangos' } },
  bots: { accountPrefix: 'RNDBOT', playerSaveIntervalMs: 900000 },
  realm: { id: 1, wowPatch: 10, clientBuild: 5875 },
  characters: { charDeleteMethod: 0 }, events: { wowPatch: 10 }
};

export const HEADERS = { host: '127.0.0.1:8099' };

export function dbApp({ world, config = CONFIG } = {}) {
  let calls = 0;
  const pools = { world, logon: { query: async () => [[]] } };
  const soap = {
    execute: async () => { calls++; return { ok: false, output: 'offline', status: 'error', durationMs: 1 }; },
    queueDepth: () => 0
  };
  const audit = { record: () => 1, recent: () => [] };
  return { app: buildApp({ config, soap, pools, audit }), executeCalls: () => calls };
}
