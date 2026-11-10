import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSpellListBody, renderSpellListFragment } from '../server/views/db/spellList.js';
import { parseSpellFilters } from '../server/queries/db/spellFilters.js';

const ROW = { entry: 133, name: 'Fireball', nameSubtext: 'Rank 1', spellLevel: 1, school: 2, spellIconId: 185, castingTimeIndex: 16, recoveryTime: 0, categoryRecoveryTime: 0 };
const LABELS = { castMs: new Map([[133, 1500]]), durationMs: new Map(), range: new Map(), radius: new Map(), iconName: new Map([[133, 'Spell_Fire_FlameBolt']]) };
const BASE = {
  rows: [ROW], total: 1, filters: parseSpellFilters({}, { schema: 'mangos', clientBuild: 5875 }), labels: LABELS,
  skills: new Map([[133, 8]]), skillNames: new Map([[8, 'Fire']]),
  skillLines: [{ id: 8, name: 'Fire', category: 7 }, { id: 164, name: 'Blacksmithing', category: 11 }]
};

test('a row shows icon, linked name with rank, level, school, skill, cast time and cooldown', () => {
  const html = renderSpellListFragment(BASE);
  assert.match(html, /\/db\/art\/icons\/Spell_Fire_FlameBolt\.png/);
  assert.match(html, /href="\/db\/spell\/133"\s+hx-get="\/db\/tooltip\/spell\/133"/);
  for (const text of ['Rank 1', 'Fire', '1.5 sec']) assert.ok(html.includes(text), text);
  assert.match(html, />—</); // no cooldown
});

test('an instant cast reads Instant, and a cooldown reads as a duration', () => {
  const html = renderSpellListFragment({ ...BASE, rows: [{ ...ROW, recoveryTime: 8000 }], labels: { ...LABELS, castMs: new Map([[133, 0]]) } });
  assert.match(html, /Instant/);
  assert.match(html, /8 sec/);
});

test('the page carries the grouped skill select, the every-spell box and the other filters', () => {
  const html = renderSpellListBody(BASE);
  assert.match(html, /<optgroup label="Class skills"><option value="8">Fire<\/option><\/optgroup>/);
  assert.match(html, /<optgroup label="Professions"><option value="164">Blacksmithing<\/option>/);
  for (const name of ['q', 'all', 'class', 'skill', 'school', 'minlevel', 'maxlevel']) assert.match(html, new RegExp(`name="${name}"`), name);
  assert.match(html, /hx-target="#listview"/);
});

test('the fragment carries one listview and no form', () => {
  const html = renderSpellListFragment(BASE);
  assert.equal((html.match(/id="listview"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<form/);
});
