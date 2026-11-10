// The `.ticket` family. Sixteen of its twenty-one subcommands are
// allowConsole = true (vmangos-core/src/game/Chat/Chat.cpp:1115-1145) and are
// built here. The five that are not - escalate, counter, next, previous and
// notify - need an in-world session and have no builder, because a button for
// them could only ever fail.
//
// The console's standing is what makes this section work at all: close,
// complete and response append each guard their "assigned to you" rule with
// `if (player && ...)` (TicketCommands.cpp:84, 176, 520), and a SOAP session
// has no player, so the panel may act on any ticket regardless of who holds it.
import { assertTicketId, assertCharacterName, assertMessageText } from './validate.js';
import { TICKET_CATEGORY_FILTERS } from '../ticketTypes.js';

// An unknown filter is not an error to the handler: it looks the word up, finds
// nothing, and lists everything (TicketCommands.cpp:289-294). Sending one would
// hand the operator an unfiltered list they believe is filtered, so a category
// the core does not know is refused here instead.
function assertCategory(category) {
  if (category === undefined || category === null || category === '') return null;
  const text = String(category).trim().toLowerCase();
  if (!TICKET_CATEGORY_FILTERS.includes(text)) {
    throw new Error(`category must be one of ${TICKET_CATEGORY_FILTERS.join(', ')}`);
  }
  return text;
}

function listCommand(name, category) {
  const filter = assertCategory(category);
  return filter ? `.ticket ${name} ${filter}` : `.ticket ${name}`;
}

export function buildTicketList(category) {
  return listCommand('list', category);
}

export function buildTicketOnlineList(category) {
  return listCommand('onlinelist', category);
}

export function buildTicketClosedList(category) {
  return listCommand('closedlist', category);
}

// The escalated list takes no category filter (TicketCommands.cpp's escalated
// handler reads no argument at all).
export function buildTicketEscalatedList() {
  return '.ticket escalatedlist';
}

export function buildTicketViewId(id) {
  return `.ticket viewid ${assertTicketId(id)}`;
}

export function buildTicketViewName(name) {
  assertCharacterName(name);
  return `.ticket viewname ${name}`;
}

// The name is mandatory here even though the command's own signature makes it
// optional: without a session the default target is the empty string and the
// handler returns a syntax error (TicketCommands.cpp:18-23).
export function buildTicketAssign(id, name) {
  const ticket = assertTicketId(id);
  assertCharacterName(name);
  return `.ticket assign ${ticket} ${name}`;
}

export function buildTicketUnassign(id) {
  return `.ticket unassign ${assertTicketId(id)}`;
}

// The text is the rest of the line, read with strtok(nullptr, "\n")
// (TicketCommands.cpp:115, 507), so it is not a quoted argument: a quotation
// mark in it is ordinary and must not be rejected. What cannot pass is a line
// break, which would split the SOAP command in two.
export function buildTicketComment(id, text) {
  const ticket = assertTicketId(id);
  assertMessageText(text, 'comment');
  return `.ticket comment ${ticket} ${text}`;
}

export function buildTicketResponseAppend(id, text) {
  const ticket = assertTicketId(id);
  assertMessageText(text, 'response');
  return `.ticket response append ${ticket} ${text}`;
}

export function buildTicketResponseAppendLn(id, text) {
  const ticket = assertTicketId(id);
  assertMessageText(text, 'response');
  return `.ticket response appendln ${ticket} ${text}`;
}

export function buildTicketResponseReset(id) {
  return `.ticket response reset ${assertTicketId(id)}`;
}

// Completing may carry a final response, which the handler appends before
// marking the ticket complete (TicketCommands.cpp:170-186).
export function buildTicketComplete(id, text) {
  const ticket = assertTicketId(id);
  if (text === undefined || text === null || text === '') {
    return `.ticket complete ${ticket}`;
  }
  assertMessageText(text, 'response');
  return `.ticket complete ${ticket} ${text}`;
}

export function buildTicketClose(id) {
  return `.ticket close ${assertTicketId(id)}`;
}

// Refused by the core unless the ticket is already closed
// (TicketCommands.cpp:216-220); the view disables the button until then.
export function buildTicketDelete(id) {
  return `.ticket delete ${assertTicketId(id)}`;
}

// Reloads one ticket from the database, not the whole system
// (TicketCommands.cpp:600-607).
export function buildTicketReload(id) {
  return `.ticket reload ${assertTicketId(id)}`;
}

// Deletes every ticket and resets the id counter. The core refuses it while any
// ticket is open (TicketCommands.cpp:319-330), which is a real guard, but the
// route still asks for a typed phrase.
export function buildTicketReset() {
  return '.ticket reset';
}

// Turns ticket filing on or off for the whole realm - a toggle, not a setter,
// so nothing here can say which way it will flip. It is memory only:
// TicketMgr::SetStatus is a plain setter with no persistence
// (GMTicketMgr.h:248), so a restart re-enables filing.
export function buildTicketToggleSystem() {
  return '.ticket togglesystem';
}
