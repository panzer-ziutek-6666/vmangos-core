import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTicketsBody, renderTicketBody } from '../server/views/tickets.js';

const TICKET = {
  id: 3, guid: 5, name: 'Thrall', message: 'stuck in a rock',
  createTime: 1756800000, lastModifiedTime: 1756800100,
  map: 1, mapName: 'Kalimdor', positionX: 1.5, positionY: 2.5, positionZ: 3.5,
  closedBy: 0, assignedTo: 0, assignedToName: null, closerName: null,
  comment: '', response: '', completed: false, escalated: 0, viewed: false,
  ticketType: 1, securityNeeded: 0
};

test('the list shows the creator, the category and the message', () => {
  const html = renderTicketsBody({ rows: [TICKET], includeClosed: false, result: null, reachable: true });
  assert.match(html, /Thrall/);
  assert.match(html, /Stuck/);
  assert.match(html, /stuck in a rock/);
});

test('an empty list says the table is empty rather than showing nothing', () => {
  const html = renderTicketsBody({ rows: [], includeClosed: false, result: null, reachable: true });
  assert.match(html, /no open tickets/i);
});

test('the closed toggle is offered', () => {
  const open = renderTicketsBody({ rows: [], includeClosed: false, result: null, reachable: true });
  assert.match(open, /\/tickets\?closed=1/);
  const all = renderTicketsBody({ rows: [], includeClosed: true, result: null, reachable: true });
  assert.match(all, /hide closed/i);
});

test('each ticket links to its own page', () => {
  const html = renderTicketsBody({ rows: [TICKET], includeClosed: false, result: null, reachable: true });
  assert.match(html, /href="\/tickets\/3"/);
});

test('a null row set explains itself', () => {
  const html = renderTicketsBody({ rows: null, includeClosed: false, result: null, reachable: true });
  assert.match(html, /not configured/i);
});

test('the detail page shows where the player was standing', () => {
  const html = renderTicketBody({ ticket: TICKET, result: null, reachable: true });
  assert.match(html, /Kalimdor/);
  assert.match(html, /1\.5/);
});

test('the detail page renders every shipped action', () => {
  const html = renderTicketBody({ ticket: TICKET, result: null, reachable: true });
  for (const action of ['view', 'assign', 'unassign', 'comment', 'append', 'appendln', 'responsereset', 'complete', 'close', 'delete', 'reload']) {
    assert.match(html, new RegExp(`hx-post="/tickets/${action}"`), `missing form for ${action}`);
  }
});

test('delete is refused in the UI until the ticket is closed', () => {
  // HandleGMTicketDeleteByIdCommand answers "close it first" for an open ticket
  // (TicketCommands.cpp:216-220), so an enabled button could only produce that
  // error.
  const open = renderTicketBody({ ticket: TICKET, result: null, reachable: true });
  const openForm = open.split('hx-post="/tickets/delete"')[1].split('</form>')[0];
  assert.match(openForm, /disabled/);
  assert.match(open, /close it first/i);

  const closed = renderTicketBody({ ticket: { ...TICKET, closedBy: -1 }, result: null, reachable: true });
  const closedForm = closed.split('hx-post="/tickets/delete"')[1].split('</form>')[0];
  assert.doesNotMatch(closedForm, /disabled/);
});

test('delete asks for the id typed back', () => {
  const html = renderTicketBody({ ticket: { ...TICKET, closedBy: -1 }, result: null, reachable: true });
  const form = html.split('hx-post="/tickets/delete"')[1].split('</form>')[0];
  assert.match(form, /name="confirm"/);
});

test('a console close and an abandoned ticket read differently', () => {
  const fromConsole = renderTicketBody({ ticket: { ...TICKET, closedBy: -1 }, result: null, reachable: true });
  assert.match(fromConsole, /console/i);
  const abandoned = renderTicketBody({ ticket: { ...TICKET, closedBy: 5 }, result: null, reachable: true });
  assert.match(abandoned, /withdrew/i);
});

test('completing is labelled as the one-way door it is', () => {
  // A completed ticket cannot be closed (HandleGMTicketCloseByIdCommand answers
  // "archived", TicketCommands.cpp:76-80) and cannot be deleted either, because
  // deleting requires IsClosed (:216-220). Found live during the walkthrough.
  const html = renderTicketBody({ ticket: TICKET, result: null, reachable: true });
  assert.match(html, /one-way door/i);
  assert.match(html, /acknowledges the response/i);
});

test('a completed ticket explains why delete will not work on it', () => {
  const html = renderTicketBody({ ticket: { ...TICKET, completed: true }, result: null, reachable: true });
  const form = html.split('hx-post="/tickets/delete"')[1].split('</form>')[0];
  assert.match(form, /disabled/);
  assert.match(html, /completed but not closed/i);
});

test('reload says it only works once per ticket per server run', () => {
  // _reloadTicketsSet is inserted into and never erased (GMTicketMgr.cpp:495-497,
  // GMTicketMgr.h:277), so every later reload of an id silently does nothing
  // while still answering "added to reload list".
  const html = renderTicketBody({ ticket: TICKET, result: null, reachable: true });
  assert.match(html, /once per ticket per server run/i);
});

test('the two append buttons say which one ends the line', () => {
  // appendln appends the text and THEN a newline (TicketCommands.cpp:527-529),
  // so it terminates a line rather than starting one - the walkthrough showed
  // two appends running together into "we are looking into itsecond line".
  const html = renderTicketBody({ ticket: TICKET, result: null, reachable: true });
  assert.match(html, /Append and end the line/);
  assert.match(html, /no separator/i);
});

test('every button is disabled when mangosd is unreachable', () => {
  const html = renderTicketBody({ ticket: TICKET, result: null, reachable: false });
  assert.doesNotMatch(html, /<button type="submit">/);
});

test('both pages render the htmx target', () => {
  assert.match(renderTicketsBody({ rows: [], includeClosed: false, result: null, reachable: true }), /id="result"/);
  assert.match(renderTicketBody({ ticket: TICKET, result: null, reachable: true }), /id="result"/);
});

test('the realm-wide commands warn about what they do', () => {
  const html = renderTicketsBody({ rows: [], includeClosed: false, result: null, reachable: true });
  assert.match(html, /hx-post="\/tickets\/reset"/);
  assert.match(html, /hx-post="\/tickets\/togglesystem"/);
  assert.match(html, /every ticket/i);
  assert.match(html, /restart/i);
});
