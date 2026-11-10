import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpellFilters, SPELL_SORT_KEYS } from '../server/queries/db/spellFilters.js';

const LEARNABLE = /^t1\.entry IN \(SELECT s\.spell_id FROM `?mangos`?|^t1\.entry IN \(SELECT s\.spell_id FROM /;

test('by default only spells a skill line teaches are listed', () => {
  const f = parseSpellFilters({}, { schema: 'mangos', clientBuild: 5875 });
  assert.equal(f.conditions.length, 1);
  assert.match(f.conditions[0], LEARNABLE);
  // The highest build per id comes from a derived table joined on (id, build),
  // not a correlated MAX(build) subquery per row: skill_line_ability's
  // primary key is (id, build), but a correlated clause still runs once per
  // outer row of the whole table regardless of that index.
  assert.match(
    f.conditions[0],
    /JOIN \(SELECT id, MAX\(build\) AS build FROM `mangos`\.`skill_line_ability` WHERE build <= \? GROUP BY id\) m ON m\.id = s\.id AND m\.build = s\.build/
  );
  assert.equal(f.applied.all, undefined);
});

test('the learnable condition needs a real client build', () => {
  assert.throws(() => parseSpellFilters({}, { schema: 'mangos' }), /clientBuild/);
  assert.throws(() => parseSpellFilters({}, { schema: 'mangos', clientBuild: NaN }), /clientBuild/);
  assert.doesNotThrow(() => parseSpellFilters({ all: '1' }, { schema: 'mangos' }));
});

test('the "every spell" box drops the learnable condition', () => {
  const f = parseSpellFilters({ all: '1' }, { schema: 'mangos' });
  assert.deepEqual(f.conditions, []);
  assert.equal(f.applied.all, true);
});

test('class and skill narrow the same learnable subquery and imply it', () => {
  const f = parseSpellFilters({ all: '1', class: '8', skill: '6' }, { schema: 'mangos', clientBuild: 5875 });
  assert.equal(f.conditions.length, 1);
  assert.match(f.conditions[0], /\(s\.class_mask = 0 OR s\.class_mask & \? <> 0\)/);
  assert.match(f.conditions[0], /s\.skill_id = \?/);
  assert.equal(f.applied.class, 8);
  assert.equal(f.applied.skill, 6);
});

test('the learnable subquery binds the client build, then the class bit, then the skill', () => {
  const f = parseSpellFilters({ class: '8', skill: '6' }, { schema: 'mangos', clientBuild: 5875 });
  assert.deepEqual(f.params, [5875, 128, 6]);
});

test('class must be a real class; skill a positive id; school 0-6; levels by the column', () => {
  assert.equal(parseSpellFilters({ class: '6' }, { schema: 'mangos', clientBuild: 5875 }).applied.class, undefined);
  assert.equal(parseSpellFilters({ skill: '0' }, { schema: 'mangos', clientBuild: 5875 }).applied.skill, undefined);
  assert.deepEqual(parseSpellFilters({ all: '1', school: '2' }, { schema: 'mangos', clientBuild: 5875 }).params, [2]);
  assert.equal(parseSpellFilters({ all: '1', school: '7' }, { schema: 'mangos', clientBuild: 5875 }).applied.school, undefined);
  const lv = parseSpellFilters({ all: '1', minlevel: '10', maxlevel: '20' }, { schema: 'mangos', clientBuild: 5875 });
  assert.deepEqual(lv.conditions, ['t1.spellLevel >= ?', 't1.spellLevel <= ?']);
});

test('the name is an escaped LIKE and the sort key is allow-listed', () => {
  const f = parseSpellFilters({ all: '1', q: '50%', sort: 'name); DROP TABLE x; --' }, { schema: 'mangos', clientBuild: 5875 });
  assert.deepEqual(f.conditions, ['t1.name LIKE ?']);
  assert.deepEqual(f.params, ['%50\\%%']);
  assert.equal(f.sort, 'name');
  assert.ok(Object.hasOwn(SPELL_SORT_KEYS, f.sort));
});
