import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readDbc } from '../tools/dbc/reader.js';
import { withDbc } from './helpers/dbc.js';

test('records and string fields read back', () => {
  // Offsets into the string block, which starts with the empty string.
  withDbc({ rows: [[1, 1], [2, 7]], fieldCount: 2, recordSize: 8, strings: '\0first\0second\0' }, (path) => {
    const dbc = readDbc(path);
    assert.equal(dbc.recordCount, 2);
    assert.equal(dbc.uint(0, 0), 1);
    assert.equal(dbc.string(0, 1), 'first');
    assert.equal(dbc.string(1, 1), 'second');
  });
});

test('offset zero is the empty string, not the first entry', () => {
  withDbc({ rows: [[1, 0]], fieldCount: 2, recordSize: 8, strings: '\0first\0' }, (path) => {
    assert.equal(readDbc(path).string(0, 1), '');
  });
});

test('a row or field outside the header is refused', () => {
  withDbc({ rows: [[1, 1]], fieldCount: 2, recordSize: 8 }, (path) => {
    const dbc = readDbc(path);
    assert.throws(() => dbc.uint(1, 0), RangeError);
    assert.throws(() => dbc.uint(0, 2), RangeError);
    assert.throws(() => dbc.uint(-1, 0), RangeError);
  });
});

// The truncation check bounds reads inside the file, so a header claiming
// more fields than its records hold produces the next row's bytes rather than
// an error: in range, and quietly wrong.
test('a header claiming more fields than the record holds is refused', () => {
  withDbc({ rows: [[1, 2], [3, 4]], fieldCount: 4, recordSize: 8 }, (path) => {
    assert.throws(() => readDbc(path), /claims 4 fields but records are only 8 bytes/);
  });
});

test('a file that is not a DBC is refused', () => {
  withDbc({ rows: [[1]], fieldCount: 1, recordSize: 4, magic: 'XXXX' }, (path) => {
    assert.throws(() => readDbc(path), /not a DBC file/);
  });
});

test('a file shorter than its header claims is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wow-ops-dbc-'));
  const path = join(dir, 'Short.dbc');
  try {
    const header = Buffer.alloc(20);
    header.write('WDBC', 0, 'latin1');
    header.writeUInt32LE(100, 4); // one hundred records that are not there
    header.writeUInt32LE(1, 8);
    header.writeUInt32LE(4, 12);
    header.writeUInt32LE(0, 16);
    writeFileSync(path, header);
    assert.throws(() => readDbc(path), /truncated/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
