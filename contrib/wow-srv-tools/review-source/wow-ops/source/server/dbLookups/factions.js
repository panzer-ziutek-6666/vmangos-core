import { quoteIdentifier } from '../queries/db/sql.js';
import { highestBuildClause } from '../queries/db/progressive.js';

// A batched sibling of fetchFaction, for the one place on the quest page that
// needs it: quest_template.RewRepFaction1..5 stores a Faction.dbc id
// directly - ObjectMgr::GetFactionEntry(id), which looks straight into
// m_FactionsMap (vmangos-core/src/game/ObjectMgr.h:1391-1398), is what
// Player::RewardReputation reads it through
// (vmangos-core/src/game/Objects/Player.cpp:6656:
// `sObjectMgr.GetFactionEntry(pQuest->RewRepFaction[i])`) - not
// GetFactionTemplateEntry. That is the opposite of creature_template.faction
// (a faction_template id, see fetchFaction above and
// vmangos-core/src/game/Objects/Creature.cpp:637,656-657): joining
// RewRepFaction through faction_template, the way fetchFaction does for a
// creature's faction, would resolve the wrong row here. `faction` is still
// keyed (id, build) like faction_template, and loaded the same "highest
// build not above" way (vmangos-core/src/game/ObjectMgr.cpp:8743), so this
// reuses highestBuildClause keyed on `id` - just against `faction` alone,
// with no join.
export async function fetchFactionNames(pool, { schema, factionIds, clientBuild }) {
  const unique = [...new Set(factionIds.map(Number).filter(Number.isInteger).filter((v) => v !== 0))];
  if (unique.length === 0) return new Map();

  const placeholders = unique.map(() => '?').join(', ');
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier('faction')}`;

  const [rows] = await pool.query(
    `SELECT t1.id, t1.name FROM ${table} t1
     WHERE t1.id IN (${placeholders}) AND ${highestBuildClause(schema, 'faction', 't1', 'id')}`,
    [...unique, clientBuild]
  );
  return new Map(rows.map((r) => [Number(r.id), r.name ?? '']));
}

// faction and faction_template are keyed (id, build), the same "delta only
// when something changed" shape creature_template etc. use for (entry,
// patch): most ids carry a single row at the lowest build and nothing after
// it. The core loads both tables the same "highest build not above
// SUPPORTED_CLIENT_BUILD" way it loads patch-keyed tables
// (vmangos-core/src/game/ObjectMgr.cpp:8743 for `faction`,
// vmangos-core/src/game/ObjectMgr.cpp:8836 for `faction_template`) - not an
// exact-match on the current build. So both joins below use
// highestBuildClause, keyed on `id` (not the default `entry`), one per table,
// each bounded by clientBuild.
//
// The two tables are aliased t1 and t3, not t1/t2: highestBuildClause's
// correlated subquery always names its own inner row t2, and reusing that
// name as an outer alias would let the subquery's `WHERE t2.id = t2.id`
// shadow itself instead of correlating to the outer row, silently matching
// every row instead of the one being checked.
export async function fetchFaction(pool, { schema, factionTemplateId, clientBuild }) {
  const templateTable = `${quoteIdentifier(schema)}.${quoteIdentifier('faction_template')}`;
  const factionTable = `${quoteIdentifier(schema)}.${quoteIdentifier('faction')}`;

  const [rows] = await pool.query(
    `SELECT t1.id, t1.faction_id, t3.name
     FROM ${templateTable} t1
     JOIN ${factionTable} t3 ON t3.id = t1.faction_id
     WHERE t1.id = ?
       AND ${highestBuildClause(schema, 'faction_template', 't1', 'id')}
       AND ${highestBuildClause(schema, 'faction', 't3', 'id')}`,
    [factionTemplateId, clientBuild, clientBuild]
  );
  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    templateId: Number(row.id),
    factionId: Number(row.faction_id),
    name: row.name ?? ''
  };
}
