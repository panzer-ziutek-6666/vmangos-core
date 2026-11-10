import {
  buildMotd, buildSetMotd, buildAnnounce, buildNotify, buildSaveAll, buildCorpses,
  buildResetAllRaids, buildPlimit, buildShutdown, buildShutdownCancel, SHUTDOWN_KINDS
} from '../commands/server.js';
import {
  listRealms, getRealm, insertRealm, updateRealm, deleteRealm, listUptimeHistory
} from '../queries/realms.js';
import { normalizeRealmInput } from '../realmFields.js';
import { readStatus } from '../status.js';
import { renderPage } from '../views/layout.js';
import { renderServerBody, renderRealmsPanel, renderResult, renderError } from '../views/server.js';

// A confirmed action requires the operator to type the action's own name.
// Enforced here, server side, so posting the route directly cannot skip it -
// the same rule the Accounts section applies to account deletion.
function confirmed(body, word) {
  if (body.confirm !== word) {
    throw new Error(`To do this you must type ${word} to confirm.`);
  }
}

const ACTIONS = {
  motd: () => buildMotd(),
  setmotd: (b) => buildSetMotd(b.text),
  announce: (b) => buildAnnounce(b.text),
  notify: (b) => buildNotify(b.text),
  saveall: () => buildSaveAll(),
  corpses: () => buildCorpses(),
  plimit: (b) => buildPlimit(b.value),
  resetallraids: (b) => {
    confirmed(b, 'resetallraids');
    return buildResetAllRaids();
  },
  // Cancel is the one action in the shutdown family that needs no
  // confirmation: it makes the server safer, not less safe.
  cancel: () => buildShutdownCancel()
};

for (const kind of SHUTDOWN_KINDS) {
  ACTIONS[kind] = (b) => {
    confirmed(b, kind);
    return buildShutdown(kind, b.delay);
  };
}

