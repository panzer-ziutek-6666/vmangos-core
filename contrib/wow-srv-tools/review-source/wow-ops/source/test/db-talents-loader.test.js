import test from 'node:test';
import assert from 'node:assert/strict';
import { classSlug, listTalentClasses, loadTalentClass } from '../server/queries/db/talents.js';
import { dbStubPool } from './helpers/dbStubPool.js';

const ARGS = { schema: 'mangos', dbcSchema: 'dbc', clientBuild: 5875 };

function stub() {
  return dbStubPool({
    talent_tab: [
      { class_id: 8, class_name: 'Mage', id: 41, name: 'Fire', background: 'MageFire', icon_path: 'Interface\\Icons\\Spell_Fire_FireBolt02', tab_page: 0, dbc_row: 3 },
      { class_id: 8, class_name: 'Mage', id: 81, name: 'Arcane', background: 'MageArcane', icon_path: 'Interface\\Icons\\Spell_Holy_MagicalSentry', tab_page: 0, dbc_row: 1 },
      { class_id: 8, class_name: 'Mage', id: 61, name: 'Frost', background: 'MageFrost', icon_path: null, tab_page: 2, dbc_row: 2 }
    ],
    'dbc`.`talent`': [
      { id: 27, tab_id: 41, row: 1, column: 2, rank_1: 11078, rank_2: 11080, rank_3: 12342, rank_4: 0, rank_5: 0, prereq_talent: 0, prereq_rank: 0, required_spell: 0 },
      { id: 26, tab_id: 41, row: 0, column: 1, rank_1: 11069, rank_2: 12338, rank_3: 0, rank_4: 0, rank_5: 0, prereq_talent: 0, prereq_rank: 0, required_spell: 0 },
      { id: 30, tab_id: 81, row: 0, column: 0, rank_1: 11210, rank_2: 0, rank_3: 0, rank_4: 0, rank_5: 0, prereq_talent: 26, prereq_rank: 1, required_spell: 0 }
    ],
    chr_classes: [{ id: 8, name: 'Mage' }, { id: 1, name: 'Warrior' }],
    spell_template: [{ entry: 11069, name: 'Improved Fireball', spellIconId: 185 }]
  });
}

test('classSlug lower-cases the class name', () => {
  assert.equal(classSlug('Mage'), 'mage');
});

test('listTalentClasses reads chr_classes, null when the reference schema is missing', async () => {
  assert.deepEqual(await listTalentClasses(stub().pool, ARGS), [{ id: 8, name: 'Mage', slug: 'mage' }, { id: 1, name: 'Warrior', slug: 'warrior' }]);
  const missing = { query: async () => { const e = new Error('x'); e.code = 'ER_BAD_DB_ERROR'; throw e; } };
  assert.equal(await listTalentClasses(missing, ARGS), null);
});

// Mage Arcane (81) and Fire (41) both carry order index 0 in the client's own
// TalentTab.dbc; the client lists Arcane - the earlier file row - first.
test('loadTalentClass orders trees by order index then file row, talents by row and column, in four statements', async () => {
  const s = stub();
  const data = await loadTalentClass(s.pool, { ...ARGS, slug: 'mage' });
  assert.deepEqual(data.trees.map((t) => t.name), ['Arcane', 'Fire', 'Frost']);
  assert.deepEqual(data.trees[1].talents.map((t) => t.id), [26, 27]);
  assert.deepEqual(data.trees[1].talents[1].ranks, [11078, 11080, 12342]);
  assert.deepEqual(data.trees[0].talents[0].prereq, { talentId: 26, rank: 1 });
  assert.equal(data.trees[1].talents[0].name, 'Improved Fireball');
  assert.equal(s.calls.length, 4);
});

test('an unknown class slug is null', async () => {
  assert.equal(await loadTalentClass(stub().pool, { ...ARGS, slug: 'bard' }), null);
});

// A reference-schema import that ran only partway: talent_tab is there
// (loadTalentClass gets past the first statement) but talent itself is
// missing or was dropped, the same ER_NO_SUCH_TABLE withMissingReference
// guards everywhere else in this file. I-2: this is "the reference read
// failed", not "no class has this slug" - undefined, not null, so the route
// can render the import-dbc note at 200 rather than a 404.
test('loadTalentClass is undefined when the talents table is missing, not a partial import failing loud', async () => {
  const pool = {
    query: async (sql) => {
      if (sql.includes('talent_tab')) {
        return [[
          { class_id: 8, class_name: 'Mage', id: 41, name: 'Fire', background: 'MageFire', icon_path: null, tab_page: 0, dbc_row: 3 }
        ]];
      }
      const e = new Error('no such table');
      e.code = 'ER_NO_SUCH_TABLE';
      throw e;
    }
  };
  assert.equal(await loadTalentClass(pool, { ...ARGS, slug: 'mage' }), undefined);
});

// I-1: a reference schema imported before this cycle's talent_tab columns
// (name/background/dbc_row, added in 20c420a) fails the tabs read with
// ER_BAD_FIELD_ERROR, not ER_NO_SUCH_TABLE - withOutdatedReference catches it
// the same narrow way withMissingReference catches a missing table, also
// undefined.
test('loadTalentClass is undefined against an old reference schema missing talent_tab columns', async () => {
  const pool = {
    query: async () => {
      const e = new Error("Unknown column 't.name' in 'field list'");
      e.code = 'ER_BAD_FIELD_ERROR';
      throw e;
    }
  };
  assert.equal(await loadTalentClass(pool, { ...ARGS, slug: 'mage' }), undefined);
});
