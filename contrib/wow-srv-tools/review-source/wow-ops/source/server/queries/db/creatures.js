import { quoteIdentifier, withMissingReference } from './sql.js';
import { highestPatchClause } from './progressive.js';
import { CREATURE_SORTS } from './creatureFilters.js';

// creature_template is keyed (entry, patch), same as item_template - see
// items.js and progressive.js for why both the page of rows and the count go
// through highestPatchClause. 11 distinct patch values on this realm; a count
// that skips it reports a pager with more pages than there are creatures.
const COLUMNS = ['t1.entry', 't1.name', 't1.subname', 't1.level_min', 't1.level_max', 't1.rank', 't1.type', 't1.faction'];

// A spawn point names its template through creature.id..id5, not id alone -
// see server/queries/db/spawns.js, which already carries the measurement
// that makes the five-column match necessary (9648 + 3047 + 608 + 8 rows out
// of 66243 spawn from id2..id5, not id). The spawn count and representative
// map both walk the same five columns, and both carry the same
// patch_min/patch_max bound spawns.js already applies (patch_min <= wowPatch
// <= patch_max): a spawn_count here that disagreed with what the creature's
// own page (loadCreature, via fetchCreatureSpawns) reports for the same entry
// would read as data corruption, not as a deliberate approximation.
//
// One statement per page, not a subquery per row: `creature` indexes only
// `id`, so a per-row "id = e OR id2 = e ..." subquery rescans the whole
// table, and two of them per row on a 50-row page took 2.5 s against this
// realm (measured 2026-09-23, on every NPC page load). This reads the spawn
// rows naming any of the page's entries in one scan and tallies them here. A
// row that names the same entry in two columns counts once for it, which is
// what COUNT(*) over the OR counted.
const SPAWN_COLUMNS = ['id', 'id2', 'id3', 'id4', 'id5'];

async function fetchSpawnSummary(pool, { schema, entries, wowPatch }) {
  const wanted = new Set(entries.map(Number));
  const summary = new Map();
  if (wanted.size === 0) return summary;

  const creature = `${quoteIdentifier(schema)}.${quoteIdentifier('creature')}`;
  const ids = [...wanted];
  const placeholders = ids.map(() => '?').join(', ');
  const idMatch = SPAWN_COLUMNS.map((col) => `c.${col} IN (${placeholders})`).join(' OR ');
  const [rows] = await pool.query(
    `SELECT ${SPAWN_COLUMNS.map((col) => `c.${col}`).join(', ')}, c.map FROM ${creature} c
     WHERE (${idMatch}) AND c.patch_min <= ? AND ? <= c.patch_max`,
    [...SPAWN_COLUMNS.flatMap(() => ids), wowPatch, wowPatch]
  );

  for (const row of rows) {
    const map = Number(row.map);
    for (const entry of new Set(SPAWN_COLUMNS.map((col) => Number(row[col])))) {
      if (!wanted.has(entry)) continue;
      const seen = summary.get(entry);
      summary.set(entry, seen
        ? { count: seen.count + 1, mapId: Math.min(seen.mapId, map) }
        : { count: 1, mapId: map });
    }
  }
  return summary;
}

// creature_template.faction is a faction_template id, not a faction id
// (server/dbLookups/factions.js, citing vmangos-core/src/game/Objects/
// Creature.cpp:637,656-657) - the name a person searches for lives another
// hop away, in `faction`. Unlike dbLookups/factions.js this reads both
// tables from the DBC-imported reference schema (tools/dbc/layouts/
// Faction.js, FactionTemplate.js), not the world schema's own versioned
// copies: the reference schema is a single import snapshot, one row per id,
// so this needs no highestBuildClause - the plain join items.js already uses
// for item_display_info.
function factionJoin(dbcSchema) {
  if (!dbcSchema) return '';
  const template = `${quoteIdentifier(dbcSchema)}.${quoteIdentifier('faction_template')}`;
  const faction = `${quoteIdentifier(dbcSchema)}.${quoteIdentifier('faction')}`;
  return ` LEFT JOIN ${template} ft ON ft.id = t1.faction LEFT JOIN ${faction} faction ON faction.id = ft.faction`;
}

