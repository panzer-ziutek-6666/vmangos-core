import { quoteIdentifier, withMissingReference } from './sql.js';
import { highestPatchClause } from './progressive.js';
import { fetchSpellRows, fetchSpellLabels } from '../../dbLookups/spellLabels.js';
import { referencedSpellIds } from '../../dbLookups/spellText.js';

// item_set lives only in the reference schema (tools/import-dbc.js): the
// world database has no item_set table at all, so there is nothing to read
// without a dbcSchema. A configured-but-missing-or-partial schema fails the
// query itself (ER_NO_SUCH_TABLE / ER_BAD_DB_ERROR), caught by
// withMissingReference the same way listItems() falls back for the item icon
// join (server/queries/db/items.js).
const EMPTY = { rows: [], total: 0 };

// Names for the required_skill_id column (dbc.skill_line, same table
// loadItemSet already reads for the detail page). A separate guarded query
// rather than a JOIN on listItemSets' own SELECT: skill_line can be missing
// or half-imported independently of item_set (6b31d3b), and a JOIN across
// schemas would fail the whole list - not just the name - the moment that one
// table is absent.
async function fetchSkillNames(pool, dbcSchema, rows) {
  const ids = [...new Set(rows.map((r) => Number(r.required_skill_id)).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const skillTable = `${quoteIdentifier(dbcSchema)}.${quoteIdentifier('skill_line')}`;
  const placeholders = ids.map(() => '?').join(', ');
  const names = await withMissingReference(null, async () => {
    const [skillRows] = await pool.query(`SELECT id, name FROM ${skillTable} WHERE id IN (${placeholders})`, ids);
    return skillRows;
  });
  return new Map((names ?? []).map((r) => [Number(r.id), r.name]));
}

export async function listItemSets(pool, { dbcSchema }) {
  if (!dbcSchema) return EMPTY;
  const table = `${quoteIdentifier(dbcSchema)}.${quoteIdentifier('item_set')}`;

  return withMissingReference(EMPTY, async () => {
    const [rows] = await pool.query(
      `SELECT id, name, required_skill_id, required_skill_value FROM ${table} ORDER BY name`
    );
    const [counted] = await pool.query(`SELECT COUNT(*) AS total FROM ${table}`);
    const skillNames = await fetchSkillNames(pool, dbcSchema, rows);
    for (const row of rows) row.skill_name = skillNames.get(Number(row.required_skill_id)) ?? null;
    return { rows, total: Number(counted[0]?.total ?? 0) };
  });
}

// Members are not in item_set at all - set_id is a column on item_template,
// the world side - so this is a patch-filtered read of item_template exactly
// like every other progressive-table read in this section
// (vmangos-core/src/shared/Database/SQLStorageImpl.h:364). The icon comes
// from the same optional reference join listItems() uses, so a missing or
// half-imported schema drops the icon rather than the member list.
async function fetchMembers(pool, { schema, dbcSchema, id, wowPatch }) {
  const items = `${quoteIdentifier(schema)}.${quoteIdentifier('item_template')}`;
  const patchClause = highestPatchClause(schema, 'item_template', 't1');
  const iconSelect = dbcSchema ? ', d.inventory_icon' : ', NULL AS inventory_icon';
  const iconJoin = dbcSchema
    ? ` LEFT JOIN ${quoteIdentifier(dbcSchema)}.${quoteIdentifier('item_display_info')} d ON d.id = t1.display_id`
    : '';
  const [rows] = await pool.query(
    `SELECT t1.entry, t1.name, t1.quality${iconSelect} FROM ${items} t1${iconJoin}
     WHERE t1.set_id = ? AND ${patchClause}`,
    [id, wowPatch]
  );
  return rows;
}

export async function loadItemSet(pool, { schema, dbcSchema, id, wowPatch, clientBuild }) {
  if (!dbcSchema) return null;
  const setTable = `${quoteIdentifier(dbcSchema)}.${quoteIdentifier('item_set')}`;

  const setRows = await withMissingReference([], async () => {
    const [rows] = await pool.query(`SELECT * FROM ${setTable} WHERE id = ?`, [id]);
    return rows;
  });
  if (setRows.length === 0) return null;
  const set = setRows[0];

  // dbcSchema is always truthy here - loadItemSet already returned above when
  // it was not - so unlike listItems' own icon join (items.js:47-50, a real
  // ternary: dbcSchema can be null there), this one only ever takes its true
  // branch. Written as a plain call, not a ternary that can never go the
  // other way.
  let members = await withMissingReference(null, () => fetchMembers(pool, { schema, dbcSchema, id, wowPatch }));
  if (members === null) members = await fetchMembers(pool, { schema, dbcSchema: null, id, wowPatch });

  // The skill's own name lives in the reference schema too
  // (dbc.skill_line); only looked up when the set actually requires one -
  // required_skill_id 0 means "no skill required" (item_set.dbc), not skill
  // id 0.
  let skillName = null;
  if (Number(set.required_skill_id)) {
    const skillTable = `${quoteIdentifier(dbcSchema)}.${quoteIdentifier('skill_line')}`;
    skillName = await withMissingReference(null, async () => {
      const [rows] = await pool.query(`SELECT name FROM ${skillTable} WHERE id = ?`, [set.required_skill_id]);
      return rows[0]?.name ?? null;
    });
  }

  // A bonus is a spell (item_set.dbc spell_id_1..8): its rows, build-keyed
  // like every spell_template read, then any spell their descriptions name
  // ($12345s1), then one batch of labels for all of them - so the page can
  // write each bonus as the client does, "(N) Set: <what it does>".
  const bonusIds = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => Number(set[`spell_id_${i}`])).filter((n) => n > 0);
  const bonusSpells = await fetchSpellRows(pool, { schema, ids: bonusIds, clientBuild });
  const refIds = [...bonusSpells.values()].flatMap((r) => referencedSpellIds(r.description)).filter((n) => !bonusSpells.has(n));
  const referenced = refIds.length ? await fetchSpellRows(pool, { schema, ids: refIds, clientBuild }) : new Map();
  const labels = await fetchSpellLabels(pool, { dbcSchema, spells: [...bonusSpells.values(), ...referenced.values()] });

  return { set, members, skillName, bonusSpells, referenced, labels };
}
