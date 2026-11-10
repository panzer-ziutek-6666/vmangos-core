import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCreatureListBody, renderCreatureListFragment } from '../server/views/db/creatureList.js';
import { parseCreatureFilters } from '../server/queries/db/creatureFilters.js';

const ROWS = [{ entry: 448, name: 'Hogger', subname: null, level_min: 9, level_max: 10, rank: 1, type: 7, faction: 14, faction_name: 'Gnoll - Riverpaw', spawn_count: 5, map_id: 0 }];
const MAPS = new Map([[0, 'Eastern Kingdoms']]);
const BASE = { rows: ROWS, total: 1, filters: parseCreatureFilters({}), mapNames: MAPS };

test('the page renders the element its own form targets', () => {
  const html = renderCreatureListBody(BASE);
  assert.match(html, /hx-target="#listview"/);
  assert.match(html, /id="listview"/);
});

test('the form swaps the listview whole, or htmx nests it inside itself', () => {
  assert.match(renderCreatureListBody(BASE), /hx-swap="outerHTML"/);
});

test('a row names the level range, rank, type, faction, map and spawn count', () => {
  const html = renderCreatureListFragment(BASE);
  assert.match(html, /9\s*-\s*10/);
  assert.match(html, /Elite/);
  assert.match(html, /Humanoid/);
  assert.match(html, /Riverpaw/);
  assert.match(html, /Eastern Kingdoms/);
  assert.match(html, /5/);
});

test('a creature with no spawns says so rather than showing a blank', () => {
  const html = renderCreatureListFragment({ ...BASE, rows: [{ ...ROWS[0], spawn_count: 0, map_id: null }] });
  assert.match(html, /not spawned|no spawns/i);
});

test('a single-level creature reads as one number, not a range', () => {
  const html = renderCreatureListFragment({ ...BASE, rows: [{ ...ROWS[0], level_min: 60, level_max: 60 }] });
  assert.match(html, /\b60\b/);
  assert.doesNotMatch(html, /60\s*-\s*60/);
});

test('every row links to the creature page and asks for its tooltip once', () => {
  const html = renderCreatureListFragment(BASE);
  assert.match(html, /href="\/db\/creature\/448"/);
  assert.match(html, /hx-get="\/db\/tooltip\/creature\/448"/);
  assert.match(html, /hx-trigger="mouseenter once"/);
});

test('the fragment carries exactly one listview element', () => {
  const matches = renderCreatureListFragment(BASE).match(/id="listview"/g) ?? [];
  assert.equal(matches.length, 1);
});
