import test from 'node:test';
import assert from 'node:assert/strict';
import { listSpells, fetchSpellSkills, listSkillLines, fetchSkillNames } from '../server/queries/db/spells.js';
import { parseSpellFilters } from '../server/queries/db/spellFilters.js';

function scriptedPool(script) {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); const r = script[calls.length - 1]; if (r instanceof Error) throw r; return [r ?? []]; } };
}
const OPTS = { schema: 'mangos', clientBuild: 5875 };

test('rows and count both carry the build clause; filter params bind first', async () => {
  const pool = scriptedPool([[{ entry: 133, name: 'Fireball' }], [{ total: 1 }]]);
  const { total } = await listSpells(pool, { schema: 'mangos', filters: parseSpellFilters({ page: '2' }, OPTS), clientBuild: 5875 });
  assert.equal(total, 1);
  assert.equal(pool.calls.length, 2);
  for (const c of pool.calls) assert.match(c.sql, /t1\.build = \(SELECT MAX\(t2\.build\) FROM `mangos`\.`spell_template`/);
  assert.deepEqual(pool.calls[0].params, [5875, 5875, 50, 50]);
  assert.deepEqual(pool.calls[1].params, [5875, 5875]);
  assert.match(pool.calls[0].sql, /ORDER BY t1\.name asc, t1\.entry LIMIT \? OFFSET \?/);
});

test("a page's skills are one grouped statement over the page's spell ids", async () => {
  const pool = scriptedPool([[{ spell_id: 133, skill_id: 8 }]]);
  const map = await fetchSpellSkills(pool, { schema: 'mangos', spellIds: [133, 116], clientBuild: 5875 });
  assert.equal(map.get(133), 8);
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /GROUP BY s\.spell_id/);
  assert.deepEqual(pool.calls[0].params, [133, 116, 5875]);
  assert.equal((await fetchSpellSkills(scriptedPool([]), { schema: 'mangos', spellIds: [], clientBuild: 5875 })).size, 0);
});

test('skill lines and names come from the reference schema, and fall back to nothing', async () => {
  const lines = await listSkillLines(scriptedPool([[{ id: 8, name: 'Fire', category_id: 7 }]]), { dbcSchema: 'dbc' });
  assert.deepEqual(lines, [{ id: 8, name: 'Fire', category: 7 }]);
  const missing = Object.assign(new Error('no'), { code: 'ER_NO_SUCH_TABLE' });
  assert.deepEqual(await listSkillLines(scriptedPool([missing]), { dbcSchema: 'dbc' }), []);
  assert.deepEqual(await listSkillLines(scriptedPool([]), { dbcSchema: null }), []);
  const names = await fetchSkillNames(scriptedPool([[{ id: 8, name: 'Fire' }]]), { dbcSchema: 'dbc', ids: [8, 8] });
  assert.equal(names.get(8), 'Fire');
});
