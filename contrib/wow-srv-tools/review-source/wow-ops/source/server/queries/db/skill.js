import { quoteIdentifier, withMissingReference } from './sql.js';
import { highestBuildClause } from './progressive.js';
import { fetchNames } from '../../dbLookups/names.js';

// skill_line lives only in the reference schema (spells.js's listSkillLines) -
// the world database has no skill_line table at all, so a missing dbcSchema,
// or a missing/half-imported reference schema (ER_NO_SUCH_TABLE /
// ER_BAD_DB_ERROR, withMissingReference), both mean "no such skill".
async function fetchSkillLineRow(pool, dbcSchema, id) {
  if (!dbcSchema) return null;
  const table = `${quoteIdentifier(dbcSchema)}.${quoteIdentifier('skill_line')}`;
  const rows = await withMissingReference(null, async () => (await pool.query(
    `SELECT id, name, category_id, description FROM ${table} WHERE id = ?`,
    [id]
  ))[0]);
  return rows?.[0] ?? null;
}

// skill_line_ability is keyed (id, build), not (skill_id, build) - the build
// clause binds on the row's own `id`, exactly as spell.js's fetchSkillLines
// reads the reverse direction (spell -> skill). One statement for the whole
// page: skill_line_ability.spell_id is not indexed, so a page scans the
// table once rather than per row.
//
// req_skill_value is not "the skill level this recipe needs" - it is the
// level at which the ability is auto-learned (and, symmetrically, the level
// below which it is taken away): `if (currVal < pAbility->req_skill_value)
// RemoveSpell(...)` (vmangos-core/src/game/Objects/Player.cpp:5941). The
// skill-up thresholds a player actually trains against are min_value and
// max_value: the core computes the chance to gain skill from exactly those
// two plus their midpoint - `SkillGainChance(skillValue, max_value, (max_value
// + min_value) / 2, min_value)` (vmangos-core/src/game/Objects/Player.cpp:5419-5421) -
// so an ability is yellow (gainable) from min_value and grey (no longer
// gainable) at max_value, independent of req_skill_value entirely.
// The seven skill_line_ability columns every reader of the table needs,
// besides whichever of spell_id/skill_id is that reader's own key - shared
// by this file's fetchAbilities (skill -> spells it teaches) and
// server/queries/db/spell.js's fetchSkillLines (spell -> skill lines that
// teach it), the same row read from the two opposite directions. Finding 3
// had to be fixed twice for exactly this reason before this was one place.
export function abilityFromRow(r) {
  return {
    reqSkillValue: Number(r.req_skill_value),
    minValue: Number(r.min_value),
    maxValue: Number(r.max_value),
    learnOnGetSkill: Number(r.learn_on_get_skill) !== 0,
    classMask: Number(r.class_mask),
    raceMask: Number(r.race_mask),
    supersededBy: Number(r.superseded_by_spell)
  };
}

async function fetchAbilities(pool, schema, skillId, clientBuild) {
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier('skill_line_ability')}`;
  const [rows] = await pool.query(
    `SELECT s.spell_id, s.req_skill_value, s.min_value, s.max_value, s.learn_on_get_skill, s.class_mask, s.race_mask, s.superseded_by_spell FROM ${table} s
     WHERE s.skill_id = ? AND ${highestBuildClause(schema, 'skill_line_ability', 's', 'id')}
     ORDER BY s.min_value, s.spell_id`,
    [skillId, clientBuild]
  );
  return rows.map((r) => ({ spellId: Number(r.spell_id), ...abilityFromRow(r) }));
}

// Everything the skill page needs: the skill_line row from the reference
// schema, this build's abilities it teaches, and the names of every spell
// involved (taught, and whatever each is superseded by). Returns null when
// there is no dbcSchema, or no row - the route 404s exactly as loadSpell does
// for a missing spell_template row.
export async function loadSkill(pool, { schema, dbcSchema, id, clientBuild }) {
  const skillLine = await fetchSkillLineRow(pool, dbcSchema, id);
  if (!skillLine) return null;

  const abilities = await fetchAbilities(pool, schema, id, clientBuild);
  const spellIds = [...new Set(abilities.flatMap((a) => [a.spellId, a.supersededBy]).filter((n) => n > 0))];
  const spellNames = await fetchNames(pool, { schema, kind: 'spell', ids: spellIds, clientBuild });

  return {
    id: Number(skillLine.id),
    name: skillLine.name ?? '',
    category: Number(skillLine.category_id),
    description: skillLine.description ?? '',
    abilities,
    spellNames
  };
}
