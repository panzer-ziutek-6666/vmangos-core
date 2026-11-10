import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTalentIndex, renderTalentCalculator } from '../server/views/db/talents.js';
import { parseBuild } from '../server/dbLookups/talentRules.js';
import { dbStubPool } from './helpers/dbStubPool.js';
import { dbApp, HEADERS, CONFIG } from './helpers/dbApp.js';

const T = (id, row, column, n, prereq = null) => ({ id, row, column, ranks: Array.from({ length: n }, (_, i) => id * 10 + i + 1), prereq, requiredSpell: 0, name: `Talent ${id}`, icon: null });
const DATA = {
  classId: 8, name: 'Mage', slug: 'mage',
  trees: [
    { id: 81, name: 'Arcane', icon: null, background: 'MageArcane', talents: [T(1, 0, 0, 5), T(2, 0, 1, 3), T(3, 1, 0, 1, { talentId: 1, rank: 4 })] },
    { id: 41, name: 'Fire', icon: null, background: 'MageFire', talents: [T(4, 0, 1, 2)] },
    { id: 61, name: 'Frost', icon: null, background: 'MageFrost', talents: [T(5, 0, 0, 5)] }
  ]
};

function render(build, extra = {}) {
  const trees = DATA.trees;
  return renderTalentCalculator({ data: DATA, state: parseBuild(build, trees, 51), total: 51, artAvailable: true, marked: null, ...extra });
}

test('the index links every class to its calculator', () => {
  const html = renderTalentIndex([{ id: 8, name: 'Mage', slug: 'mage' }]);
  assert.match(html, /href="\/db\/talents\/mage">Mage<\/a>/);
  assert.match(renderTalentIndex(null), /npm run import-dbc/);
});

test('an addable talent links to the next build through htmx, pushing the URL', () => {
  const html = render('5');
  assert.match(html, /<div id="talent-calc">/);
  assert.match(html, /href="\/db\/talents\/mage\?build=51" hx-get="\/db\/talents\/mage\?build=51" hx-target="#talent-calc" hx-swap="outerHTML" hx-push-url="true"/);
  assert.match(html, /href="\/db\/talents\/mage\?build=501"/);
});

test('a removable talent carries the lower build on contextmenu; a maxed or locked one carries no add link', () => {
  const html = render('531');
  assert.match(html, /class="talent-hit" hx-get="\/db\/talents\/mage\?build=53" hx-trigger="contextmenu"/);
  assert.doesNotMatch(html, /build=6/);
  assert.match(html, /hx-on:contextmenu="event.preventDefault\(\)"/);
  const locked = render('');
  assert.doesNotMatch(locked, /build=001/);
});

test('the header shows points per tree, points left, required level and a reset link', () => {
  const html = render('53-1');
  assert.match(html, /Arcane <span class="detail">8<\/span>/);
  assert.match(html, /9 points spent, 42 left/);
  assert.match(html, /Requires level 18/);
  assert.match(html, /href="\/db\/talents\/mage"[^>]*>Reset<\/a>/);
});

test('the header uses "point" singular for exactly one point spent', () => {
  const html = render('1');
  assert.match(html, /1 point spent, 50 left/);
  assert.doesNotMatch(html, /1 points spent/);
});

test('tree art is drawn from the extracted backgrounds, and omitted without art', () => {
  assert.match(render(''), /src="\/db\/art\/talents\/magearcane\/TopLeft\.png"/);
  assert.doesNotMatch(render('', { artAvailable: false }), /\/db\/art\/talents/);
});

// Task 6 Minor: no test pinned the tooltip-host attributes themselves - only
// their absence of interference with the add/remove attrs (the tests above).
// hx-trigger="mouseenter once" fetches the card at most once per hover;
// hx-target="this" and hx-swap="beforeend" append it inside the same span
// the tooltip-host class marks as its own positioning context, never a
// sibling's.
test('every talent is a tooltip host: mouseenter-once fetches its card into itself', () => {
  const html = render('531');
  assert.match(html, /class="[^"]*\btooltip-host\b[^"]*"[^>]* hx-get="\/db\/tooltip\/talent\/1\?rank=5" hx-trigger="mouseenter once" hx-target="this" hx-swap="beforeend"/);
  assert.match(html, / hx-get="\/db\/tooltip\/talent\/3\?rank=1" hx-trigger="mouseenter once" hx-target="this" hx-swap="beforeend"/);
});

