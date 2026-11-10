import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openArchive } from '../tools/mpq/archive.js';
import { methodFor } from '../tools/census-compression.js';
import {
  buildArchive,
  FLAG_COMPRESS,
  FLAG_ENCRYPTED,
  FLAG_IMPLODE,
  FLAG_SINGLE_UNIT,
  FLAG_SECTOR_CRC,
  FLAG_EXISTS
} from './helpers/mpqArchive.js';

const NAME = 'Interface\\Icons\\sample.blp';

function methodOf(data, flags, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wow-ops-census-'));
  const path = join(dir, 'test.MPQ');
  try {
    writeFileSync(path, buildArchive([{ name: NAME, data, flags }], options));
    const archive = openArchive(path);
    try {
      return methodFor(archive, archive.findFile(NAME));
    } finally {
      archive.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function pattern(length) {
  const buf = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i++) buf[i] = (i * 7 + 11) & 0xFF;
  return buf;
}

// This is the case that shipped wrong. Locating the method byte by computing
// where the sector table ends is off by one entry for a file carrying sector
// CRCs, so the read lands inside the table and reports one of its own bytes
// as a codec - which is how the census printed 0x66, 0x67, 0x9a and 0xcd for
// four patch.MPQ icons that are plain zlib. Every icon the extraction takes
// from patch.MPQ has this flag set.
test('a compressed file carrying sector CRCs reports its real method', () => {
  const flags = FLAG_EXISTS | FLAG_COMPRESS | FLAG_SECTOR_CRC;
  assert.equal(methodOf(pattern(1500), flags, { sectorSize: 512 }), '0x02');
});

test('a compressed multi-sector file without CRCs reports its method', () => {
  const flags = FLAG_EXISTS | FLAG_COMPRESS;
  assert.equal(methodOf(pattern(1500), flags, { sectorSize: 512 }), '0x02');
});

test('a single-unit compressed file reports its method', () => {
  assert.equal(methodOf(pattern(1500), FLAG_EXISTS | FLAG_COMPRESS | FLAG_SINGLE_UNIT), '0x02');
});

test('an uncompressed file reports stored rather than reading a byte', () => {
  assert.equal(methodOf(pattern(300), FLAG_EXISTS | FLAG_SINGLE_UNIT), 'stored');
});

// An encrypted file's stored bytes are ciphertext, so reading one as a method
// would print a wrong answer that looks exactly like a right one.
test('an encrypted file is reported as unreadable rather than guessed at', () => {
  const flags = FLAG_EXISTS | FLAG_COMPRESS | FLAG_ENCRYPTED;
  assert.match(methodOf(pattern(1500), flags, { sectorSize: 512 }), /ciphertext/);
});

test('an imploded file is named as PKWARE rather than read', () => {
  assert.match(methodOf(pattern(300), FLAG_EXISTS | FLAG_IMPLODE | FLAG_SINGLE_UNIT), /implode/);
});

// A sector that did not compress carries no method byte at all, so whatever
// the first data byte happens to be is reported. That is honest - the census
// tallies what it reads - and worth pinning so a later change does not start
// inventing a method for it.
test('an incompressible sector reports the byte that is there', () => {
  const data = randomBytes(1500);
  const flags = FLAG_EXISTS | FLAG_COMPRESS;
  assert.equal(methodOf(data, flags, { sectorSize: 512 }), `0x${data[0].toString(16).padStart(2, '0')}`);
});
