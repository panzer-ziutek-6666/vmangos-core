import { listAccounts } from '../queries/accounts.js';
import {
  buildCreateAccount, buildSetGmLevel, buildSetPassword,
  buildBanAccount, buildUnbanAccount, buildDeleteAccount,
  redactCommandForAudit
} from '../commands/accounts.js';
import { readStatus } from '../status.js';
import { renderPage } from '../views/layout.js';
import { renderAccountsBody, renderResult, renderError } from '../views/accounts.js';

// Each action turns form fields into a command string. A builder that throws
// means the input was rejected before anything reached the server, so nothing
// is sent and nothing is audited.
//
// unban takes a mandatory reason: HandleUnBanHelper
// (src/game/Commands/AccountCommands.cpp) extracts the account name and then
// requires a second argument, returning false with no error message if it is
// absent, so `.unban account <name>` alone would silently do nothing.
const ACTIONS = {
  create: (b) => buildCreateAccount(b.name, b.pass),
  gmlevel: (b) => {
    // A repeated form field ("level" submitted twice) arrives here as an
    // array. Number.parseInt on an array coerces it via toString() (e.g.
    // ['3', '9'] -> "3,9" -> 3) and silently succeeds instead of rejecting
    // the malformed input the way every other validator in this file does.
    if (typeof b.level !== 'string') {
      throw new Error('gm level must be an integer from 0 to 6');
    }
    return buildSetGmLevel(b.name, Number.parseInt(b.level, 10));
  },
  password: (b) => buildSetPassword(b.name, b.pass),
  ban: (b) => buildBanAccount(b.name, b.duration, b.reason),
  unban: (b) => buildUnbanAccount(b.name, b.reason),
  delete: (b) => {
    // Enforced server-side so posting directly cannot skip it.
    if (!b.confirm || b.confirm !== b.name) {
      throw new Error('To delete an account you must type the account name to confirm.');
    }
    return buildDeleteAccount(b.name);
  }
};

export function registerAccounts(app) {
  const { soap, pools, audit, config } = app.deps;

  app.get('/accounts', async (req, reply) => {
    const includeBots = req.query.bots === '1';
    const [status, rows] = await Promise.all([
      readStatus({ soap, pools, config }),
      listAccounts(pools, { includeBots, botPrefix: config.bots.accountPrefix, realmId: config.realm.id })
    ]);
    const body = renderAccountsBody({ rows, includeBots, soapUser: config.soap?.user ?? '[read-only]', result: null, reachable: status.reachable });
    reply.type('text/html').send(renderPage({ title: 'Accounts', active: 'accounts', body, status }));
  });

  app.post('/accounts/:action', async (req, reply) => {
    // ACTIONS is a plain object literal, so a lookup by an attacker-chosen
    // key ("constructor", "toString", "hasOwnProperty", ...) would otherwise
    // resolve through Object.prototype instead of failing. Object.hasOwn
    // restricts the lookup to the action names actually declared above.
    const build = Object.hasOwn(ACTIONS, req.params.action) ? ACTIONS[req.params.action] : null;
    if (!build) {
      return reply.code(404).type('text/html').send(renderError(`Unknown action "${req.params.action}".`));
    }

    // Checked before anything is built or sent: a stale reachability read
    // (the status strip is cached and can be a few seconds behind) must
    // never let a destructive action through while the panel is telling the
    // operator that commands are disabled.
    const status = await readStatus({ soap, pools, config });
    if (!status.reachable) {
      return reply.code(503).type('text/html').send(
        renderError('mangosd is not reachable. Commands are disabled until the connection recovers.')
      );
    }

    let command;
    try {
      command = build(req.body ?? {});
    } catch (err) {
      return reply.code(400).type('text/html').send(renderError(err.message));
    }

    // The real command, password included, is what must reach the server.
    const result = await soap.execute(command);

    // Everything downstream of here - the audit row and the rendered page -
    // gets the redacted copy instead. The operator just typed the password,
    // so echoing it back once is not a new disclosure, but persisting it in
    // audit.sqlite or leaving it in the page is.
    const auditCommand = redactCommandForAudit(command);
    const auditId = audit.record({
      section: 'accounts',
      action: req.params.action,
      command: auditCommand,
      status: result.status,
      ok: result.ok,
      output: result.output,
      durationMs: result.durationMs
    });

    reply.type('text/html').send(renderResult({ ...result, command: auditCommand, auditFailed: auditId === null }));
  });
}
