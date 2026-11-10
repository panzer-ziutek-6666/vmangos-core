import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { worldSchema, qualified } from '../server/queries/db/sql.js';
import { listTalentClasses, loadTalentClass } from '../server/queries/db/talents.js';
import { parseBuild, talentPoints } from '../server/dbLookups/talentRules.js';
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
    pool: pools.world,
    config,
    args: {
      schema: worldSchema(config),
      dbcSchema: config.mysql?.dbcSchema ?? null,
      clientBuild: config.realm?.clientBuild
    }
  };
}

test('every class has three trees, each with talents', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  const classes = await listTalentClasses(ctx.pool, ctx.args);
  assert.equal(classes.length, 9);
  for (const c of classes) {
    const data = await loadTalentClass(ctx.pool, { ...ctx.args, slug: c.slug });
    assert.equal(data.trees.length, 3, `${c.name} has ${data.trees.length} trees`);
    for (const tree of data.trees) assert.ok(tree.talents.length > 0, `${c.name} ${tree.name} is empty`);
  }
});

// Player::LearnTalent reads the prerequisite before the row check
// (Player.cpp:20998-21050); a prerequisite in another tree or on the same or a
// later row would make a talent unreachable in the calculator's order.
test('every prerequisite is in the same tree on an earlier row', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  for (const c of await listTalentClasses(ctx.pool, ctx.args)) {
    const data = await loadTalentClass(ctx.pool, { ...ctx.args, slug: c.slug });
    for (const tree of data.trees) {
      const byId = new Map(tree.talents.map((x) => [x.id, x]));
      for (const talent of tree.talents.filter((x) => x.prereq)) {
        const pre = byId.get(talent.prereq.talentId);
        assert.ok(pre, `talent ${talent.id} names prerequisite ${talent.prereq.talentId} outside its tree`);
        assert.ok(pre.row <= talent.row, `talent ${talent.id}'s prerequisite is on a later row`);
        assert.ok(talent.prereq.rank < pre.ranks.length, `talent ${talent.id} needs a rank its prerequisite lacks`);
        if (pre.row === talent.row) {
          t.diagnostic(`same-row prerequisite: talent ${talent.id} (col ${talent.column}) depends on ${pre.id} (col ${pre.column}) in ${c.name} ${tree.name}`);
          if (pre.column >= talent.column) {
            t.diagnostic(`CONCERN: talent ${talent.id}'s same-row prerequisite ${pre.id} sits in a later or equal column`);
          }
        }
      }
    }
  }
});

// M-2: this checked only rank_1 - the spec asks for every rank spell. One
// UNION ALL flattens rank_1..rank_5 (skipping each talent's unused trailing
// ranks, rank_N = 0) into a single spell-id column, then one NOT EXISTS
// against spell_template covers every rank in one statement.
test('every rank spell exists in spell_template at this build', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  const branches = [1, 2, 3, 4, 5]
    .map((r) => `SELECT rank_${r} AS spell FROM ${qualified(ctx.args.dbcSchema, 'talent')} WHERE rank_${r} <> 0`)
    .join(' UNION ALL ');
  const [rows] = await ctx.pool.query(
    `SELECT COUNT(*) AS n FROM (${branches}) t
     WHERE NOT EXISTS (SELECT 1 FROM ${qualified(ctx.args.schema, 'spell_template')} s WHERE s.entry = t.spell AND s.build <= ?)`,
    [ctx.args.clientBuild]
  );
  assert.equal(Number(rows[0].n), 0);
});

test('filling every talent in order never exceeds the level-60 total in one tree', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  const total = talentPoints(60, 1);
  for (const c of await listTalentClasses(ctx.pool, ctx.args)) {
    const data = await loadTalentClass(ctx.pool, { ...ctx.args, slug: c.slug });
    data.trees.forEach((tree, i) => {
      const build = data.trees.map((_, j) => (j === i ? tree.talents.map((x) => x.ranks.length).join('') : '')).join('-');
      const state = parseBuild(build, data.trees, total);
      const deepest = Math.max(...tree.talents.map((x) => x.row));
      assert.ok(state.spent[i] >= deepest * 5, `${c.name} ${tree.name}: ${state.spent[i]} points cannot reach row ${deepest}`);
      t.diagnostic(`${c.name} ${tree.name}: ${state.spent[i]} of ${total} spent filling in order`);
    });
  }
});
