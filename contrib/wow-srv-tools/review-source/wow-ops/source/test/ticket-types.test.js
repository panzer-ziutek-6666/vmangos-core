import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketCategoryName, TICKET_CATEGORY_FILTERS, escalationName, describeClosedBy } from '../server/ticketTypes.js';

test('categories are named the way the core names them', () => {
  // GmTicket::GetTicketCategoryName (GMTicketMgr.cpp:205-230).
  assert.equal(ticketCategoryName(1), 'Stuck');
  assert.equal(ticketCategoryName(2), 'Behavior');
  assert.equal(ticketCategoryName(5), 'Environment');
  assert.equal(ticketCategoryName(6), 'Creature');
  assert.equal(ticketCategoryName(9), 'Billing');
  assert.equal(ticketCategoryName(10), 'Character');
});

test('a category outside 1-10 is reported, not invented', () => {
  assert.equal(ticketCategoryName(0), 'unknown (0)');
  assert.equal(ticketCategoryName(11), 'unknown (11)');
});

test('the list filters are the literals the core accepts', () => {
  // TicketCommands.cpp:281-287. Only one spelling per category is offered,
  // though the core accepts several.
  assert.deepEqual(TICKET_CATEGORY_FILTERS, [
    'stuck', 'behavior', 'guild', 'item', 'environment', 'creature', 'quest',
    'technical', 'account', 'character'
  ]);
});

test('escalation status is named', () => {
  // GMTicketMgr.h:62-68.
  assert.equal(escalationName(0), 'unassigned');
  assert.equal(escalationName(1), 'assigned');
  assert.equal(escalationName(2), 'in escalation queue');
  assert.equal(escalationName(3), 'escalated and assigned');
  assert.equal(escalationName(7), 'unknown (7)');
});

test('closed_by tells four different stories', () => {
  // GMTicketMgr.h:167: 0 open, -1 console, creator guid = the player abandoned
  // it, any other guid = the GM who closed it.
  assert.deepEqual(describeClosedBy(0, 5), { state: 'open', guid: null });
  assert.deepEqual(describeClosedBy(-1, 5), { state: 'console', guid: null });
  assert.deepEqual(describeClosedBy(5, 5), { state: 'abandoned', guid: 5 });
  assert.deepEqual(describeClosedBy(9, 5), { state: 'gm', guid: 9 });
});
