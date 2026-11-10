import { quote } from './schema.js';

export async function checkRowCounts(connection, tables) {
  const out = [];
  for (const { table, records } of tables) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS n FROM ${quote(table)}`);
    const actual = Number(rows[0].n);
    out.push({ table, expected: records, actual, ok: actual === records });
  }
  return out;
}

// spell_template is keyed (entry, build) and carries rows for eleven client
// builds. The core reads it as "the highest build not above the configured
// one" (src/game/Spells/SpellMgr.cpp), so a comparison that skipped this fold
// would match rows belonging to a different client and report differences
// that are not differences.
export function foldedSpellTemplateSql(build) {
  return `SELECT t.* FROM spell_template t
    JOIN (SELECT entry, MAX(build) AS build FROM spell_template WHERE build <= ${build} GROUP BY entry) latest
      ON latest.entry = t.entry AND latest.build = t.build`;
}

// Reported as numbers, not asserted. The core edits some of these rows on
// purpose, so a difference is evidence to read, not a failure - except that a
// column differing on nearly every row means the layout put it in the wrong
// place, which is exactly what this exists to catch.
export async function compareSpells(dbcConnection, worldConnection, { build, columns }) {
  const selected = ['id', ...columns].map(quote).join(', ');
  const [dbcRows] = await dbcConnection.query(`SELECT ${selected} FROM ${quote('spell')}`);
  const [worldRows] = await worldConnection.query(foldedSpellTemplateSql(build));

  const world = new Map(worldRows.map((row) => [row.entry, row]));
  const differing = new Map(columns.map((column) => [column, 0]));
  const onlyInDbc = [];
  let compared = 0;

  for (const row of dbcRows) {
    const other = world.get(row.id);
    if (!other) { onlyInDbc.push(row.id); continue; }
    compared++;
    for (const column of columns) {
      if (row[column] !== other[column]) differing.set(column, differing.get(column) + 1);
    }
    world.delete(row.id);
  }

  return {
    compared,
    onlyInDbc,
    onlyInWorld: [...world.keys()],
    differing: [...differing].filter(([, rows]) => rows > 0).map(([column, rows]) => ({ column, rows }))
  };
}
