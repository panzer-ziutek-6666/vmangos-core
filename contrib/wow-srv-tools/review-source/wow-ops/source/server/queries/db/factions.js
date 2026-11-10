import { qualified } from './sql.js';
import { highestBuildClause } from './progressive.js';

// faction is keyed (id, build) and loaded "highest build not above"
// (vmangos-core/src/game/ObjectMgr.cpp:8743) - read here exactly as
// server/dbLookups/factions.js reads it. `team` is Faction.dbc's
// m_parentFactionID (vmangos-core/src/game/Database/DBCStructure.h:318): the
// reputation panel's headers (Alliance, Horde, Steamwheedle Cartel...).
// reputation_list_id < 0 means the faction cannot carry reputation
// (FactionEntry::CanHaveReputation, DBCStructure.h:340-343): the internal
// factions creatures are assigned to, listed last.
export async function listFactions(pool, { schema, clientBuild }) {
  const table = qualified(schema, 'faction');
  const [rows] = await pool.query(
    `SELECT t1.id, t1.name, t1.reputation_list_id, t1.team FROM ${table} t1
     WHERE ${highestBuildClause(schema, 'faction', 't1', 'id')}
     ORDER BY t1.name`,
    [clientBuild]
  );
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const reputable = rows.filter((r) => Number(r.reputation_list_id) >= 0);
  const groups = new Map();
  for (const r of reputable) {
    const parent = Number(r.team);
    if (!groups.has(parent)) groups.set(parent, { id: parent, name: parent ? (byId.get(parent)?.name ?? `faction #${parent}`) : 'Other', factions: [] });
    groups.get(parent).factions.push({ id: Number(r.id), name: r.name ?? '' });
  }
  return {
    groups: [...groups.values()].sort((a, b) => (a.id === 0) - (b.id === 0) || a.name.localeCompare(b.name)),
    internal: rows.filter((r) => Number(r.reputation_list_id) < 0).map((r) => ({ id: Number(r.id), name: r.name ?? '' }))
  };
}

// The faction hover card's whole read (GET /db/tooltip/faction/:id,
// server/sections/db.js): the same highestBuildClause loadFaction's own
// first query uses (server/queries/db/faction.js), keyed on `id` rather than
// `entry` - one query total. Ruling 4 (M2) adds the card's "side": a
// self-join on `team` (Faction.dbc's m_parentFactionID,
// vmangos-core/src/game/Database/DBCStructure.h:318), build-keyed the same
// way as the row itself, so the parent's name comes back at build-current
// too. The row is picked out of the result set by id rather than trusted as
// rows[0], the same rule every other single-row read in this section
// follows.
export async function fetchFactionRow(pool, { schema, id, clientBuild }) {
  const table = qualified(schema, 'faction');
  const [rows] = await pool.query(
    `SELECT t1.id, t1.name, t1.description, t1.reputation_list_id, p.name AS parent_name
     FROM ${table} t1
     LEFT JOIN ${table} p ON p.id = t1.team AND ${highestBuildClause(schema, 'faction', 'p', 'id')}
     WHERE t1.id = ? AND ${highestBuildClause(schema, 'faction', 't1', 'id')}`,
    [clientBuild, id, clientBuild]
  );
  return rows.find((r) => Number(r.id) === id) ?? null;
}
