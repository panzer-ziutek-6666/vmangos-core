import { quoteIdentifier } from '../queries/db/sql.js';
import { highestPatchClause } from '../queries/db/progressive.js';

// map_template is progressive on `patch` like creature_template, item_template
// etc. (vmangos-core/src/shared/Database/SQLStorageImpl.h:364), and its
// readable column is `map_name`, not `name`.
export async function fetchMapNames(pool, { schema, mapIds, wowPatch }) {
  const unique = [...new Set(mapIds.map(Number).filter(Number.isInteger))];
  if (unique.length === 0) return new Map();

  const placeholders = unique.map(() => '?').join(', ');
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier('map_template')}`;

  const [rows] = await pool.query(
    `SELECT t1.entry, t1.map_name AS name FROM ${table} t1
     WHERE t1.entry IN (${placeholders}) AND ${highestPatchClause(schema, 'map_template', 't1')}`,
    [...unique, wowPatch]
  );
  return new Map(rows.map((r) => [Number(r.entry), r.name ?? '']));
}

// area_template, unlike map_template, is not progressive - it carries no
// patch or build column at all, so this needs neither highestPatchClause nor
// highestBuildClause. Its home is fishing_loot_template's entry (LootMgr.cpp:46
// "area id"): every one of the 360 distinct entries fishing_loot_template
// carries on this realm resolves through area_template with zero misses.
export async function fetchAreaNames(pool, { schema, areaIds }) {
  const unique = [...new Set(areaIds.map(Number).filter(Number.isInteger))];
  if (unique.length === 0) return new Map();

  const placeholders = unique.map(() => '?').join(', ');
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier('area_template')}`;

  const [rows] = await pool.query(
    `SELECT entry, name FROM ${table} WHERE entry IN (${placeholders})`,
    unique
  );
  return new Map(rows.map((r) => [Number(r.entry), r.name ?? '']));
}
