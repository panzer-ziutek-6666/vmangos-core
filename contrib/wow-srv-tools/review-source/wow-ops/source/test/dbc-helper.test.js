import test from 'node:test';
import assert from 'node:assert/strict';
import { readDbc } from '../tools/dbc/reader.js';
import { withDbc } from './helpers/dbc.js';

test('writes uint, float and string fields the reader reads back', () => {
  withDbc({ rows: [[7, { float: 1.5 }, { str: 'first' }], [8, { float: -2.25 }, { str: 'second' }]] }, (path) => {
    const dbc = readDbc(path);
    assert.equal(dbc.recordCount, 2);
    assert.equal(dbc.fieldCount, 3);
    assert.equal(dbc.uint(0, 0), 7);
    assert.equal(dbc.float(1, 1), -2.25);
    assert.equal(dbc.string(0, 2), 'first');
    assert.equal(dbc.string(1, 2), 'second');
  });
});

test('an empty string writes offset zero, which the reader returns as empty', () => {
  withDbc({ rows: [[1, { str: '' }]] }, (path) => {
    assert.equal(readDbc(path).string(0, 1), '');
  });
});

test('the same string is written once and shared', () => {
  withDbc({ rows: [[1, { str: 'shared' }], [2, { str: 'shared' }]] }, (path) => {
    const dbc = readDbc(path);
    assert.equal(dbc.string(0, 1), 'shared');
    assert.equal(dbc.uint(0, 1), dbc.uint(1, 1));
  });
});

test('an explicit recordSize larger than the fields leaves padding', () => {
  withDbc({ rows: [[1, 2]], fieldCount: 2, recordSize: 16 }, (path) => {
    const dbc = readDbc(path);
    assert.equal(dbc.recordSize, 16);
    assert.equal(dbc.uint(0, 1), 2);
  });
});
