import { quoteIdentifier, withMissingReference } from '../queries/db/sql.js';
import { highestPatchClause, highestBuildClause } from '../queries/db/progressive.js';

// One statement per list, never one per id: a creature page can carry two
// hundred loot rows, and a query each would turn one page into two hundred
// round trips.
//
// spell_template is the odd one out. It is keyed (entry, build), like the
// faction tables, so it takes the client build and not the patch rule -
// but the rule for resolving that build is still "highest not above", the
// same shape highestPatchClause uses for patch
// (vmangos-core/src/game/Spells/SpellMgr.cpp:3722). An exact `build = ?`
// match would be wrong: only 1003 of 22381 spell entries on this realm's
// world DB carry a row at build 5875, so exact match would blank the name
// for the other ~95% instead of falling back to their nearest earlier build.
const KINDS = new Map([
  ['creature', { table: 'creature_template', nameColumn: 'name' }],
  ['item', { table: 'item_template', nameColumn: 'name' }],
  ['quest', { table: 'quest_template', nameColumn: 'Title' }],
  ['gameobject', { table: 'gameobject_template', nameColumn: 'name' }]
]);

export async function fetchNames(pool, { schema, kind, ids, wowPatch, clientBuild }) {
  const unique = [...new Set(ids.map(Number).filter(Number.isInteger))];
  if (unique.length === 0) return new Map();

  const placeholders = unique.map(() => '?').join(', ');

  if (kind === 'spell') {
    const table = `${quoteIdentifier(schema)}.${quoteIdentifier('spell_template')}`;
    const [rows] = await pool.query(
      `SELECT t1.entry, t1.name AS name FROM ${table} t1
       WHERE t1.entry IN (${placeholders}) AND ${highestBuildClause(schema, 'spell_template', 't1')}`,
      [...unique, clientBuild]
    );
    return new Map(rows.map((r) => [Number(r.entry), r.name ?? '']));
  }

  const spec = KINDS.get(kind);
  if (!spec) throw new Error(`fetchNames: unknown kind "${kind}"`);

  const table = `${quoteIdentifier(schema)}.${quoteIdentifier(spec.table)}`;
  const [rows] = await pool.query(
    `SELECT t1.entry, t1.${spec.nameColumn} AS name FROM ${table} t1
     WHERE t1.entry IN (${placeholders}) AND ${highestPatchClause(schema, spec.table, 't1')}`,
    [...unique, wowPatch]
  );
  return new Map(rows.map((r) => [Number(r.entry), r.name ?? '']));
}

// Name, quality and optionally icon for a batch of items, in one statement.
// Quality is what colours an item link (fields.js's entityLink); without it
// a loot or vendor link cannot say whether a drop is epic or grey. The icon
// comes from the reference schema's item_display_info, the same join
// server/queries/db/items.js makes, and like there a missing or half-imported
// reference schema drops the icon rather than the names.
export async function fetchItemSummaries(pool, { schema, dbcSchema = null, ids, wowPatch }) {
  const unique = [...new Set(ids.map(Number).filter(Number.isInteger))];
  if (unique.length === 0) return new Map();

  const placeholders = unique.map(() => '?').join(', ');
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier('item_template')}`;
  const read = (iconSchema) => {
    const iconSelect = iconSchema ? ', d.inventory_icon' : ', NULL AS inventory_icon';
    const iconJoin = iconSchema
      ? ` LEFT JOIN ${quoteIdentifier(iconSchema)}.${quoteIdentifier('item_display_info')} d ON d.id = t1.display_id`
      : '';
    return pool.query(
      `SELECT t1.entry, t1.name, t1.quality${iconSelect} FROM ${table} t1${iconJoin}
       WHERE t1.entry IN (${placeholders}) AND ${highestPatchClause(schema, 'item_template', 't1')}`,
      [...unique, wowPatch]
    );
  };

  let result = dbcSchema ? await withMissingReference(null, () => read(dbcSchema)) : null;
  if (result === null) result = await read(null);
  const [rows] = result;
  return new Map(rows.map((r) => [Number(r.entry), {
    name: r.name ?? '',
    quality: r.quality === null || r.quality === undefined ? null : Number(r.quality),
    icon: r.inventory_icon ?? null
  }]));
}

// The two maps an entity page's `names` object carries for items.
export async function fetchItemNamesWithQuality(pool, { schema, ids, wowPatch }) {
  const summaries = await fetchItemSummaries(pool, { schema, ids, wowPatch });
  return {
    names: new Map([...summaries].map(([id, s]) => [id, s.name])),
    qualities: new Map([...summaries].map(([id, s]) => [id, s.quality]))
  };
}
