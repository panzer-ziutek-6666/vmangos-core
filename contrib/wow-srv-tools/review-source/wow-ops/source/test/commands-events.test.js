import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEventListAll, buildEventInfo, buildEventStart, buildEventStop,
  buildEventEnable, buildEventDisable
} from '../server/commands/events.js';

test('the list command asks for every event, not only the active ones', () => {
  // HandleEventListCommand compares its argument to "all" exactly
  // (ServerCommands.cpp:643-645); without it, only active events are printed.
  assert.equal(buildEventListAll(), '.event list all');
});

test('info has no subcommand name of its own', () => {
  // The info handler is the "" row of eventCommandTable (Chat.cpp:384), so the
  // command is `.event <id>` and never `.event info <id>`.
  assert.equal(buildEventInfo('13'), '.event 13');
});

test('the four state commands take an id', () => {
  assert.equal(buildEventStart('13'), '.event start 13');
  assert.equal(buildEventStop('13'), '.event stop 13');
  assert.equal(buildEventEnable('13'), '.event enable 13');
  assert.equal(buildEventDisable('13'), '.event disable 13');
});

test('an id that is not a whole number is refused', () => {
  for (const build of [buildEventInfo, buildEventStart, buildEventStop, buildEventEnable, buildEventDisable]) {
    assert.throws(() => build('13; .server exit'), /event id/);
    assert.throws(() => build('abc'), /event id/);
    assert.throws(() => build(''), /event id/);
    assert.throws(() => build('-1'), /event id/);
  }
});

test('event id 0 is refused, because the core has no event 0', () => {
  // GameEventMgr's own loop starts at 1 (GameEventMgr.cpp:725) and index 0 is
  // never a valid event.
  assert.throws(() => buildEventStart('0'), /event id/);
});

test('an id beyond the uint16 the core holds is refused', () => {
  // mGameEvent is indexed by uint16 (GameEventMgr::StartEvent takes a uint16).
  assert.throws(() => buildEventStart('65536'), /event id/);
});