// The faction filter (creatureFilters.js) binds to the joined `faction`
// alias above, which only exists when the reference schema resolved. Rather
// than let a WHERE reference an alias no FROM clause provides, the condition
// (and its one bound param, index-aligned with it) is dropped along with the
// join - the filter cannot apply without the name it matches against, so it
// is silently satisfied rather than turned into "zero rows" nobody can
// explain.
function withoutFactionFilter(filters) {
  const idx = filters.conditions.findIndex((c) => c.startsWith('faction.name'));
  if (idx === -1) return filters;
  return {
    ...filters,
    conditions: filters.conditions.filter((_, i) => i !== idx),
    params: filters.params.filter((_, i) => i !== idx)
  };
}

async function fetchRows(pool, { schema, dbcSchema, filters, wowPatch }) {
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier('creature_template')}`;
  const effective = dbcSchema ? filters : withoutFactionFilter(filters);
  const patchClause = highestPatchClause(schema, 'creature_template', 't1');
  const where = [...effective.conditions, patchClause].join(' AND ');
  const order = `${CREATURE_SORTS[effective.sort]} ${effective.dir}`;
  const offset = (effective.page - 1) * effective.pageSize;
  const factionSelect = dbcSchema ? ', faction.name AS faction_name' : ', NULL AS faction_name';

  const [rows] = await pool.query(
    `SELECT ${COLUMNS.join(', ')}${factionSelect}
     FROM ${table} t1${factionJoin(dbcSchema)}
     WHERE ${where}
     ORDER BY ${order}, t1.entry LIMIT ? OFFSET ?`,
    [...effective.params, wowPatch, effective.pageSize, offset]
  );
  return rows;
}

export async function listCreatures(pool, { schema, dbcSchema, filters, wowPatch }) {
  const args = { schema, filters, wowPatch };

  // Same fallback shape as items.js: a configured dbcSchema is no proof
  // tools/import-dbc.js ever finished (it documents leaving a partial schema
  // behind on a failed run), so a join that fails with ER_NO_SUCH_TABLE or
  // ER_BAD_DB_ERROR retries without it rather than taking the whole list down.
  let rows = dbcSchema
    ? await withMissingReference(null, () => fetchRows(pool, { ...args, dbcSchema }))
    : null;
  const resolvedDbcSchema = rows !== null ? dbcSchema : null;
  if (rows === null) rows = await fetchRows(pool, { ...args, dbcSchema: null });

  // The count mirrors whichever attempt above actually succeeded - same WHERE
  // (join included only when it does), same bound params in the same order -
  // so the pager never reports more pages than the list it is paging.
  const effective = resolvedDbcSchema ? filters : withoutFactionFilter(filters);
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier('creature_template')}`;
  const patchClause = highestPatchClause(schema, 'creature_template', 't1');
  const where = [...effective.conditions, patchClause].join(' AND ');

  const [counted] = await pool.query(
    `SELECT COUNT(*) AS total FROM ${table} t1${factionJoin(resolvedDbcSchema)} WHERE ${where}`,
    [...effective.params, wowPatch]
  );

  // Read after the count, so the row read and the count stay the first two
  // statements whatever the page holds.
  const spawns = await fetchSpawnSummary(pool, { schema, entries: rows.map((r) => r.entry), wowPatch });
  const withSpawns = rows.map((r) => {
    const seen = spawns.get(Number(r.entry));
    return { ...r, spawn_count: seen?.count ?? 0, map_id: seen?.mapId ?? null };
  });

  return { rows: withSpawns, total: Number(counted[0]?.total ?? 0) };
}
