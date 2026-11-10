import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { worldSchema } from '../server/queries/db/sql.js';
import { listSpells, listSkillLines } from '../server/queries/db/spells.js';
import { parseSpellFilters } from '../server/queries/db/spellFilters.js';
import { fetchSpellRows, fetchSpellLabels, spellContext } from '../server/dbLookups/spellLabels.js';
import { substituteSpellText, referencedSpellIds } from '../server/dbLookups/spellText.js';
import { SKILL_CATEGORY_ORDER } from '../server/dbLookups/spellTypes.js';
import { referencedContexts } from '../server/views/db/spellTooltip.js';
import { highestBuildClause } from '../server/queries/db/progressive.js';

// Read-only against the real world database: every call below issues nothing
// but SELECTs. The realm is running while these execute, so they assert
// shapes and invariants, never values.
const here = dirname(fileURLToPath(import.meta.url));

async function connectOrSkip(t) {
  let config;
  try {
    config = readConfigFile(join(here, '..', 'config.json'));
  } catch (err) {
    t.skip(`no usable config.json: ${err.message}`);
    return null;
  }
  const pools = createPools(config.mysql);
  try {
    await pools.logon.query('SELECT 1');
  } catch (err) {
    await pools.closeAll().catch(() => {});
    t.skip(`MySQL is not reachable: ${err.message}. Start it with ""Start MySQL.bat"" in the server directory`);
    return null;
  }
  t.after(() => pools.closeAll());
  return {
    pools,
    args: { schema: worldSchema(config), dbcSchema: config.mysql?.dbcSchema ?? null, clientBuild: config.realm?.clientBuild }
  };
}

const opts = (ctx) => ({ schema: ctx.args.schema, clientBuild: ctx.args.clientBuild });

test('the first page of learnable spells is non-empty and within the page size', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  const filters = parseSpellFilters({}, opts(ctx));
  const { rows, total } = await listSpells(ctx.pools.world, { schema: ctx.args.schema, filters, clientBuild: ctx.args.clientBuild });
  assert.ok(total > 0);
  assert.ok(rows.length > 0 && rows.length <= filters.pageSize);
});

test('no spell repeats on a page, which is what the build clause is for', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  for (const q of [{}, { all: '1' }]) {
    const { rows } = await listSpells(ctx.pools.world, { schema: ctx.args.schema, filters: parseSpellFilters(q, opts(ctx)), clientBuild: ctx.args.clientBuild });
    const ids = rows.map((r) => Number(r.entry));
    assert.equal(new Set(ids).size, ids.length, JSON.stringify(q));
  }
});

test('a filter never raises the count', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  const count = async (q) => (await listSpells(ctx.pools.world, { schema: ctx.args.schema, filters: parseSpellFilters(q, opts(ctx)), clientBuild: ctx.args.clientBuild })).total;
  const all = await count({ all: '1' });
  const learnable = await count({});
  assert.ok(learnable <= all);
  for (const q of [{ class: '8' }, { skill: '8' }, { school: '2' }]) assert.ok(await count(q) <= learnable, JSON.stringify(q));
});

test('every skill line has a name and a category the select knows', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  if (!ctx.args.dbcSchema) return t.skip('no reference schema configured');
  const lines = await listSkillLines(ctx.pools.world, { dbcSchema: ctx.args.dbcSchema });
  assert.ok(lines.length > 0);
  const unknown = lines.filter((l) => !l.name || !SKILL_CATEGORY_ORDER.includes(l.category));
  assert.ok(unknown.length <= 1, `unexpected skill lines: ${JSON.stringify(unknown.slice(0, 5))}`); // the realm has one line with category -1
});

test('no common token is left unsubstituted in a learnable spell description', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  const { schema, dbcSchema, clientBuild } = ctx.args;
  const [rows] = await ctx.pools.world.query(
    `SELECT t1.* FROM \`${schema}\`.spell_template t1
     WHERE t1.description LIKE '%$%' AND t1.entry IN (SELECT s.spell_id FROM \`${schema}\`.skill_line_ability s WHERE ${highestBuildClause(schema, 'skill_line_ability', 's', 'id')})
       AND ${highestBuildClause(schema, 'spell_template', 't1')}`,
    [clientBuild, clientBuild]
  );
  const refRows = await fetchSpellRows(ctx.pools.world, { schema, ids: rows.flatMap((r) => referencedSpellIds(r.description)), clientBuild });
  const labels = await fetchSpellLabels(ctx.pools.world, { dbcSchema, spells: [...rows, ...refRows.values()] });
  const referenced = referencedContexts(refRows, labels);
  // $S, $M and $D resolve the same as $s, $m and $d (uppercase M is the max
  // of the effect's range, not the min); no other uppercase letter resolves.
  const COMMON = /\$(?:[/*]\d+;)?\d*[smotdahnuxqrSMD]\d?/;
  const offenders = rows.filter((r) => COMMON.test(substituteSpellText(r.description, spellContext(r, labels, referenced))));
  assert.equal(offenders.length, 0, `${offenders.length} of ${rows.length} still carry a common token, e.g. ${offenders.slice(0, 5).map((r) => r.entry).join(', ')}`);
});
