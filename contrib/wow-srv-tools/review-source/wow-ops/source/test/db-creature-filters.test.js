import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCreatureFilters, CREATURE_SORTS } from '../server/queries/db/creatureFilters.js';

test('an empty query sorts by name, ascending, page 1', () => {
  const f = parseCreatureFilters({});
  assert.deepEqual(f.conditions, []);
  assert.equal(f.sort, 'name');
  assert.equal(f.dir, 'asc');
  assert.equal(f.page, 1);
});

test('a name term is one bound LIKE with its wildcards escaped', () => {
  const f = parseCreatureFilters({ q: '100%_boss' });
  assert.match(f.conditions[0], /t1\.name LIKE \?/);
  assert.deepEqual(f.params, ['%100\\%\\_boss%']);
});

// The faction filter is a name match, not an id: 258 distinct factions is too
// many for a select, and a person looks for "Riverpaw".
test('a faction term matches the faction name, joined not bound to an id', () => {
  const f = parseCreatureFilters({ faction: 'riverpaw' });
  assert.match(f.conditions.join(' '), /faction/i);
  assert.deepEqual(f.params, ['%riverpaw%']);
});

test('rank and type bind their own parameters within the core bounds', () => {
  // CreatureEliteType, vmangos-core/src/game/Objects/CreatureDefines.h:87-94:
  // 0 (normal) through 4 (rare). CreatureType (not CreatureTypeFlags, an
  // unrelated bitmask), same file, lines 40-53: 1 (Beast) through 11
  // (Totem), with 0 as the CreatureInfo struct's unset default (line 253),
  // not a named enum member.
  const f = parseCreatureFilters({ rank: '1', type: '7' });
  assert.equal(f.conditions.length, 2);
  assert.deepEqual(f.params, [1, 7]);
});

test('rank and type keep the core enum edges and drop just past them', () => {
  const kept = parseCreatureFilters({ rank: '4', type: '11' });
  assert.equal(kept.conditions.length, 2);
  assert.deepEqual(kept.params, [4, 11]);

  const dropped = parseCreatureFilters({ rank: '5', type: '12' });
  assert.deepEqual(dropped.conditions, []);
  assert.deepEqual(dropped.params, []);
});

test('a level range binds both bounds and accepts the realm maximum of 70', () => {
  const f = parseCreatureFilters({ minlevel: '60', maxlevel: '70' });
  assert.deepEqual(f.params, [60, 70]);
});

test('an unknown sort key falls back rather than reaching SQL', () => {
  const f = parseCreatureFilters({ sort: 'name); DROP TABLE creature_template; --' });
  assert.equal(f.sort, 'name');
  assert.ok(Object.hasOwn(CREATURE_SORTS, f.sort));
});

test('junk values are dropped and the listview still renders', () => {
  const f = parseCreatureFilters({ rank: 'banana', minlevel: '-2', type: '' });
  assert.deepEqual(f.conditions, []);
  assert.deepEqual(f.params, []);
});
