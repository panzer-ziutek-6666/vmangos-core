import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyFormbody from '@fastify/formbody';
import { readConfigFile } from './config.js';
import { createPools } from './db.js';
import { createDisabledSoapClient, createReadOnlyAudit } from './wow-srv-readonly.js';
import { readStatus } from './status.js';
import { renderPage, renderStatusStrip, escapeHtml } from './views/layout.js';
import { registerAccounts } from './sections/accounts.js';
import { registerBots } from './sections/bots.js';
import { registerServer } from './sections/server.js';
import { registerCharacters } from './sections/characters.js';
import { registerEvents } from './sections/events.js';
import { registerTickets } from './sections/tickets.js';
import { registerDb } from './sections/db.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

export function buildApp({ config, soap, pools, audit, readOnly = false }) {
  const app = Fastify({ logger: false });

  // Defense in depth: even a caller that provides a real SOAP client or audit
  // object cannot make a read-only app execute SOAP or record a write.
  if (readOnly) {
    soap = createDisabledSoapClient();
    audit = createReadOnlyAudit();
  }

  // Production entrypoint ALWAYS supplies readOnly: true. This hook runs
  // before any section handler, including direct SQL writes to realmlist.
  if (readOnly) {
    app.addHook('onRequest', async (req, reply) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return reply.code(405).header('Allow', 'GET, HEAD').type('text/plain')
          .send('WOW-SRV read-only: mutating requests are disabled.');
      }
    });
  }

  // Fastify parses JSON out of the box but not form posts. Every action in the
  // panel is an HTML form, so this plugin is required, not optional.
  app.register(fastifyFormbody);
  app.register(fastifyStatic, { root: join(root, 'public'), prefix: '/public/' });

  // The extracted art (cycle 1) lives outside the repository and is served
  // read-only. decorateReply: false because @fastify/static may only decorate
  // the reply once, and the public/ mount above already did.
  const artRoot = config.assets?.root;
  const artAvailable = Boolean(artRoot) && existsSync(join(artRoot, 'icons'));
  if (artAvailable) {
    app.register(fastifyStatic, { root: artRoot, prefix: '/db/art/', decorateReply: false });
  }

  app.decorate('deps', { config, soap, pools, audit, artAvailable });

  // There is no authentication - the panel binds to 127.0.0.1 for a single
  // local operator - but a form POST is a CORS "simple request", so any web
  // page the operator's browser happens to have open can submit one here
  // without the browser blocking it or even asking. Binding to loopback does
  // not help: the request still comes from the operator's own browser.
  // Reject anything that does not look like it came from this panel's own
  // pages, checked before any route runs.
  //
  // The Host check also closes DNS rebinding: an attacker-controlled DNS
  // name that resolves to 127.0.0.1 would pass a same-origin browser check
  // while carrying a Host header this panel never advertised.
  app.addHook('onRequest', async (req, reply) => {
    const port = config.panel.port;
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    const host = req.headers.host;
    if (!host || !allowedHosts.has(host)) {
      reply.code(403).type('text/plain').send('Forbidden: unexpected Host header.');
      return;
    }

    // A top-level GET navigation is exempt: the operator reaching a panel
    // page from a link in any other application arrives with
    // Sec-Fetch-Site: cross-site, and so does an automated browser. That is
    // not the attack this hook exists for - every mutating route is a POST,
    // and a cross-origin navigation lets the originating page read nothing
    // of the response. Anything else cross-site, including a sub-resource or
    // a fetch, is still refused.
    const secFetchSite = req.headers['sec-fetch-site'];
    const topLevelRead =
      (req.method === 'GET' || req.method === 'HEAD') &&
      req.headers['sec-fetch-mode'] === 'navigate' &&
      req.headers['sec-fetch-dest'] === 'document';
    if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none' && !topLevelRead) {
      reply.code(403).type('text/plain').send('Forbidden: cross-site request.');
      return;
    }

    const origin = req.headers.origin;
    if (origin) {
      const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
      if (!allowedOrigins.has(origin)) {
        reply.code(403).type('text/plain').send('Forbidden: unexpected Origin header.');
        return;
      }
    }
  });

  // A dead MySQL pool should name the database it could not reach. mysql2
  // never sets err.dbName, though, so there is no reliable way to identify the
  // pool from the error alone. The one place a schema name can actually
  // surface is err.sqlMessage, and only for ER_BAD_DB_ERROR ("Unknown
  // database 'x'"); match that against the configured schema names. When it
  // does not match, say plainly that the driver did not report which
  // database failed rather than defaulting to a generic message that implies
  // otherwise.
  app.setErrorHandler((err, req, reply) => {
    const dbCodes = ['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ETIMEDOUT'];
    if (dbCodes.includes(err.code)) {
      const sqlMessage = err.sqlMessage ?? '';
      const found = Object.entries(config.mysql).find(([, db]) => sqlMessage.includes(db.database));
      const message = found
        ? `Cannot reach the ${escapeHtml(found[0])} MySQL database (${escapeHtml(err.code)}).`
        : `Cannot reach a MySQL database (${escapeHtml(err.code)}); the driver did not report which one.`;
      reply.code(503).type('text/html').send(
        `<p class="error">${message} Is MySQL running? Start it with "Start MySQL.bat" in the server directory.</p>`
      );
      return;
    }
    reply.code(500).type('text/html').send(`<p class="error">${escapeHtml(err.message)}</p>`);
  });

  app.get('/', async (req, reply) => reply.redirect('/accounts'));

  app.get('/status', async (req, reply) => {
    const status = await readStatus({ soap, pools, config });
    reply.type('text/html').send(renderStatusStrip(status));
  });

  app.get('/audit', async (req, reply) => {
    const status = await readStatus({ soap, pools, config });
    const rows = audit.recent(200);
    const body = `<h1>Audit log</h1>
<table>
  <thead><tr><th>when</th><th>section</th><th>action</th><th>command</th><th>status</th><th>ms</th></tr></thead>
  <tbody>
${rows.map((r) => `    <tr><td>${escapeHtml(r.at)}</td><td>${escapeHtml(r.section)}</td><td>${escapeHtml(r.action)}</td><td><code class="command">${escapeHtml(r.command)}</code></td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.duration_ms)}</td></tr>`).join('\n')}
  </tbody>
</table>`;
    reply.type('text/html').send(renderPage({ title: 'Audit log', active: 'audit', body, status }));
  });

  registerAccounts(app);
  registerBots(app);
  registerServer(app);
  registerCharacters(app);
  registerEvents(app);
  registerTickets(app);
  registerDb(app);

  return app;
}

async function main() {
  // Source-only patch does not create private config or any credentials.
  if (process.platform !== 'win32' || (process.env.COMPUTERNAME ?? '').toUpperCase() !== 'WOW-SRV') {
    throw new Error('WOW-SRV read-only entrypoint must not run on another host.');
  }
  if (!process.env.ProgramData || process.env.ProgramData.toLowerCase() !== 'c:\\programdata') {
    throw new Error('WOW-SRV read-only entrypoint requires the expected Windows ProgramData.');
  }
  const privateRoot = join(process.env.ProgramData, 'VMANGOS', 'WowOps');
  const config = readConfigFile(join(privateRoot, 'config.json'), { readOnly: true });
  const soap = createDisabledSoapClient();
  const pools = createPools(config.mysql);
  const audit = createReadOnlyAudit();
  const app = buildApp({ config, soap, pools, audit, readOnly: true });
  await app.listen({ host: '127.0.0.1', port: config.panel.port });
  console.log(`wow-ops listening on http://127.0.0.1:${config.panel.port}`);
}

if (process.argv[1] && process.argv[1].endsWith('app.js')) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
