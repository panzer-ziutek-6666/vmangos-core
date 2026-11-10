import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A DBC is a header, a block of fixed-size records and a string block. The
// header fields are separate options so a test can put a wrong value in one of
// them without hand-assembling the whole file - which is the only way to
// exercise the reader's and the importer's geometry checks.
//
// A field is a number (uint32), { float } or { str }. Strings are interned:
// the same text written twice yields the same offset, which is what the real
// files do and what makes an offset assertion meaningful.
export function writeDbc(path, { rows, fieldCount, recordSize, strings, magic = 'WDBC' } = {}) {
  const width = fieldCount ?? rows[0]?.length ?? 0;
  const size = recordSize ?? width * 4;

  // Offset 0 is the empty string, so a zero offset and an empty string are the
  // same thing - as they are in the client's own files.
  const parts = ['\0'];
  const offsets = new Map([['', 0]]);
  let length = 1;
  const intern = (text) => {
    if (offsets.has(text)) return offsets.get(text);
    const at = length;
    offsets.set(text, at);
    parts.push(`${text}\0`);
    length += text.length + 1;
    return at;
  };

  const records = Buffer.alloc(rows.length * size);
  rows.forEach((fields, row) => {
    fields.forEach((value, field) => {
      const at = row * size + field * 4;
      // A DBC field is four raw bytes; a layout's "int" column reinterprets
      // them as signed. writeUInt32LE rejects a negative JS number outright,
      // so mask to the unsigned bit pattern first - >>> 0 is a no-op for the
      // non-negative values every other caller already writes.
      if (typeof value === 'number') records.writeUInt32LE(value >>> 0, at);
      else if ('float' in value) records.writeFloatLE(value.float, at);
      else records.writeUInt32LE(intern(value.str), at);
    });
  });

  const stringBlock = Buffer.from(strings ?? parts.join(''), 'latin1');
  const header = Buffer.alloc(20);
  header.write(magic, 0, 'latin1');
  header.writeUInt32LE(rows.length, 4);
  header.writeUInt32LE(width, 8);
  header.writeUInt32LE(size, 12);
  header.writeUInt32LE(stringBlock.length, 16);
  writeFileSync(path, Buffer.concat([header, records, stringBlock]));
}

export function withDbc(options, run) {
  const dir = mkdtempSync(join(tmpdir(), 'wow-ops-dbc-'));
  const path = join(dir, options.name ?? 'Test.dbc');
  try {
    writeDbc(path, options);
    return run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
