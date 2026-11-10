// A DBC carries no names and no types: a record is a fixed-size run of
// four-byte fields and nothing in the file says what any of them mean. A
// layout supplies both, and its only defence against being wrong is that the
// total number of fields it declares has to equal the number the file's own
// header declares. That is why a field nobody has identified is still
// declared - dropping it would make the sum agree while the columns after it
// read the wrong bytes.
const KINDS = {
  uint: { width: 1, sql: 'INT UNSIGNED NOT NULL DEFAULT 0' },
  int: { width: 1, sql: 'INT NOT NULL DEFAULT 0' },
  float: { width: 1, sql: 'FLOAT NOT NULL DEFAULT 0' },
  str: { width: 1, sql: "VARCHAR(512) NOT NULL DEFAULT ''" },
  // Eight locale slots and a flags word. This client fills only slot 0
  // (AreaTable.dbc row 5 is "Swamp of Sorrows" with slots 1-7 empty), so the
  // column reads the first and the other eight fields exist only to keep the
  // count honest.
  locstring: { width: 9, sql: "VARCHAR(512) NOT NULL DEFAULT ''" },
  loctext: { width: 9, sql: 'TEXT' },
  skip: { width: 1, sql: null },
  // Reads no field: its value is the record's position in the file, not
  // anything the file's own bytes carry. Width 0 keeps it out of fieldCount.
  rowIndex: { width: 0, sql: 'INT UNSIGNED NOT NULL DEFAULT 0' }
};

const column = (kind) => (name) => ({ name, kind, width: KINDS[kind].width, sql: KINDS[kind].sql });

export const uint = column('uint');
export const int = column('int');
export const float = column('float');
export const str = column('str');
export const locstring = column('locstring');
export const loctext = column('loctext');
export const skip = () => ({ name: null, kind: 'skip', width: 1, sql: null });
export const skipN = (n) => ({ name: null, kind: 'skip', width: n, sql: null });
export const rowIndex = column('rowIndex');

export function defineLayout({ table, file, columns }) {
  const seen = new Set();
  for (const col of columns) {
    if (col.name === null) continue;
    if (seen.has(col.name)) throw new Error(`${file}: duplicate column "${col.name}"`);
    seen.add(col.name);
  }
  const fieldCount = columns.reduce((sum, col) => sum + col.width, 0);
  return Object.freeze({ table, file, columns, fieldCount });
}

export function assertLayout(layout, dbc) {
  if (layout.fieldCount !== dbc.fieldCount) {
    throw new Error(
      `${layout.file}: the layout declares ${layout.fieldCount} fields but the file has ${dbc.fieldCount}. ` +
      'Every field must be declared, including unknown ones; a layout that is short shifts every column after the gap.'
    );
  }
}

// The field index each real column reads. Skips advance the cursor and yield
// nothing; a locstring reads its first slot and steps over the other eight.
export function columnOffsets(layout) {
  const out = [];
  let field = 0;
  for (const col of layout.columns) {
    if (col.kind === 'rowIndex') out.push({ column: col, field: null });
    else if (col.kind !== 'skip') out.push({ column: col, field });
    field += col.width;
  }
  return out;
}
