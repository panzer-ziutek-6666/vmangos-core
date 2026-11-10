import { worldSchema, qualified, withMissingReference, withOutdatedReference } from './sql.js';
import { fetchBuildRowOnly, highestBuildClause, highestPatchClause } from './progressive.js';
import { fetchSkillNames } from './spells.js';
import { abilityFromRow } from './skill.js';
import { fetchSpellRows, fetchSpellLabels } from '../../dbLookups/spellLabels.js';
import { referencedSpellIds } from '../../dbLookups/spellText.js';
import { fetchNames, fetchItemNamesWithQuality } from '../../dbLookups/names.js';
import { classSlug } from './talents.js';

const REAGENT_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8];
const EFFECT_SLOTS = [1, 2, 3];
const ITEM_SPELL_SLOTS = [1, 2, 3, 4, 5];

// skill_line_ability.spell_id is not indexed, so a single spell's page scans
// the table once - the same acceptable cost fetchSpellSkills
// (server/queries/db/spells.js) takes per listview page, here for one entry
// instead of a page's worth. Keyed (id, build) like every other
// build-progressive table (highestBuildClause on the alias's own `id`, not
// `spell_id`).
//
// min_value/max_value and learn_on_get_skill are read for the same reason
// server/queries/db/skill.js's fetchAbilities reads them: req_skill_value is
// the auto-learn threshold (vmangos-core/src/game/Objects/Player.cpp:5941),
// not the skill level required to use this spell, and min_value/max_value
// are the actual skill-up range the core trains against
// (Player.cpp:5419-5421). This is the same row skill_line_ability the skill
// page reads for the same spell, from the other direction (spell_id here,
// skill_id there) - server/views/db/fields.js's skillUpLabel/autoLearnLabel
// format both reads identically rather than each page inventing its own.
async function fetchSkillLines(pool, schema, spellEntry, clientBuild) {
  const table = qualified(schema, 'skill_line_ability');
  const [rows] = await pool.query(
    `SELECT s.skill_id, s.req_skill_value, s.min_value, s.max_value, s.learn_on_get_skill, s.class_mask, s.race_mask, s.superseded_by_spell FROM ${table} s
     WHERE s.spell_id = ? AND ${highestBuildClause(schema, 'skill_line_ability', 's', 'id')}`,
    [spellEntry, clientBuild]
  );
  return rows.map((r) => ({ skillId: Number(r.skill_id), ...abilityFromRow(r) }));
}

// A trainer row never names the spell it teaches - it names a "teaching"
// spell whose own first effect is SPELL_EFFECT_LEARN_SPELL (36) and whose
// effectTriggerSpell1 is the spell actually learned. The core rejects any
// trainer row whose spell is not such a learn spell
// (vmangos-core/src/game/ObjectMgr.cpp:10721-10735: "has non-learning spell
// ... possible must be used spell X instead", matching on `Effect[0] ==
// SPELL_EFFECT_LEARN_SPELL && EffectTriggerSpell[0] == spell`), so every
// trainer row a rank of this spell ever appears in carries one of these
// teaching ids in its `spell` column, never this entry itself. One
// build-bounded statement, like every other spell_template read.
async function fetchTeachingSpellIds(pool, schema, taughtEntry, clientBuild) {
  const table = qualified(schema, 'spell_template');
  const [rows] = await pool.query(
    `SELECT t1.entry FROM ${table} t1 WHERE t1.effect1 = 36 AND t1.effectTriggerSpell1 = ? AND ${highestBuildClause(schema, 'spell_template', 't1')}`,
    [taughtEntry, clientBuild]
  );
  return rows.map((r) => Number(r.entry));
}

