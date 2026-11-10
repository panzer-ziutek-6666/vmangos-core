import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTicketList, buildTicketOnlineList, buildTicketClosedList, buildTicketEscalatedList,
  buildTicketViewId, buildTicketViewName, buildTicketAssign, buildTicketUnassign,
  buildTicketComment, buildTicketResponseAppend, buildTicketResponseAppendLn,
  buildTicketResponseReset, buildTicketComplete, buildTicketClose, buildTicketDelete,
  buildTicketReload, buildTicketReset, buildTicketToggleSystem
} from '../server/commands/tickets.js';

test('the list commands take an optional category filter', () => {
  assert.equal(buildTicketList(), '.ticket list');
  assert.equal(buildTicketList('stuck'), '.ticket list stuck');
  assert.equal(buildTicketOnlineList('guild'), '.ticket onlinelist guild');
  assert.equal(buildTicketClosedList(), '.ticket closedlist');
  assert.equal(buildTicketEscalatedList(), '.ticket escalatedlist');
});

test('a category the core does not know is refused rather than sent', () => {
  // An unknown filter is silently ignored by the handler
  // (TicketCommands.cpp:289-294), so the operator would get an unfiltered list
  // and believe it was filtered.
  assert.throws(() => buildTicketList('urgent'), /category/);
});

test('viewing takes an id or a character name', () => {
  assert.equal(buildTicketViewId('3'), '.ticket viewid 3');
  assert.equal(buildTicketViewName('Thrall'), '.ticket viewname Thrall');
  assert.throws(() => buildTicketViewName('Two Words'), /whitespace/);
});

test('assign always carries a name, because the console has no default', () => {
  // The target defaults to the calling session's player
  // (TicketCommands.cpp:18-23); over SOAP there is none, so a bare assign is a
  // syntax error rather than a self-assignment.
  assert.equal(buildTicketAssign('3', 'Thrall'), '.ticket assign 3 Thrall');
  assert.throws(() => buildTicketAssign('3', ''), /required/);
});

test('the text commands put the id first and the rest of the line after', () => {
  // comment and response append read the id with strtok and then take the
  // remainder of the line (TicketCommands.cpp:112-117, 504-509), so the text is
  // not quoted and a quotation mark in it is ordinary.
  assert.equal(buildTicketComment('3', 'player was moved'), '.ticket comment 3 player was moved');
  assert.equal(buildTicketResponseAppend('3', 'we are on it'), '.ticket response append 3 we are on it');
  assert.equal(buildTicketResponseAppendLn('3', 'thanks'), '.ticket response appendln 3 thanks');
  assert.equal(buildTicketComment('3', 'said "hello"'), '.ticket comment 3 said "hello"');
});

test('a text that would break the single-line command is refused', () => {
  assert.throws(() => buildTicketComment('3', 'two\nlines'), /one line/);
  assert.throws(() => buildTicketComment('3', ''), /required/);
});

test('complete takes an optional closing response', () => {
  assert.equal(buildTicketComplete('3'), '.ticket complete 3');
  assert.equal(buildTicketComplete('3', 'fixed, sorry for the wait'), '.ticket complete 3 fixed, sorry for the wait');
});

test('the id-only commands are built', () => {
  assert.equal(buildTicketUnassign('3'), '.ticket unassign 3');
  assert.equal(buildTicketResponseReset('3'), '.ticket response reset 3');
  assert.equal(buildTicketClose('3'), '.ticket close 3');
  assert.equal(buildTicketDelete('3'), '.ticket delete 3');
  assert.equal(buildTicketReload('3'), '.ticket reload 3');
});

test('the two realm-wide commands take no argument', () => {
  assert.equal(buildTicketReset(), '.ticket reset');
  assert.equal(buildTicketToggleSystem(), '.ticket togglesystem');
});

test('every id-taking builder refuses a non-numeric id', () => {
  for (const build of [buildTicketViewId, buildTicketUnassign, buildTicketResponseReset, buildTicketClose, buildTicketDelete, buildTicketReload]) {
    assert.throws(() => build('3; .server exit'), /ticket id/);
    assert.throws(() => build('0'), /ticket id/);
    assert.throws(() => build(''), /ticket id/);
  }
});
