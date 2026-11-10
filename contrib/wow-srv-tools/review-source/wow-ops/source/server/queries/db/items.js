import { quoteIdentifier, withMissingReference } from './sql.js';
import { highestPatchClause } from './progressive.js';
import { ITEM_SORTS } from './itemFilters.js';

// item_template is keyed (entry, patch) and this realm carries 11 distinct
// patch values, so both the page of rows and the count go through the same
// clause the core's own progressive loader uses
// (vmangos-core/src/shared/Database/SQLStorageImpl.h:364). A count that skips
// it reports a pager with more pages than there are items.
const COLUMNS = [
  't1.entry', 't1.name', 't1.quality', 't1.class', 't1.subclass',
  't1.item_level', 't1.required_level', 't1.inventory_type', 't1.set_id'
];

// One query shape, with or without the icon join, so the "no reference
// schema configured" path and the "reference schema configured but missing
// or half-imported" fallback path (withMissingReference below) never grow
// two copies of this SQL.
async function fetchRows(pool, { items, where, order, offset, filters, wowPatch, dbcSchema }) {
  const iconSelect = dbcSchema ? ', d.inventory_icon' : ', NULL AS inventory_icon';
  const iconJoin = dbcSchema
    ? ` LEFT JOIN ${quoteIdentifier(dbcSchema)}.${quoteIdentifier('item_display_info')} d ON d.id = t1.display_id`
    : '';
  const [rows] = await pool.query(
    `SELECT ${COLUMNS.join(', ')}${iconSelect} FROM ${items} t1${iconJoin} WHERE ${where}
     ORDER BY ${order}, t1.entry LIMIT ? OFFSET ?`,
    [...filters.params, wowPatch, filters.pageSize, offset]
  );
  return rows;
}

export async function listItems(pool, { schema, dbcSchema, filters, wowPatch }) {
  const items = `${quoteIdentifier(schema)}.${quoteIdentifier('item_template')}`;
  const patchClause = highestPatchClause(schema, 'item_template', 't1');
  // filters.conditions before patchClause, not after: fetchRows and the count
  // both bind filters.params followed by wowPatch (below), in that order, so
  // the WHERE text's placeholders have to read left to right the same way -
  // swapping this order desyncs the bound values from the clauses that
  // consume them.
  const where = [...filters.conditions, patchClause].join(' AND ');
  const order = `${ITEM_SORTS[filters.sort]} ${filters.dir}`;
  const offset = (filters.page - 1) * filters.pageSize;
  const args = { items, where, order, offset, filters, wowPatch };

  // The icon lives in the reference schema, which the importer may never
  // have been run for at all (dbcSchema itself null - no query attempted),
  // or may have stopped half way (dbcSchema is a real name but the join
  // fails with ER_NO_SUCH_TABLE/ER_BAD_DB_ERROR). Either way the browser is
  // still worth reading, so the join is dropped rather than the whole item
  // list - a missing icon table would otherwise take every row down with
  // it, not just the icons, because it sits inside the main SELECT.
  let rows = dbcSchema
    ? await withMissingReference(null, () => fetchRows(pool, { ...args, dbcSchema }))
    : null;
  if (rows === null) rows = await fetchRows(pool, { ...args, dbcSchema: null });

  const [counted] = await pool.query(
    `SELECT COUNT(*) AS total FROM ${items} t1 WHERE ${where}`,
    [...filters.params, wowPatch]
  );

  return { rows, total: Number(counted[0]?.total ?? 0) };
}
