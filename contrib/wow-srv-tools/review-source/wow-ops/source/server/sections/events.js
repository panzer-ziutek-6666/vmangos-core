import { listGameEvents } from '../queries/events.js';
import { parseEventList } from '../eventList.js';
import {
  buildEventListAll, buildEventInfo, buildEventStart, buildEventStop,
  buildEventEnable, buildEventDisable
} from '../commands/events.js';
import { readStatus } from '../status.js';
import { renderPage } from '../views/layout.js';
import { renderEventsBody, renderResult, renderError } from '../views/events.js';

// A form field submitted twice arrives as an array, which String() would
// happily turn into "13,14". Every id is required to be a string first, the
// same rule the Accounts and Characters sections apply to their numbers.
function requireString(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} is required`);
  return value;
}

// enable and disable write game_event.disabled through mangosd and survive a
// restart, unlike start and stop; they get the typed confirmation the panel
// uses for every other persistent or wide-reaching action.
function requireConfirmation(typed, expected) {
  if (typeof typed !== 'string' || typed !== expected) {
    throw new Error('To enable or disable an event permanently you must type its id to confirm.');
  }
}

const ACTIONS = {
  info: (b) => buildEventInfo(requireString(b.id, 'event id')),
  start: (b) => buildEventStart(requireString(b.id, 'event id')),
  stop: (b) => buildEventStop(requireString(b.id, 'event id')),
  enable: (b) => {
    const id = requireString(b.id, 'event id');
    requireConfirmation(b.confirm, id);
    return buildEventEnable(id);
  },
  disable: (b) => {
    const id = requireString(b.id, 'event id');
    requireConfirmation(b.confirm, id);
    return buildEventDisable(id);
  }
};

// The live state exists only in mangosd's memory: game_event.disabled says what
// the operator configured, never what is running now - and the core
// force-disables an event outside the running patch without touching that
// column (vmangos-core/src/game/GameEventMgr.cpp:239-240). So the schedule
// comes from SQL, the state comes from the command, and this merges them.
//
// game_event is the row set: every row shows, in id order. An id the live list
// did not carry gets live: false and renders as unknown rather than as
// inactive, because "not listed" and "not running" are different facts. An id
// the live list carries but the table does not is dropped - the two are read a
// moment apart from the same table, and the live test asserts this cannot
// normally happen.
function mergeEvents(rows, liveRows, wowPatch) {
  const live = new Map(liveRows.map((r) => [r.id, r]));
  return rows.map((row) => {
    const hit = live.get(row.id);
    return {
      ...row,
      active: hit ? hit.active : false,
      live: Boolean(hit),
      excludedByPatch: Number.isInteger(wowPatch) && (wowPatch < row.patchMin || wowPatch > row.patchMax)
    };
  });
}

export function registerEvents(app) {
  const { soap, pools, audit, config } = app.deps;

  app.get('/events', async (req, reply) => {
    const [status, rows, listResult] = await Promise.all([
      readStatus({ soap, pools, config }),
      listGameEvents(pools, config),
      soap.execute(buildEventListAll())
    ]);

    const liveRows = listResult.ok ? parseEventList(listResult.output) : [];
    const liveError = listResult.ok ? null : listResult.output;
    const merged = rows === null ? null : mergeEvents(rows, liveRows, config.events?.wowPatch);

    const body = renderEventsBody({
      rows: merged, liveError, result: null,
      reachable: status.reachable, wowPatch: config.events?.wowPatch
    });
    reply.type('text/html').send(renderPage({ title: 'Game events', active: 'events', body, status }));
  });

  app.post('/events/:action', async (req, reply) => {
    // Object.hasOwn so an attacker-chosen key ("constructor", "toString", ...)
    // cannot resolve through Object.prototype and send [object Object] to the
    // live server.
    const build = Object.hasOwn(ACTIONS, req.params.action) ? ACTIONS[req.params.action] : null;
    if (!build) {
      return reply.code(404).type('text/html').send(renderError(`Unknown action "${req.params.action}".`));
    }

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
    const auditId = audit.record({
      section: 'events', action: req.params.action, command,
      status: result.status, ok: result.ok, output: result.output, durationMs: result.durationMs
    });

    reply.type('text/html').send(renderResult({ ...result, command, auditFailed: auditId === null }));
  });
}