export function registerServer(app) {
  const { soap, pools, audit, config } = app.deps;

  app.get('/server', async (req, reply) => {
    const [status, uptimeRows, realms] = await Promise.all([
      readStatus({ soap, pools, config }),
      listUptimeHistory(pools, 20),
      listRealms(pools)
    ]);
    const body = renderServerBody({
      uptimeRows, realms, realmId: config.realm.id, result: null, reachable: status.reachable
    });
    reply.type('text/html').send(renderPage({ title: 'Server', active: 'server', body, status }));
  });

  app.post('/server/:action', async (req, reply) => {
    // Object.hasOwn, not a bare lookup: an attacker-chosen key such as
    // "constructor" would otherwise resolve through Object.prototype and be
    // sent to the server as "[object Object]".
    const build = Object.hasOwn(ACTIONS, req.params.action) ? ACTIONS[req.params.action] : null;
    if (!build) {
      return reply.code(404).type('text/html').send(renderError(`Unknown action "${req.params.action}".`));
    }

    // Checked before anything is built or sent: the status read is cached for
    // a few seconds, and a stale "reachable" must never let a shutdown
    // through while the panel is telling the operator commands are disabled.
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

    const result = await soap.execute(command);
    // No redaction here: nothing this section sends carries a credential.
    const auditId = audit.record({
      section: 'server',
      action: req.params.action,
      command,
      status: result.status,
      ok: result.ok,
      output: result.output,
      durationMs: result.durationMs
    });

    reply.type('text/html').send(renderResult({ ...result, command, auditFailed: auditId === null }));
  });

  // The realm registry is SQL, not SOAP, and deliberately so: mangosd never
  // reads realmlist, realmd does, and realmd re-polls it on its own timer.
  // There is no GM command for this table, so there is nothing to send. That
  // also means these three routes keep working while mangosd is down - which
  // is exactly when an operator is most likely to be editing a realm row.
  //
  // They are audited like every SOAP command, because they change lasting
  // state. The recorded "command" is a description of the write, prefixed
  // SQL so no reader mistakes it for something that was sent to the server.
  function describe(action, id, row) {
    const fields = row ? Object.entries(row).map(([k, v]) => `${k}=${v}`).join(' ') : '';
    return `SQL realmlist ${action}${id === null ? '' : ` id=${id}`}${fields ? ` ${fields}` : ''}`;
  }

  // Every answer these routes give - success, rejection and failure alike -
  // is the realms panel itself, because the forms carry
  // hx-target="#realms". Answering with the #result div the SOAP actions use
  // would swap the panel out for an element the next submit cannot find, and
  // htmx would then abort every later realm action with a targetError before
  // issuing a request.
  async function renderRealms(reply, code, message, ok) {
    const realms = await listRealms(pools);
    return reply.code(code).type('text/html').send(
      renderRealmsPanel({ realms, realmId: config.realm.id, result: { ok, message } })
    );
  }

  app.post('/realms/create', async (req, reply) => {
    let row;
    try {
      row = normalizeRealmInput(req.body ?? {});
    } catch (err) {
      return renderRealms(reply, 400, err.message, false);
    }

    let id;
    try {
      id = await insertRealm(pools, row);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return renderRealms(reply, 400, `There is already a realm named ${row.name}; realm names are unique.`, false);
      }
      throw err;
    }

    audit.record({
      section: 'realms', action: 'create', command: describe('insert', id, row),
      status: 'ok', ok: true, output: `created realm ${id}`, durationMs: 0
    });
    return renderRealms(reply, 200, `Added realm ${id} (${row.name}).`, true);
  });

  // A route parameter is whatever was typed in the URL. The queries reject a
  // non-numeric id themselves, but they throw, and the operator deserves the
  // panel back with an explanation rather than an error page.
  function realmIdOrNull(raw) {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  app.post('/realms/:id/update', async (req, reply) => {
    const id = realmIdOrNull(req.params.id);
    if (id === null) {
      return renderRealms(reply, 400, `"${req.params.id}" is not a realm id.`, false);
    }
    let row;
    try {
      row = normalizeRealmInput(req.body ?? {});
    } catch (err) {
      return renderRealms(reply, 400, err.message, false);
    }

    let affected;
    try {
      affected = await updateRealm(pools, id, row);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return renderRealms(reply, 400, `There is already a realm named ${row.name}; realm names are unique.`, false);
      }
      throw err;
    }

    if (affected === 0) {
      return renderRealms(reply, 200, `There is no realm with id ${id}; nothing was changed.`, false);
    }

    audit.record({
      section: 'realms', action: 'update', command: describe('update', id, row),
      status: 'ok', ok: true, output: `updated realm ${id}`, durationMs: 0
    });
    return renderRealms(reply, 200, `Saved realm ${id} (${row.name}).`, true);
  });

  app.post('/realms/:id/delete', async (req, reply) => {
    const id = realmIdOrNull(req.params.id);
    if (id === null) {
      return renderRealms(reply, 400, `"${req.params.id}" is not a realm id.`, false);
    }
    const existing = await getRealm(pools, id);
    if (!existing) {
      return renderRealms(reply, 200, `There is no realm with id ${id}; nothing was deleted.`, false);
    }
    // Enforced server side so posting the route directly cannot skip it.
    if ((req.body?.confirm ?? '') !== existing.name) {
      return renderRealms(reply, 400, `To delete realm ${id} you must type its name (${existing.name}) to confirm.`, false);
    }

    await deleteRealm(pools, id);
    audit.record({
      section: 'realms', action: 'delete', command: `SQL realmlist delete id=${id} name=${existing.name}`,
      status: 'ok', ok: true, output: `deleted realm ${id}`, durationMs: 0
    });

    const note = Number(id) === Number(config.realm.id)
      ? ' This was the realm the panel is configured for; update realm.id in config.json.'
      : '';
    return renderRealms(reply, 200, `Deleted realm ${id} (${existing.name}).${note}`, true);
  });
}
