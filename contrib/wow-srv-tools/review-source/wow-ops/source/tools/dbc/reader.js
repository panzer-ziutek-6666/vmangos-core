import { readFileSync } from 'node:fs';

// A DBC is a header, a block of fixed-size records and a string block. Every
// field is four bytes; a string field holds an offset into the string block,
// which is why a "field index" is all a caller ever needs.
export function readDbc(path) {
  const buf = readFileSync(path);
  if (buf.subarray(0, 4).toString('latin1') !== 'WDBC') throw new Error(`${path}: not a DBC file`);
  const recordCount = buf.readUInt32LE(4);
  const fieldCount = buf.readUInt32LE(8);
  const recordSize = buf.readUInt32LE(12);
  const stringBlockSize = buf.readUInt32LE(16);
  const recordsAt = 20;
  const stringsAt = recordsAt + recordCount * recordSize;
  if (stringsAt + stringBlockSize > buf.length) throw new Error(`${path}: truncated`);
  // Every field is four bytes, so the fields must fit inside the record the
  // header itself declares. Without this a header claiming more fields than
  // its records hold reads across the record boundary into the next row -
  // in range of the file, so the truncation check above passes, and quietly
  // wrong rather than an error. Cycle 2 reads far more of these files than
  // the art names needed, so it is worth refusing here.
  if (fieldCount * 4 > recordSize) {
    throw new Error(`${path}: header claims ${fieldCount} fields but records are only ${recordSize} bytes`);
  }

  const at = (row, field) => {
    if (row < 0 || row >= recordCount) throw new RangeError(`row ${row} out of range`);
    if (field < 0 || field >= fieldCount) throw new RangeError(`field ${field} out of range`);
    return recordsAt + row * recordSize + field * 4;
  };

  return {
    path,
    recordCount,
    fieldCount,
    recordSize,
    uint: (row, field) => buf.readUInt32LE(at(row, field)),
    float: (row, field) => buf.readFloatLE(at(row, field)),
    string(row, field) {
      const offset = buf.readUInt32LE(at(row, field));
      if (offset === 0 || offset >= stringBlockSize) return '';
      const start = stringsAt + offset;
      const blockEnd = stringsAt + stringBlockSize;
      const end = buf.indexOf(0, start);
      return buf.subarray(start, end === -1 || end > blockEnd ? blockEnd : end).toString('latin1');
    }
  };
}
