import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEventsBody } from '../server/views/events.js';

const ROW = {
  id: 13, description: 'Elemental Invasion', active: true, live: true,
  startTime: new Date('2026-09-02T02:33:49Z'), endTime: null,
  occurrenceMinutes: 1440, lengthMinutes: 60,
  hardcoded: false, disabled: false, patchMin: 2, patchMax: 10, excludedByPatch: false
};

function render(overrides = {}) {
  return renderEventsBody({
    rows: [ROW], liveError: null, result: null, reachable: true, wowPatch: 10, ...overrides
  });
}

test('an event renders with its id, description and live state', () => {
  const html = render();
  assert.match(html, /Elemental Invasion/);
  assert.match(html, /active/);
});

test('occurrence and length are rendered as durations, not raw minutes', () => {
  // game_event.occurence and .length are minutes (ServerCommands.cpp:713-714).
  const html = render();
  assert.match(html, /1d/);
  assert.match(html, /1h/);
  assert.doesNotMatch(html, />1440</);
});

test('each row carries its own start and stop buttons', () => {
  const html = render();
  assert.match(html, /hx-post="\/events\/start"/);
  assert.match(html, /hx-post="\/events\/stop"/);
  assert.match(html, /name="id" value="13"/);
});

test('the page says start and stop do not survive a restart', () => {
  const html = render();
  assert.match(html, /restart/i);
  assert.match(html, /temporar/i);
});

test('enable and disable live in their own block and need the id typed back', () => {
  const html = render();
  for (const action of ['enable', 'disable']) {
    const form = html.split(`hx-post="/events/${action}"`)[1].split('</form>')[0];
    assert.match(form, /name="confirm"/, `${action} must ask for a confirmation`);
  }
  assert.match(html, /world database|persists/i);
});

test('a disabled event is marked, and one the patch excludes is marked differently', () => {
  const html = renderEventsBody({
    rows: [
      { ...ROW, id: 1, disabled: true },
      { ...ROW, id: 2, patchMin: 0, patchMax: 1, excludedByPatch: true }
    ],
    liveError: null, result: null, reachable: true, wowPatch: 10
  });
  assert.match(html, /disabled/);
  assert.match(html, /patch/i);
});

test('the page says a flagged event can still be active', () => {
  // GameEventMgr::StartEvent checks only IsValidEvent, never the disabled flag
  // (GameEventMgr.cpp:72-79), and hardcoded driver events call it directly. On
  // this realm event 22 is excluded by patch and active at the same time, so a
  // page that let the two columns contradict each other would be misread.
  const html = renderEventsBody({
    rows: [{ ...ROW, id: 22, active: true, excludedByPatch: true, patchMin: 7, patchMax: 7, hardcoded: true }],
    liveError: null, result: null, reachable: true, wowPatch: 10
  });
  assert.match(html, /can still be active/i);
  assert.match(html, /state column/i);
});

test('a hardcoded event is marked, because start and stop behave differently for it', () => {
  const html = renderEventsBody({ rows: [{ ...ROW, hardcoded: true }], liveError: null, result: null, reachable: true, wowPatch: 10 });
  assert.match(html, /hardcoded/i);
});

test('when the live list could not be read the page says so and shows no state', () => {
  const html = renderEventsBody({
    rows: [{ ...ROW, active: false, live: false }],
    liveError: 'mangosd is not reachable', result: null, reachable: false, wowPatch: 10
  });
  assert.match(html, /mangosd is not reachable/);
  assert.match(html, /unknown/i);
});

test('a null row set renders an explanation, not a crash', () => {
  const html = renderEventsBody({ rows: null, liveError: null, result: null, reachable: true, wowPatch: 10 });
  assert.match(html, /not configured/i);
});

test('every button is disabled when mangosd is unreachable', () => {
  const html = render({ reachable: false });
  assert.doesNotMatch(html, /<button type="submit">/);
});

test('the page renders the htmx target element', () => {
  assert.match(render(), /id="result"/);
});
