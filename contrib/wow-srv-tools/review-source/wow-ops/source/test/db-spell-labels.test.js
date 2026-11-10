import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSpellRows, fetchSpellLabels, spellContext } from '../server/dbLookups/spellLabels.js';

function scriptedPool(script) {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); const r = script[calls.length - 1]; if (r instanceof Error) throw r; return [r ?? []]; } };
}
const FIREBALL = { entry: 133, castingTimeIndex: 16, durationIndex: 35, rangeIndex: 35, spellIconId: 185, effectRadiusIndex1: 0, effectRadiusIndex2: 0, effectRadiusIndex3: 0 };

test('spell rows are read in one build-bounded statement', async () => {
  const pool = scriptedPool([[{ entry: 133, name: 'Fireball' }]]);
  const rows = await fetchSpellRows(pool, { schema: 'mangos', ids: [133, 133], clientBuild: 5875 });
  assert.equal(rows.get(133).name, 'Fireball');
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /t1\.build = \(SELECT MAX\(t2\.build\) FROM `mangos`\.`spell_template` t2/);
  assert.deepEqual(pool.calls[0].params, [133, 5875]);
  assert.equal((await fetchSpellRows(scriptedPool([]), { schema: 'mangos', ids: [], clientBuild: 5875 })).size, 0);
});

test('labels come back from one UNION ALL statement, keyed by spell', async () => {
  const pool = scriptedPool([[
    { kind: 'cast', id: 16, a: 1500, b: null, c: null },
    { kind: 'duration', id: 35, a: 4000, b: null, c: null },
    { kind: 'range', id: 35, a: 0, b: 35, c: 'Medium-Long Range' },
    { kind: 'icon', id: 185, a: null, b: null, c: 'Interface\\Icons\\Spell_Fire_FlameBolt' }
  ]]);
  const labels = await fetchSpellLabels(pool, { dbcSchema: 'dbc', spells: [FIREBALL] });
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /UNION ALL/);
  assert.equal(labels.castMs.get(133), 1500);
  assert.equal(labels.durationMs.get(133), 4000);
  assert.deepEqual(labels.range.get(133), { min: 0, max: 35, name: 'Medium-Long Range' });
  assert.equal(labels.iconName.get(133), 'Spell_Fire_FlameBolt');
});

test('a missing reference schema gives empty labels, not an error', async () => {
  const missing = Object.assign(new Error('no'), { code: 'ER_NO_SUCH_TABLE' });
  const labels = await fetchSpellLabels(scriptedPool([missing]), { dbcSchema: 'dbc', spells: [FIREBALL] });
  assert.equal(labels.castMs.size, 0);
  const none = await fetchSpellLabels(scriptedPool([]), { dbcSchema: null, spells: [FIREBALL] });
  assert.equal(none.iconName.size, 0);
});

test('a batch with no cast-time index still gets duration, range and icon labels', async () => {
  // MySQL names a UNION's columns after its first SELECT. When every spell in
  // the batch has castingTimeIndex 0 the 'cast' branch is skipped entirely,
  // so the first branch actually sent must still carry its own AS kind - or
  // every row comes back without a `kind` property.
  const INSTANT = { entry: 100, castingTimeIndex: 0, durationIndex: 35, rangeIndex: 35, spellIconId: 185, effectRadiusIndex1: 0, effectRadiusIndex2: 0, effectRadiusIndex3: 0 };
  const pool = scriptedPool([[
    { kind: 'duration', id: 35, a: 4000, b: null, c: null },
    { kind: 'range', id: 35, a: 0, b: 35, c: 'Medium-Long Range' },
    { kind: 'icon', id: 185, a: null, b: null, c: 'Interface\\Icons\\Spell_Fire_FlameBolt' }
  ]]);
  const labels = await fetchSpellLabels(pool, { dbcSchema: 'dbc', spells: [INSTANT] });
  const sql = pool.calls[0].sql;
  assert.doesNotMatch(sql, /'cast'/);
  for (const branch of sql.split('UNION ALL')) assert.match(branch, /AS kind/);
  assert.equal(labels.durationMs.get(100), 4000);
  assert.deepEqual(labels.range.get(100), { min: 0, max: 35, name: 'Medium-Long Range' });
  assert.equal(labels.iconName.get(100), 'Spell_Fire_FlameBolt');
});

test('a row with an unexpected kind is ignored, not thrown on', async () => {
  const pool = scriptedPool([[
    { kind: 'bogus', id: 16, a: 1500, b: null, c: null },
    { kind: 'duration', id: 35, a: 4000, b: null, c: null }
  ]]);
  const labels = await fetchSpellLabels(pool, { dbcSchema: 'dbc', spells: [FIREBALL] });
  assert.equal(labels.durationMs.get(133), 4000);
  assert.equal(labels.castMs.size, 0);
});

test('spellContext hands substituteSpellText the durations, ranges and radii', () => {
  const labels = { castMs: new Map(), durationMs: new Map([[133, 4000]]), range: new Map([[133, { min: 0, max: 35, name: '' }]]), radius: new Map([['133:1', 8]]), iconName: new Map() };
  const ctx = spellContext(FIREBALL, labels, new Map());
  assert.equal(ctx.durationMs, 4000);
  assert.equal(ctx.rangeYards, 35);
  assert.deepEqual(ctx.radiusYards, [8, null, null]);
});
