import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTalentTooltip } from '../server/views/db/talentTooltip.js';
import { dbStubPool } from './helpers/dbStubPool.js';
import { dbApp, HEADERS, CONFIG } from './helpers/dbApp.js';

const spell = (entry, name, description) => ({ entry, name, description, durationIndex: 0, rangeIndex: 0, spellIconID: 0, effectRadiusIndex1: 0, effectRadiusIndex2: 0, effectRadiusIndex3: 0 });
const EMPTY = { castMs: new Map(), durationMs: new Map(), range: new Map(), radius: new Map(), iconName: new Map() };

test('the card shows the rank, the current and next rank text, and requirements', () => {
  const html = renderTalentTooltip({
    talent: { id: 26, row: 1, prereq: null, ranks: [11069, 12338] },
    rank: 1,
    current: spell(11069, 'Improved Fireball', 'Reduces the casting time of your Fireball spell by 0.1 sec.'),
    next: spell(12338, 'Improved Fireball', 'Reduces the casting time of your Fireball spell by 0.2 sec.'),
    labels: EMPTY, referenced: new Map(), requiredSpell: null, treeName: 'Fire'
  });
  assert.match(html, /Improved Fireball/);
  assert.match(html, /Rank 1\/2/);
  assert.match(html, /0\.1 sec/);
  assert.match(html, /Next rank:[\s\S]*0\.2 sec/);
  assert.match(html, /Requires 5 points in Fire/);
});

// I-3: talent 761 (Entangling Roots) is a noted requirement, not a gate the
// calculator enforces - a plain link, never entityLink, so the card does not
// nest a second .tooltip-host inside its own (the card is itself appended
// inside a .tooltip-host span).
test('a required spell is a plain link, and a prerequisite uses "point" singular at rank 1', () => {
  const html = renderTalentTooltip({
    talent: { id: 921, row: 2, prereq: { talentId: 761, rank: 0 }, ranks: [8996] },
    rank: 0,
    current: null,
    next: spell(8996, 'Moonfire', 'Deals Arcane damage and additional damage over time.'),
    labels: EMPTY, referenced: new Map(),
    requiredSpell: { id: 339, name: 'Entangling Roots' },
    treeName: 'Balance', prereqName: 'Improved Nature Spells'
  });
  assert.match(html, /Requires 1 point in Improved Nature Spells/);
  assert.doesNotMatch(html, /Requires 1 points in/);
  assert.match(html, /Requires <a href="\/db\/spell\/339">Entangling Roots<\/a>/);
  assert.doesNotMatch(html, /tooltip-host/);
});

// I-3, end to end: fetchTalentRow's own join finds the prerequisite's rank_1
// spell id and the required spell id; both ride the single fetchSpellRows
// call the current/next rank already makes, so the route is still three
// statements (fetchTalentRow, fetchSpellRows, fetchSpellLabels).
test('the route resolves a prerequisite name and a required spell link without a fourth statement', async (t) => {
  const stub = dbStubPool({
    'dbc`.`talent`': [{
      id: 30, tab_id: 81, row: 0, column: 0, rank_1: 11210, rank_2: 0, rank_3: 0, rank_4: 0, rank_5: 0,
      prereq_talent: 26, prereq_rank: 1, required_spell: 339, tab_name: 'Arcane', prereq_rank_1: 11069
    }],
    spell_template: [spell(11210, 'Arcane Focus', 'x'), spell(339, 'Entangling Roots', 'y'), spell(11069, 'Improved Fireball', 'z')]
  });
  const { app } = dbApp({ world: stub.pool, config: { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' } } });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/tooltip/talent/30?rank=0', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Requires 2 points in Improved Fireball/);
  assert.match(res.body, /Requires <a href="\/db\/spell\/339">Entangling Roots<\/a>/);
  assert.ok(stub.calls.length <= 3);
});

test('/db/tooltip/talent/:id issues at most three statements and never a page loader', async (t) => {
  const stub = dbStubPool({
    'dbc`.`talent`': [{ id: 26, tab_id: 41, row: 0, column: 1, rank_1: 11069, rank_2: 12338, rank_3: 0, rank_4: 0, rank_5: 0, prereq_talent: 0, prereq_rank: 0, required_spell: 0, tab_name: 'Fire' }],
    spell_template: [spell(11069, 'Improved Fireball', 'x'), spell(12338, 'Improved Fireball', 'y')]
  });
  const { app, executeCalls } = dbApp({ world: stub.pool, config: { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' } } });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/tooltip/talent/26?rank=1', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<html/);
  assert.ok(stub.calls.length <= 3);
  assert.equal((await app.inject({ method: 'GET', url: '/db/tooltip/talent/x', headers: HEADERS })).statusCode, 400);
  assert.equal(executeCalls(), 0);
});
