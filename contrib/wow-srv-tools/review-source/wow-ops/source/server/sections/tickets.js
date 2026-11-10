import { listTickets, getTicket } from '../queries/tickets.js';
import { assertTicketId } from '../commands/validate.js';
import {
  buildTicketList, buildTicketOnlineList, buildTicketClosedList, buildTicketEscalatedList,
  buildTicketViewId, buildTicketViewName, buildTicketAssign, buildTicketUnassign,
  buildTicketComment, buildTicketResponseAppend, buildTicketResponseAppendLn,
  buildTicketResponseReset, buildTicketComplete, buildTicketClose, buildTicketDelete,
  buildTicketReload, buildTicketReset, buildTicketToggleSystem
} from '../commands/tickets.js';
import { readStatus } from '../status.js';
import { renderPage } from '../views/layout.js';
import { renderTicketsBody, renderTicketBody, renderResult, renderError } from '../views/tickets.js';

// A field submitted twice arrives as an array, which String() would turn into
// "3,4". Every field is required to be a string first.
function requireString(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} is required`);
  return value;
}

// An optional text field: absent is fine, an array is not.
function optionalString(value, label) {
  if (value === undefined || value === null) return undefined;
  return requireString(value, label);
}

function requireConfirmation(typed, expected, message) {
  if (typeof typed !== 'string' || typed !== expected) throw new Error(message);
}

const ACTIONS = {
  view: (b) => buildTicketViewId(requireString(b.id, 'ticket id')),
  viewname: (b) => buildTicketViewName(requireString(b.name, 'character name')),
  list: (b) => buildTicketList(optionalString(b.category, 'category')),
  onlinelist: (b) => buildTicketOnlineList(optionalString(b.category, 'category')),
  closedlist: (b) => buildTicketClosedList(optionalString(b.category, 'category')),
  escalatedlist: () => buildTicketEscalatedList(),
  assign: (b) => buildTicketAssign(requireString(b.id, 'ticket id'), requireString(b.name, 'character name')),
  unassign: (b) => buildTicketUnassign(requireString(b.id, 'ticket id')),
  comment: (b) => buildTicketComment(requireString(b.id, 'ticket id'), requireString(b.text, 'comment')),
  append: (b) => buildTicketResponseAppend(requireString(b.id, 'ticket id'), requireString(b.text, 'response')),
  appendln: (b) => buildTicketResponseAppendLn(requireString(b.id, 'ticket id'), requireString(b.text, 'response')),
  responsereset: (b) => buildTicketResponseReset(requireString(b.id, 'ticket id')),
  complete: (b) => buildTicketComplete(requireString(b.id, 'ticket id'), optionalString(b.text, 'response')),
  close: (b) => buildTicketClose(requireString(b.id, 'ticket id')),
  reload: (b) => buildTicketReload(requireString(b.id, 'ticket id')),
  // The ticket row is gone for good, so the id has to be typed back.
  delete: (b) => {
    const id = requireString(b.id, 'ticket id');
    requireConfirmation(b.confirm, id, 'To delete a ticket you must type its id to confirm. This cannot be undone.');
    return buildTicketDelete(id);
  },
  // A phrase rather than an id, because this one is not about a ticket: it
  // deletes all of them and resets the counter.
  reset: (b) => {
    requireConfirmation(b.confirm, 'DELETE ALL TICKETS', 'To delete every ticket you must type DELETE ALL TICKETS to confirm.');
    return buildTicketReset();
  },
  // A toggle, not a setter: nothing on the form can say which way it will flip,
  // so the confirmation is a word rather than a state.
  togglesystem: (b) => {
    requireConfirmation(b.confirm, 'toggle', 'To turn ticket filing on or off for the whole realm you must type toggle to confirm.');
    return buildTicketToggleSystem();
  }
};

export function registerTickets(app) {
  const { soap, pools, audit, config } = app.deps;

  app.get('/tickets', async (req, reply) => {
    const includeClosed = req.query.closed === '1';
    const [status, rows] = await Promise.all([
      readStatus({ soap, pools, config }),
      listTickets(pools, config, { includeClosed })
    ]);
    const body = renderTicketsBody({ rows, includeClosed, result: null, reachable: status.reachable });
    reply.type('text/html').send(renderPage({ title: 'Tickets', active: 'tickets', body, status }));
  });

  app.get('/tickets/:id', async (req, reply) => {
    const status = await readStatus({ soap, pools, config });

    // Validated with the rule the commands use, before it reaches SQL, and
    // answered as a whole page: this route is reached by a link or a typed URL,
    // not by htmx swapping a fragment into a page that already exists.
    let id;
    try {
      id = assertTicketId(req.params.id);
    } catch (err) {
      return reply.code(400).type('text/html').send(renderPage({
        title: 'Tickets', active: 'tickets', status, body: renderError(err.message)
      }));
    }

    const ticket = await getTicket(pools, config, Number(id));
    if (!ticket) {
      return reply.code(404).type('text/html').send(renderPage({
        title: 'Tickets', active: 'tickets', status,
        body: renderError(`No ticket with id ${id}.`)
      }));
    }
    const body = renderTicketBody({ ticket, result: null, reachable: status.reachable });
    reply.type('text/html').send(renderPage({ title: `Ticket ${ticket.id}`, active: 'tickets', body, status }));
  });

  app.post('/tickets/:action', async (req, reply) => {
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
      section: 'tickets', action: req.params.action, command,
      status: result.status, ok: result.ok, output: result.output, durationMs: result.durationMs
    });

    reply.type('text/html').send(renderResult({ ...result, command, auditFailed: auditId === null }));
  });
}