// npc_trainer (keyed on the creature's own entry) and npc_trainer_template
// (keyed on creature_template.trainer_id) carry no patch column - the core
// filters them on the running client build instead
// (`build_min <= build <= build_max`, ObjectMgr.cpp:10690), exactly as
// server/queries/db/creature.js's fetchTrainerRows already reads them; this
// is the same shape keyed on `spell IN (...)` instead of `entry`, one of the
// teaching ids fetchTeachingSpellIds found rather than this entry itself. No
// teaching ids means no trainer teaches this spell at this build - skipped
// rather than sent as a query with an empty IN ().
async function fetchTrainersTeaching(pool, schema, table, teachingIds, clientBuild) {
  if (teachingIds.length === 0) return [];
  const qualifiedTable = qualified(schema, table);
  const placeholders = teachingIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT entry, spellcost, reqskill, reqskillvalue, reqlevel FROM ${qualifiedTable}
     WHERE spell IN (${placeholders}) AND ? BETWEEN build_min AND build_max`,
    [...teachingIds, clientBuild]
  );
  return rows.map((r) => ({
    entry: Number(r.entry),
    cost: Number(r.spellcost),
    reqSkill: Number(r.reqskill),
    reqSkillValue: Number(r.reqskillvalue),
    reqLevel: Number(r.reqlevel)
  }));
}

// The creature_template rows that point at a trainer template's entry as
// their trainer_id - highestPatchClause-bound, like every other progressive
// template read. Skipped entirely when there is no template trainer to
// resolve (the common case: most trainer spells are taught by a single named
// creature through npc_trainer, not a shared template).
async function fetchCreaturesByTrainerId(pool, schema, trainerIds, wowPatch) {
  const map = new Map();
  if (trainerIds.length === 0) return map;
  const table = qualified(schema, 'creature_template');
  const placeholders = trainerIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT t1.entry, t1.trainer_id FROM ${table} t1
     WHERE t1.trainer_id IN (${placeholders}) AND ${highestPatchClause(schema, 'creature_template', 't1')}`,
    [...trainerIds, wowPatch]
  );
  for (const r of rows) {
    const key = Number(r.trainer_id);
    const list = map.get(key) ?? [];
    list.push(Number(r.entry));
    map.set(key, list);
  }
  return map;
}

// item_template.spellid_1..5/spelltrigger_1..5 are unindexed - one scan per
// page view is acceptable, never a per-row subquery. Each of the five
// columns that matches this entry, or one of teachingIds, expands into its
// own { entry, slot, trigger, teaches } - an item can cast or teach the same
// spell from more than one slot in principle, so every match is kept, not
// just the first.
//
// A recipe/plan/tome item does not name the spell it teaches any more than a
// trainer does: it casts a Learn Spell (effect 36) whose effectTriggerSpell1
// is the spell actually learned - fetchTeachingSpellIds (above) already
// found those ids for the trainer read, so this matches spellid_N against
// this entry or any of them in one IN (...), same statement count as before.
// `teaches` distinguishes a genuine cast (spellid_N = spellEntry) from a
// teach (spellid_N is one of teachingIds) for the view to label.
async function fetchItemsCasting(pool, schema, spellEntry, teachingIds, wowPatch) {
  const table = qualified(schema, 'item_template');
  const ids = [spellEntry, ...teachingIds];
  const placeholders = ids.map(() => '?').join(', ');
  const where = ITEM_SPELL_SLOTS.map((i) => `t1.spellid_${i} IN (${placeholders})`).join(' OR ');
  const selectCols = [
    ...ITEM_SPELL_SLOTS.map((i) => `t1.spellid_${i}`),
    ...ITEM_SPELL_SLOTS.map((i) => `t1.spelltrigger_${i}`)
  ];
  const [rows] = await pool.query(
    `SELECT t1.entry, ${selectCols.join(', ')} FROM ${table} t1
     WHERE (${where}) AND ${highestPatchClause(schema, 'item_template', 't1')}`,
    [...ITEM_SPELL_SLOTS.flatMap(() => ids), wowPatch]
  );
  const items = [];
  for (const r of rows) {
    for (const slot of ITEM_SPELL_SLOTS) {
      const spellid = Number(r[`spellid_${slot}`]);
      if (spellid === spellEntry || teachingIds.includes(spellid)) {
        items.push({ entry: Number(r.entry), slot, trigger: Number(r[`spelltrigger_${slot}`]), teaches: spellid !== spellEntry });
      }
    }
  }
  return items;
}

// A talent rank is a spell (Talent.dbc m_spellRank, DBCStructure.h:666): find
// the talent, its tree and class so the page can link the calculator. Only
// run when a reference schema is configured, and guarded the same way every
// other talents.js read is (withMissingReference) - a partial import leaves
// this null rather than a raw ER_NO_SUCH_TABLE 500. A reference schema
// imported before this cycle's talent_tab columns fails the same read with
// ER_BAD_FIELD_ERROR instead (withOutdatedReference, I-1) - also null, so a
// spell page that worked before an operator updates the panel keeps working,
// just without the talent link, rather than 500ing until they re-import.
// `rank` is the 1-based position of spellEntry among rank_1..rank_5.
async function fetchTalentForSpell(pool, dbcSchema, spellEntry) {
  if (!dbcSchema) return null;
  const rows = await withOutdatedReference(null, () => withMissingReference(null, async () => (await pool.query(
    `SELECT t.id, t.rank_1, t.rank_2, t.rank_3, t.rank_4, t.rank_5, b.name AS tab_name, c.name AS class_name
     FROM ${qualified(dbcSchema, 'talent')} t
     JOIN ${qualified(dbcSchema, 'talent_tab')} b ON b.id = t.tab_id
     JOIN ${qualified(dbcSchema, 'chr_classes')} c ON b.class_mask = 1 << (c.id - 1)
     WHERE ? IN (t.rank_1, t.rank_2, t.rank_3, t.rank_4, t.rank_5)`,
    [spellEntry]
  ))[0]));
  const row = rows?.[0];
  if (!row) return null;
  const ranks = [1, 2, 3, 4, 5].map((n) => Number(row[`rank_${n}`]));
  return { talentId: Number(row.id), rank: ranks.indexOf(spellEntry) + 1, treeName: row.tab_name ?? '', classSlug: classSlug(row.class_name) };
}

