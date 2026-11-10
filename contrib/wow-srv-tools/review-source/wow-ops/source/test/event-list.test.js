import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEventList } from '../server/eventList.js';

test('an ordinary row parses into id, description and state', () => {
  const rows = parseEventList('13 - Elemental Invasion  [active]');
  assert.deepEqual(rows, [{ id: 13, description: 'Elemental Invasion', active: true }]);
});

test('inactive rows parse too', () => {
  const rows = parseEventList('1 - Midsummer Fire Festival  [inactive]');
  assert.deepEqual(rows, [{ id: 1, description: 'Midsummer Fire Festival', active: false }]);
});

test('a description containing a dash or brackets survives', () => {
  // The list format is "%d - %s %s" (mangos_string 1103) with no escaping, so
  // the state marker must be matched at the END of the line, not anywhere.
  const rows = parseEventList("22 - AQ War Effort (NPC & GO 'Initial') - phase [2]  [active]");
  assert.equal(rows[0].description, "AQ War Effort (NPC & GO 'Initial') - phase [2]");
  assert.equal(rows[0].active, true);
});

test('an empty description is kept as an empty string, not dropped', () => {
  const rows = parseEventList('7 -   [inactive]');
  assert.deepEqual(rows, [{ id: 7, description: '', active: false }]);
});

test('several lines parse, in the order given', () => {
  const rows = parseEventList('1 - A  [inactive]\n2 - B  [active]\n');
  assert.deepEqual(rows.map((r) => r.id), [1, 2]);
});

test('"No event found!" and other prose lines are ignored, not parsed', () => {
  // LANG_NOEVENTFOUND (mangos_string 584) is what a filtered list answers when
  // nothing matched; it is not a row.
  assert.deepEqual(parseEventList('No event found!'), []);
  assert.deepEqual(parseEventList(''), []);
  assert.deepEqual(parseEventList('Cannot reach mangosd at 127.0.0.1:7878'), []);
});

test('a chat-format row is refused rather than half-parsed', () => {
  // LANG_EVENT_ENTRY_LIST_CHAT (583) wraps the name in a |Hgameevent| link.
  // Only a console session reaches this panel, so seeing that format means
  // something is wrong and a silently mangled description would hide it.
  assert.deepEqual(parseEventList('13 - |cffffffff|Hgameevent:13|h[Elemental Invasion]|h|r [active]'), []);
});

test('a non-string input answers an empty list', () => {
  assert.deepEqual(parseEventList(null), []);
  assert.deepEqual(parseEventList(undefined), []);
});
