import test from 'node:test';
import assert from 'node:assert/strict';
import { defineLayout, assertLayout, columnOffsets, uint, int, float, str, locstring, loctext, skip, skipN, rowIndex } from '../tools/dbc/layout.js';

test('field count is the sum of the column widths', () => {
  const layout = defineLayout({
    table: 'sample', file: 'Sample.dbc',
    columns: [uint('id'), locstring('name'), skipN(3), float('radius')]
  });
  assert.equal(layout.fieldCount, 1 + 9 + 3 + 1);
});

test('a localized string is one column reading the first slot', () => {
  const layout = defineLayout({
    table: 'sample', file: 'Sample.dbc',
    columns: [uint('id'), locstring('name'), uint('flags')]
  });
  assert.deepEqual(columnOffsets(layout), [
    { column: layout.columns[0], field: 0 },
    { column: layout.columns[1], field: 1 },
    { column: layout.columns[2], field: 10 }
  ]);
});

test('a short layout is refused, naming both counts', () => {
  const layout = defineLayout({ table: 'sample', file: 'Sample.dbc', columns: [uint('id'), uint('a')] });
  assert.throws(
    () => assertLayout(layout, { fieldCount: 4, recordCount: 1 }),
    /Sample\.dbc.*declares 2.*has 4/s
  );
});

test('a layout matching the file passes', () => {
  const layout = defineLayout({ table: 'sample', file: 'Sample.dbc', columns: [uint('id'), uint('a')] });
  assert.doesNotThrow(() => assertLayout(layout, { fieldCount: 2, recordCount: 1 }));
});

test('a duplicate column name is refused', () => {
  assert.throws(
    () => defineLayout({ table: 'sample', file: 'Sample.dbc', columns: [uint('id'), uint('id')] }),
    /duplicate column "id"/
  );
});

test('every skip is anonymous and produces no column', () => {
  const layout = defineLayout({ table: 'sample', file: 'Sample.dbc', columns: [uint('id'), skip(), skip()] });
  assert.equal(columnOffsets(layout).length, 1);
});

test('the SQL type of each kind', () => {
  assert.equal(uint('a').sql, 'INT UNSIGNED NOT NULL DEFAULT 0');
  assert.equal(int('a').sql, 'INT NOT NULL DEFAULT 0');
  assert.equal(float('a').sql, 'FLOAT NOT NULL DEFAULT 0');
  assert.equal(str('a').sql, "VARCHAR(512) NOT NULL DEFAULT ''");
  assert.equal(locstring('a').sql, "VARCHAR(512) NOT NULL DEFAULT ''");
  assert.equal(loctext('a').sql, 'TEXT');
});

// A row's position in the file is data the client uses (it breaks ties in
// TalentTab's order index: Mage Arcane and Fire both carry 0, and the client
// lists Arcane, the earlier row, first). It occupies no field, so a layout
// declaring it keeps the file's field count.
test('rowIndex is a column that reads no field', () => {
  const layout = defineLayout({ table: 't', file: 'T.dbc', columns: [uint('id'), skip(), rowIndex('dbc_row')] });
  assert.equal(layout.fieldCount, 2);
  const offsets = columnOffsets(layout);
  assert.deepEqual(offsets.map((o) => [o.column.name, o.field]), [['id', 0], ['dbc_row', null]]);
});