test('a prerequisite draws an arrow, and a marked talent is outlined', () => {
  const html = render('', { marked: 3 });
  assert.match(html, /class="talent-arrow/);
  assert.match(html, /class="talent[^"]* marked"/);
});

test('routes: index, class page, fragment for htmx, whole page on history restore, 404 for an unknown class', async (t) => {
  const config = { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' }, realm: { ...CONFIG.realm, talentRate: 1 } };
  const pool = dbStubPool({
    talent_tab: [{ class_id: 8, class_name: 'Mage', id: 81, name: 'Arcane', background: 'MageArcane', icon_path: null, tab_page: 0, dbc_row: 0 }],
    'dbc`.`talent`': [{ id: 1, tab_id: 81, row: 0, column: 0, rank_1: 11, rank_2: 12, rank_3: 0, rank_4: 0, rank_5: 0, prereq_talent: 0, prereq_rank: 0, required_spell: 0 }],
    chr_classes: [{ id: 8, name: 'Mage' }]
  }).pool;
  const { app, executeCalls } = dbApp({ world: pool, config });
  t.after(() => app.close());
  const index = await app.inject({ method: 'GET', url: '/db/talents', headers: HEADERS });
  assert.match(index.body, /class="nav-item active" href="\/db\/talents"/);
  const page = await app.inject({ method: 'GET', url: '/db/talents/mage?build=1', headers: HEADERS });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /<html/);
  const fragment = await app.inject({ method: 'GET', url: '/db/talents/mage?build=2', headers: { ...HEADERS, 'hx-request': 'true' } });
  assert.doesNotMatch(fragment.body, /<html/);
  assert.match(fragment.body, /^<div id="talent-calc">/);
  const restore = await app.inject({ method: 'GET', url: '/db/talents/mage', headers: { ...HEADERS, 'hx-request': 'true', 'hx-history-restore-request': 'true' } });
  assert.match(restore.body, /<html/);
  assert.equal((await app.inject({ method: 'GET', url: '/db/talents/bard', headers: HEADERS })).statusCode, 404);
  assert.equal(executeCalls(), 0);
});

// I-2: no reference schema at all (ER_BAD_DB_ERROR - the dbc schema was
// never built) gave the class page a generic 404, "No talent trees for
// mage", indistinguishable from a genuinely unknown class. Both
// /db/talents and /db/talents/:class must instead say to run
// npm run import-dbc, at 200.
test('the index and a class page render the import-dbc note, not a 404, when the reference schema is missing entirely', async (t) => {
  const config = { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' } };
  const pool = { query: async () => { const e = new Error('unknown database'); e.code = 'ER_BAD_DB_ERROR'; throw e; } };
  const { app, executeCalls } = dbApp({ world: pool, config });
  t.after(() => app.close());
  const index = await app.inject({ method: 'GET', url: '/db/talents', headers: HEADERS });
  assert.equal(index.statusCode, 200);
  assert.match(index.body, /npm run import-dbc/);
  const page = await app.inject({ method: 'GET', url: '/db/talents/mage', headers: HEADERS });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /npm run import-dbc/);
  assert.equal(executeCalls(), 0);
});

// I-1/I-2: a reference schema imported before 20c420a has talent_tab without
// name/background/dbc_row - the read fails with ER_BAD_FIELD_ERROR, not
// ER_NO_SUCH_TABLE/ER_BAD_DB_ERROR (sql.js's withMissingReference does not
// catch that code by itself). Before the fix this escaped as a raw 500; the
// fix renders the same import-dbc note as a missing schema, not a 500.
test('a class page renders the import-dbc note, not a 500, against an old reference schema missing talent_tab columns', async (t) => {
  const config = { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' } };
  const pool = { query: async () => { const e = new Error("Unknown column 't.name' in 'field list'"); e.code = 'ER_BAD_FIELD_ERROR'; throw e; } };
  const { app } = dbApp({ world: pool, config });
  t.after(() => app.close());
  const page = await app.inject({ method: 'GET', url: '/db/talents/mage', headers: HEADERS });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /npm run import-dbc/);
});

// The hover card gets the same note (never a bare 404) when either case
// reaches it directly.
test('the talent hover card renders the import-dbc note when the reference schema fails to read', async (t) => {
  const config = { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' } };
  const pool = { query: async () => { const e = new Error("Unknown column 'b.name' in 'field list'"); e.code = 'ER_BAD_FIELD_ERROR'; throw e; } };
  const { app } = dbApp({ world: pool, config });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/tooltip/talent/26', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /npm run import-dbc/);
});
