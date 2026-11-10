import { join } from 'node:path';
import { statSync } from 'node:fs';
import { readDbc } from './reader.js';
import { assertLayout, columnOffsets } from './layout.js';
import { dropTableSql, createTableSql, insertSql } from './schema.js';

// An integer field is four bytes and nothing in the file says whether it is
// signed. The layout does, and reading it the wrong way turns a small negative
// into a number near 2^32 rather than into an error.
function valueOf(dbc, row, field, kind) {
  if (kind === 'rowIndex') return row;
  if (kind === 'float') return dbc.float(row, field);
  if (kind === 'int') return dbc.uint(row, field) | 0;
  if (kind === 'uint') return dbc.uint(row, field);
  // dbc.string() already decoded the raw byte as latin1, so a stored 0xE9 is
  // already the code point U+00E9 - a JS string is Unicode by value, not by
  // encoding. Running it back through Buffer.from(text, 'latin1') would treat
  // that code point as a raw byte again and mangle anything above 0x7F.
  return dbc.string(row, field);
}

export function readRows(layout, dbc) {
  const offsets = columnOffsets(layout);
  const rows = [];
  for (let row = 0; row < dbc.recordCount; row++) {
    rows.push(offsets.map(({ column, field }) => valueOf(dbc, row, field, column.kind)));
  }
  return rows;
}

export async function importTable(connection, layout, dbcDir, { batchRows = 200 } = {}) {
  const sourcePath = join(dbcDir, layout.file);
  // Stat before read: what a page needs to say "this may be stale" is the
  // file's own size and mtime, not anything derived from its parsed rows.
  const stats = statSync(sourcePath);
  const dbc = readDbc(sourcePath);
  // Before any DDL: a wrong layout must not leave a dropped table behind.
  assertLayout(layout, dbc);

  const rows = readRows(layout, dbc);
  await connection.query(dropTableSql(layout));
  await connection.query(createTableSql(layout));

  let batches = 0;
  for (let at = 0; at < rows.length; at += batchRows) {
    const batch = rows.slice(at, at + batchRows);
    await connection.query(insertSql(layout, batch.length), batch.flat());
    batches++;
  }

  return {
    table: layout.table,
    file: layout.file,
    records: dbc.recordCount,
    fieldCount: dbc.fieldCount,
    recordSize: dbc.recordSize,
    batches,
    sourceBytes: stats.size,
    sourceModified: stats.mtime
  };
}
