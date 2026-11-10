import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGameObjectListBody, renderGameObjectListFragment } from '../server/views/db/gameobjectList.js';
import { parseGameObjectFilters } from '../server/queries/db/gameobjectFilters.js';

const ROWS = [{ entry: 1731, name: 'Sunken Chest', type: 3, lock_id: 11, loot_id: 4700, quest_id: 0, spawn_count: 2, map_id: 0 }];
const MAPS = new Map([[0, 'Eastern Kingdoms']]);
const BASE = { rows: ROWS, total: 1, filters: parseGameObjectFilters({}), mapNames: MAPS };

test('the page renders the element its own form targets', () => {
  const html = renderGameObjectListBody(BASE);
  assert.match(html, /hx-target="#listview"/);
  assert.match(html, /id="listview"/);
});

test('the form swaps the listview whole, or htmx nests it inside itself', () => {
  assert.match(renderGameObjectListBody(BASE), /hx-swap="outerHTML"/);
});

test('a row names the type, lock id, loot, map and spawn count', () => {
  const html = renderGameObjectListFragment(BASE);
  assert.match(html, /Sunken Chest/);
  assert.match(html, /Chest/);
  assert.match(html, /11/);
  assert.match(html, />yes</);
  assert.match(html, /Eastern Kingdoms/);
  assert.match(html, />2</);
});

test('a gameobject with no spawns says so rather than showing a blank', () => {
  const html = renderGameObjectListFragment({ ...BASE, rows: [{ ...ROWS[0], spawn_count: 0, map_id: null }] });
  assert.match(html, /not spawned|no spawns/i);
});

test('an unlocked, lootless, questless gameobject shows the dash and no, not a blank cell', () => {
  const html = renderGameObjectListFragment({ ...BASE, rows: [{ ...ROWS[0], lock_id: 0, loot_id: 0, quest_id: 0 }] });
  assert.match(html, />—</);
  assert.match(html, />no</);
});

// A goober's quest id of -1 is a marker, not a quest (ObjectMgr.cpp:9818).
test('only a positive quest id reads as needing a quest', () => {
  const cells = (quest_id) => renderGameObjectListFragment({ ...BASE, rows: [{ ...ROWS[0], loot_id: 0, quest_id }] });
  assert.match(cells(176), />yes</);
  assert.doesNotMatch(cells(-1), />yes</);
});

test('every row links to the gameobject page and asks for its tooltip once', () => {
  const html = renderGameObjectListFragment(BASE);
  assert.match(html, /href="\/db\/gameobject\/1731"/);
  assert.match(html, /hx-get="\/db\/tooltip\/gameobject\/1731"/);
  assert.match(html, /hx-trigger="mouseenter once"/);
});

test('the fragment carries exactly one listview element', () => {
  const matches = renderGameObjectListFragment(BASE).match(/id="listview"/g) ?? [];
  assert.equal(matches.length, 1);
});
