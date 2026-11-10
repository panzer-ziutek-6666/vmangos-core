import test from 'node:test';
import assert from 'node:assert/strict';
import { listItemSets, loadItemSet } from '../server/queries/db/itemSets.js';
import { renderItemSetPage, renderItemSetListBody } from '../server/views/db/itemSet.js';
import { dbApp, CONFIG, HEADERS } from './helpers/dbApp.js';
import { dbStubPool } from './helpers/dbStubPool.js';

function scriptedPool(script) {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return [script[calls.length - 1] ?? []]; } };
}

const SET = { id: 181, name: 'Might', required_skill_id: 0, required_skill_value: 0, spell_id_1: 9346, items_to_trigger_spell_1: 3 };
const MEMBER = { entry: 16866, name: 'Helm of Might', quality: 3, inventory_icon: 'INV_Helmet_21', set_id: 181 };

test('sets are read from the reference schema, which is where they live', async () => {
  const pool = scriptedPool([[SET], [{ total: 1 }]]);
  await listItemSets(pool, { dbcSchema: 'dbc' });
  assert.match(pool.calls[0].sql, /`dbc`\.`item_set`/);
});

// The world database has no item_set table: membership is a column on the
// item, which is the only place it exists.
test('membership is read from item_template.set_id, under the patch clause', async () => {
  const pool = scriptedPool([[SET], [MEMBER]]);
  await loadItemSet(pool, { schema: 'mangos', dbcSchema: 'dbc', id: 181, wowPatch: 10 });
  const memberCall = pool.calls.find((c) => c.sql.includes('item_template'));
  assert.match(memberCall.sql, /t1\.set_id = \?/);
  assert.match(memberCall.sql, /t1\.patch = \(SELECT MAX\(t2\.patch\)/);
});

test('an unknown set id loads as null rather than an empty page', async () => {
  const pool = scriptedPool([[]]);
  assert.equal(await loadItemSet(pool, { schema: 'mangos', dbcSchema: 'dbc', id: 999, wowPatch: 10 }), null);
});

test('without a reference schema there are no sets to list, and no crash', async () => {
  const pool = scriptedPool([]);
  const result = await listItemSets(pool, { dbcSchema: null });
  assert.deepEqual(result, { rows: [], total: 0 });
  assert.equal(pool.calls.length, 0);
});

// The set list showed "skill #165" - meaningless to an operator - while
// dbc.skill_line has the name and loadItemSet already reads it for the
// detail page (walk finding 2, 2026-09-22). listItemSets now looks the name
// up too, and carries it on each row as skill_name.
test('the list looks up each required skill\'s name from skill_line', async () => {
  const SKILLED = { id: 165, name: 'Circle of Blood', required_skill_id: 165, required_skill_value: 300 };
  const pool = scriptedPool([[SKILLED], [{ total: 1 }], [{ id: 165, name: 'Blacksmithing' }]]);
  const result = await listItemSets(pool, { dbcSchema: 'dbc' });
  assert.equal(result.rows[0].skill_name, 'Blacksmithing');
});

// skill_line can be missing or half-imported same as any other reference
// table (6b31d3b) - the set list still renders, just without the name, so
// the view falls back to the id (renderItemSetListBody's COLUMNS below).
test('a missing skill_line table falls back to no name, not a crash', async () => {
  const SKILLED = { id: 165, name: 'Circle of Blood', required_skill_id: 165, required_skill_value: 300 };
  const pool = {
    calls: [],
    query: async (sql) => {
      pool.calls.push(sql);
      if (sql.includes('skill_line')) {
        const err = new Error('no such table');
        err.code = 'ER_NO_SUCH_TABLE';
        throw err;
      }
      if (sql.includes('COUNT')) return [[{ total: 1 }]];
      return [[SKILLED]];
    }
  };
  const result = await listItemSets(pool, { dbcSchema: 'dbc' });
  assert.equal(result.rows[0].skill_name, null);
});

test('a set with no required skill never looks skill_line up at all', async () => {
  const pool = scriptedPool([[SET], [{ total: 1 }]]);
  await listItemSets(pool, { dbcSchema: 'dbc' });
  assert.equal(pool.calls.length, 2);
});

test('the set list shows the skill name, not the id, when the reference schema supplied one', () => {
  const rows = [{ id: 165, name: 'Circle of Blood', required_skill_id: 165, required_skill_value: 300, skill_name: 'Blacksmithing' }];
  const html = renderItemSetListBody({ rows, total: 1 });
  assert.match(html, /Blacksmithing/);
  assert.doesNotMatch(html, /skill #165/);
});

test('the set list falls back to the id when no skill name is known', () => {
  const rows = [{ id: 165, name: 'Circle of Blood', required_skill_id: 165, required_skill_value: 300, skill_name: null }];
  const html = renderItemSetListBody({ rows, total: 1 });
  assert.match(html, /skill #165/);
});

test('the set page lists its members, each linked and with its icon', () => {
  const html = renderItemSetPage({ set: SET, members: [MEMBER], skillName: null });
  assert.match(html, /href="\/db\/item\/16866"/);
  assert.match(html, /INV_Helmet_21\.png/);
  assert.match(html, /Might/);
});

// itemSet.js's member links used to be a plain dbLink: no tooltip at all,
// a second idiom sitting beside itemList.js's tooltip-wired one. Members are
// item links too, so they get the same tooltip-host wiring itemList.js does
// (walk finding 1, 2026-09-22) rather than leaving two idioms in the tree.
test('a set member is a tooltip-wired item link, not a bare dbLink', () => {
  const html = renderItemSetPage({ set: SET, members: [MEMBER], skillName: null });
  const hostMatch = html.match(/<span class="tooltip-host">(<a\b[^>]*>)/);
  assert.ok(hostMatch, 'the member link should be the first thing inside a span.tooltip-host');
  const anchorTag = hostMatch[1];
  assert.match(anchorTag, /hx-get="\/db\/tooltip\/item\/16866"/);
  assert.match(anchorTag, /hx-target="closest \.tooltip-host"/);
  assert.match(anchorTag, /hx-swap="beforeend"/);
});

// With no bonus spell rows (a spell_template read that found nothing), a bonus
// still states its piece count and links the spell by id.
test('a set bonus states the piece count it needs', () => {
  const html = renderItemSetPage({ set: SET, members: [MEMBER], skillName: null });
  assert.match(html, /\(3\) Set:/);
  assert.match(html, /href="\/db\/spell\/9346"/);
});

// The client writes a bonus as "(N) Set: <what the spell does>"; the text is
// the bonus spell's description, substituted as every spell's is
// (server/dbLookups/spellText.js), and it links the spell with its card.
test('a set bonus reads as the client writes it, ordered by pieces, linking the spell', () => {
  const set = { ...SET, spell_id_1: 9346, items_to_trigger_spell_1: 3, spell_id_2: 7597, items_to_trigger_spell_2: 2 };
  const bonusSpells = new Map([
    [9346, { entry: 9346, name: 'Increased Defense', description: 'Increased Defense +$s1.', effectBasePoints1: 9, effectBaseDice1: 1, effectDieSides1: 1 }],
    [7597, { entry: 7597, name: 'Armor', description: 'Improves your armor.', effectBasePoints1: 0, effectBaseDice1: 0, effectDieSides1: 0 }]
  ]);
  const labels = { castMs: new Map(), durationMs: new Map(), range: new Map(), radius: new Map(), iconName: new Map() };
  const html = renderItemSetPage({ set, members: [MEMBER], skillName: null, bonusSpells, labels });
  assert.ok(html.indexOf('(2) Set:') < html.indexOf('(3) Set:'), 'bonuses are ordered by piece count');
  assert.match(html, /\(3\) Set: <span class="tooltip-host"><a href="\/db\/spell\/9346"[^>]*>Increased Defense \+10\.<\/a>/);
  assert.doesNotMatch(html, /\$s1/);
});

test('loadItemSet reads the bonus spells and their labels, build-keyed', async () => {
  const stub = dbStubPool({
    item_set: [SET],
    item_template: [MEMBER],
    spell_template: [{ entry: 9346, name: 'Increased Defense', description: 'x', durationIndex: 0, rangeIndex: 0, spellIconId: 0 }]
  });
  const data = await loadItemSet(stub.pool, { schema: 'mangos', dbcSchema: 'dbc', id: 181, wowPatch: 10, clientBuild: 5875 });
  assert.equal(data.bonusSpells.get(9346).name, 'Increased Defense');
  const spellCall = stub.callsFor('spell_template')[0];
  assert.match(spellCall.sql, /t2\.build <= \?/);
  assert.deepEqual(spellCall.params, [9346, 5875]);
});

// Route harness: see test/helpers/dbApp.js. This section reads from the
// reference schema too, so its config carries dbcSchema.
const ITEM_SETS_CONFIG = { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' } };

function harness(tables) {
  return dbApp({ world: dbStubPool(tables).pool, config: ITEM_SETS_CONFIG }).app;
}

test('GET /db/itemsets renders the whole page', async (t) => {
  const app = harness({ item_set: [SET] });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/itemsets', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<!doctype html>/i);
  assert.match(res.body, /Might/);
});

test('GET /db/itemset/:id for an id that does not exist is a 404 on the browser chrome', async (t) => {
  const app = harness({});
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/itemset/99999999', headers: HEADERS });
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /99999999/);
  assert.match(res.body, /class="db-browser"/);
});
