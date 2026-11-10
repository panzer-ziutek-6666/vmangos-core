import { quoteIdentifier, withMissingReference } from './sql.js';
import { highestBuildClause } from './progressive.js';
import { SPELL_SORT_KEYS } from './spellFilters.js';

const COLUMNS = [
  't1.entry', 't1.name', 't1.nameSubtext', 't1.spellLevel', 't1.school', 't1.spellIconId',
  't1.castingTimeIndex', 't1.durationIndex', 't1.rangeIndex', 't1.recoveryTime', 't1.categoryRecoveryTime',
  't1.effectRadiusIndex1', 't1.effectRadiusIndex2', 't1.effectRadiusIndex3'
];

// spell_template is keyed (entry, build): rows and count both take the
// highest build not above the client build (SpellMgr.cpp:3722). The filter
// conditions come first in WHERE, so their params bind before the build.
export async function listSpells(pool, { schema, filters, clientBuild }) {
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier('spell_template')}`;
  const where = [...filters.conditions, highestBuildClause(schema, 'spell_template', 't1')].join(' AND ');
  const order = `${SPELL_SORT_KEYS[filters.sort]} ${filters.dir}`;
  const offset = (filters.page - 1) * filters.pageSize;
  const [rows] = await pool.query(
    `SELECT ${COLUMNS.join(', ')} FROM ${table} t1 WHERE ${where} ORDER BY ${order}, t1.entry LIMIT ? OFFSET ?`,
    [...filters.params, clientBuild, filters.pageSize, offset]
  );
  const [counted] = await pool.query(`SELECT COUNT(*) AS total FROM ${table} t1 WHERE ${where}`, [...filters.params, clientBuild]);
  return { rows, total: Number(counted[0]?.total ?? 0) };
}

// The skill line teaching each spell on a page: one grouped statement over
// the page's ids (spell_id is unindexed, so never one per row).
export async function fetchSpellSkills(pool, { schema, spellIds, clientBuild }) {
  const ids = [...new Set(spellIds.map(Number).filter(Number.isInteger))];
  if (ids.length === 0) return new Map();
  const sla = `${quoteIdentifier(schema)}.${quoteIdentifier('skill_line_ability')}`;
  const [rows] = await pool.query(
    `SELECT s.spell_id, MIN(s.skill_id) AS skill_id FROM ${sla} s
     WHERE s.spell_id IN (${ids.map(() => '?').join(', ')}) AND ${highestBuildClause(schema, 'skill_line_ability', 's', 'id')}
     GROUP BY s.spell_id`,
    [...ids, clientBuild]
  );
  return new Map(rows.map((r) => [Number(r.spell_id), Number(r.skill_id)]));
}

// Skill line names live only in the reference schema (the world database
// has no skill table). A missing schema gives an empty list, never an error.
export async function listSkillLines(pool, { dbcSchema }) {
  if (!dbcSchema) return [];
  const rows = await withMissingReference(null, async () => (await pool.query(
    `SELECT id, name, category_id FROM ${quoteIdentifier(dbcSchema)}.${quoteIdentifier('skill_line')} ORDER BY name`
  ))[0]);
  return (rows ?? []).map((r) => ({ id: Number(r.id), name: r.name ?? '', category: Number(r.category_id) }));
}

export async function fetchSkillNames(pool, { dbcSchema, ids }) {
  const unique = [...new Set(ids.map(Number).filter(Number.isInteger))];
  if (!dbcSchema || unique.length === 0) return new Map();
  const rows = await withMissingReference(null, async () => (await pool.query(
    `SELECT id, name FROM ${quoteIdentifier(dbcSchema)}.${quoteIdentifier('skill_line')} WHERE id IN (${unique.map(() => '?').join(', ')})`,
    unique
  ))[0]);
  return new Map((rows ?? []).map((r) => [Number(r.id), r.name ?? '']));
}