// Everything the spell page needs, in one call. Returns null when the world
// pool or schema is not configured, or the entry does not exist at the
// configured client build (fetchBuildRowOnly, highest build not above
// clientBuild - SpellMgr.cpp:3722) - either way the route has nothing to
// render and can 404 instead of guessing.
export async function loadSpell(pools, config, entry) {
  const pool = pools?.world;
  if (!pool) return null;
  const schema = worldSchema(config);
  if (!schema) return null;

  const dbcSchema = config.mysql?.dbcSchema ?? null;
  const clientBuild = config.realm.clientBuild;
  const wowPatch = config.realm.wowPatch;
  const numericEntry = Number(entry);

  const row = await fetchBuildRowOnly(pool, { schema, table: 'spell_template', entry: numericEntry, clientBuild });
  if (!row) return null;

  // Any spell the description or aura text names by id (a "$433s1"-style
  // token) - referencedSpellIds ignores a self-reference (no digits before
  // the letter), so this is empty for the common case.
  const referencedIds = referencedSpellIds(String(row.description ?? '') + String(row.auraDescription ?? ''));
  const referenced = referencedIds.length
    ? await fetchSpellRows(pool, { schema, ids: referencedIds, clientBuild })
    : new Map();

  const labels = await fetchSpellLabels(pool, { dbcSchema, spells: [row, ...referenced.values()] });

  const skillsRaw = await fetchSkillLines(pool, schema, numericEntry, clientBuild);

  const talent = await fetchTalentForSpell(pool, dbcSchema, numericEntry);

  const teachingIds = await fetchTeachingSpellIds(pool, schema, numericEntry, clientBuild);
  const [trainerOwn, trainerTemplate] = await Promise.all([
    fetchTrainersTeaching(pool, schema, 'npc_trainer', teachingIds, clientBuild),
    fetchTrainersTeaching(pool, schema, 'npc_trainer_template', teachingIds, clientBuild)
  ]);

  const templateIds = trainerTemplate.map((t) => t.entry);
  const creaturesByTrainerId = await fetchCreaturesByTrainerId(pool, schema, templateIds, wowPatch);

  const trainers = [
    ...trainerOwn.map((t) => ({ source: 'creature', ...t, creatures: [t.entry] })),
    ...trainerTemplate.map((t) => ({ source: 'template', ...t, creatures: creaturesByTrainerId.get(t.entry) ?? [] }))
  ];

  const items = await fetchItemsCasting(pool, schema, numericEntry, teachingIds, wowPatch);

  const reagentIds = REAGENT_SLOTS.map((i) => Number(row[`reagent${i}`])).filter((n) => n > 0);
  const totemIds = [Number(row.totem1), Number(row.totem2)].filter((n) => n > 0);
  const itemIds = [...new Set([...reagentIds, ...totemIds, ...items.map((i) => i.entry)])];

  const triggerSpellIds = EFFECT_SLOTS.map((i) => Number(row[`effectTriggerSpell${i}`])).filter((n) => n > 0);
  const supersededIds = skillsRaw.map((s) => s.supersededBy).filter((n) => n > 0);
  const spellNameIds = [...new Set([...triggerSpellIds, ...supersededIds])];

  const creatureIds = [...new Set(trainers.flatMap((t) => t.creatures))];
  const skillIds = [...new Set(skillsRaw.map((s) => s.skillId))];

  const [{ names: itemNames, qualities: itemQuality }, spellNames, creatureNames, skillNames] = await Promise.all([
    fetchItemNamesWithQuality(pool, { schema, ids: itemIds, wowPatch }),
    fetchNames(pool, { schema, kind: 'spell', ids: spellNameIds, wowPatch, clientBuild }),
    fetchNames(pool, { schema, kind: 'creature', ids: creatureIds, wowPatch, clientBuild }),
    fetchSkillNames(pool, { dbcSchema, ids: skillIds })
  ]);

  const skills = skillsRaw.map((s) => ({ ...s, name: skillNames.get(s.skillId) || '' }));

  return {
    entry: numericEntry,
    row,
    labels,
    referenced,
    talent,
    skills,
    trainers,
    items,
    names: { item: itemNames, itemQuality, spell: spellNames, creature: creatureNames, skill: skillNames }
  };
}
