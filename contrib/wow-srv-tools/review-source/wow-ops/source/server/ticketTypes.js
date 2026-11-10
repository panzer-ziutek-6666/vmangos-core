// The ticket vocabulary, mirrored from the core so the page never shows a bare
// number the operator has to go and look up.
//
// Categories are TicketType 1-10 (vmangos-core/src/game/SharedDefines.h:
// 1774-1787), and these are the core's own display names from
// GmTicket::GetTicketCategoryName (GMTicketMgr.cpp:205-230).
const CATEGORIES = {
  1: 'Stuck', 2: 'Behavior', 3: 'Guild', 4: 'Item', 5: 'Environment',
  6: 'Creature', 7: 'Quest', 8: 'Technical', 9: 'Billing', 10: 'Character'
};

// The literals `.ticket list` accepts as a filter (TicketCommands.cpp:281-287).
// The core takes several spellings for some categories (harassment, world, npc,
// creep, questnpc, billing); one is offered per category, in category order, so
// the dropdown reads as a list of categories rather than a thesaurus.
export const TICKET_CATEGORY_FILTERS = [
  'stuck', 'behavior', 'guild', 'item', 'environment', 'creature', 'quest',
  'technical', 'account', 'character'
];

// GMTicketEscalationStatus (GMTicketMgr.h:62-68).
const ESCALATION = {
  0: 'unassigned', 1: 'assigned', 2: 'in escalation queue', 3: 'escalated and assigned'
};

function lookup(table, id) {
  const key = Number(id);
  return Object.hasOwn(table, key) ? table[key] : `unknown (${id})`;
}

export function ticketCategoryName(id) {
  return lookup(CATEGORIES, id);
}

export function escalationName(id) {
  return lookup(ESCALATION, id);
}

// closed_by carries four meanings in one column, spelled out at
// GMTicketMgr.h:167. Showing it as a raw guid would hide the two that matter
// most: a ticket the player withdrew, and one closed from a console rather than
// by a GM in the world.
export function describeClosedBy(closedBy, creatorGuid) {
  const value = Number(closedBy);
  if (!Number.isFinite(value) || value === 0) return { state: 'open', guid: null };
  if (value === -1) return { state: 'console', guid: null };
  if (value === Number(creatorGuid)) return { state: 'abandoned', guid: value };
  return { state: 'gm', guid: value };
}
