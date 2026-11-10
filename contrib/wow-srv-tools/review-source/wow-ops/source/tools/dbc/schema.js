import { columnOffsets } from './layout.js';

// Identifiers come from layout files in this repository, never from input, so
// a backtick cannot appear in one. Refuse anything else outright rather than
// building a statement that would depend on that staying true. Exported so
// verify.js can quote the table and column names it builds SQL from too,
// rather than growing a second copy of the same defense.
export function quote(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error(`unusable SQL identifier: ${identifier}`);
  return `\`${identifier}\``;
}

const realColumns = (layout) => columnOffsets(layout).map(({ column }) => column);

export function createTableSql(layout) {
  const columns = realColumns(layout);
  const lines = columns.map((col) => `  ${quote(col.name)} ${col.sql}`);
  lines.push(`  PRIMARY KEY (${quote(columns[0].name)})`);
  return `CREATE TABLE ${quote(layout.table)} (\n${lines.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
}

export function dropTableSql(layout) {
  return `DROP TABLE IF EXISTS ${quote(layout.table)}`;
}

export function insertSql(layout, rowCount) {
  if (rowCount < 1) throw new Error('insertSql needs at least one row');
  const columns = realColumns(layout);
  const names = columns.map((col) => quote(col.name)).join(', ');
  const group = `(${columns.map(() => '?').join(', ')})`;
  return `INSERT INTO ${quote(layout.table)} (${names}) VALUES ${Array(rowCount).fill(group).join(', ')}`;
}
