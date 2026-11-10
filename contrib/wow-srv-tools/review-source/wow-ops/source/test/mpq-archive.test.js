import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openArchive } from '../tools/mpq/archive.js';
import {
  buildArchive,
  FLAG_COMPRESS,
  FLAG_ENCRYPTED,
  FLAG_FIX_KEY,
  FLAG_SINGLE_UNIT,
  FLAG_SECTOR_CRC,
  FLAG_EXISTS
} from './helpers/mpqArchive.js';

// Synthetic archives, built from the format rather than from the reader, so
// these cover what the real client archives happen not to contain. The live
// tests cover the paths the client does use.
function withArchive(files, options, run) {
  const dir = mkdtempSync(join(tmpdir(), 'wow-ops-mpq-'));
  const path = join(dir, 'test.MPQ');
  writeFileSync(path, buildArchive(files, options));
  const archive = openArchive(path);
  try {
    run(archive);
  } finally {
    archive.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function pattern(length) {
  const buf = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i++) buf[i] = (i * 7 + 11) & 0xFF;
  return buf;
}

test('a single-unit uncompressed file reads back byte for byte', () => {
  const data = pattern(300);
  withArchive([{ name: 'Interface\\Icons\\plain.blp', data, flags: FLAG_EXISTS | FLAG_SINGLE_UNIT }], {}, (archive) => {
    assert.deepEqual(archive.readFile('Interface\\Icons\\plain.blp'), data);
  });
});

test('a compressed multi-sector file reassembles across sector boundaries', () => {
  const data = pattern(1500);
  withArchive([{ name: 'Interface\\Icons\\big.blp', data, flags: FLAG_EXISTS | FLAG_COMPRESS }], { sectorSize: 512 }, (archive) => {
    assert.deepEqual(archive.readFile('Interface\\Icons\\big.blp'), data);
  });
});

test('an encrypted compressed multi-sector file keys each sector separately', () => {
  const data = pattern(1500);
  const flags = FLAG_EXISTS | FLAG_COMPRESS | FLAG_ENCRYPTED;
  withArchive([{ name: 'Interface\\Icons\\secret.blp', data, flags }], { sectorSize: 512 }, (archive) => {
    assert.deepEqual(archive.readFile('Interface\\Icons\\secret.blp'), data);
  });
});

// The bug this pins: an uncompressed file spanning several sectors was
// decrypted as one buffer under a single key, so sectors past the first came
// back as garbage - silently, with no exception and the right byte count.
test('an encrypted uncompressed multi-sector file keys each sector separately', () => {
  const data = pattern(1500);
  const flags = FLAG_EXISTS | FLAG_ENCRYPTED;
  withArchive([{ name: 'Interface\\Icons\\raw.blp', data, flags }], { sectorSize: 512 }, (archive) => {
    assert.deepEqual(archive.readFile('Interface\\Icons\\raw.blp'), data);
  });
});

test('an encrypted uncompressed file inside one sector still reads back', () => {
  const data = pattern(200);
  const flags = FLAG_EXISTS | FLAG_ENCRYPTED;
  withArchive([{ name: 'Interface\\Icons\\small.blp', data, flags }], { sectorSize: 512 }, (archive) => {
    assert.deepEqual(archive.readFile('Interface\\Icons\\small.blp'), data);
  });
});

// FIX_KEY mixes the block's own position and size into the key, so a reader
// that ignores the flag produces garbage for exactly these files.
test('a FIX_KEY encrypted file reads back', () => {
  const data = pattern(1500);
  const flags = FLAG_EXISTS | FLAG_COMPRESS | FLAG_ENCRYPTED | FLAG_FIX_KEY;
  withArchive([{ name: 'Interface\\Icons\\fixed.blp', data, flags }], { sectorSize: 512 }, (archive) => {
    assert.deepEqual(archive.readFile('Interface\\Icons\\fixed.blp'), data);
  });
});

test('lookup is case-insensitive and accepts forward slashes', () => {
  const data = pattern(64);
  withArchive([{ name: 'Interface\\Icons\\Case.blp', data, flags: FLAG_EXISTS | FLAG_SINGLE_UNIT }], {}, (archive) => {
    assert.ok(archive.findFile('interface\\icons\\case.blp'));
    assert.ok(archive.findFile('Interface/Icons/Case.blp'));
  });
});

// Neither reaches through `this`, so both keep working when they are taken
// off the archive. Nothing here destructures them today; this is what stops
// the next caller who does from finding out the hard way.
test('findFile and readFile work when they are taken off the archive', () => {
  const data = pattern(1500);
  const files = [{ name: 'Interface\\Icons\\a.blp', data, flags: FLAG_EXISTS | FLAG_COMPRESS }];
  withArchive(files, { sectorSize: 512 }, (archive) => {
    const { findFile, readFile } = archive;
    assert.ok(findFile('Interface\\Icons\\a.blp'));
    assert.deepEqual(readFile('Interface\\Icons\\a.blp'), data);
  });
});

// A file carrying sector CRCs has one more offset-table entry than its sector
// count implies. Every icon this extraction reads out of patch.MPQ is such a
// file, and computing where the table ends instead of reading its first entry
// is what made the compression census report four impossible codecs.
test('a file carrying sector CRCs reads back', () => {
  const data = pattern(1500);
  const files = [{ name: 'Interface\\Icons\\crc.blp', data, flags: FLAG_EXISTS | FLAG_COMPRESS | FLAG_SECTOR_CRC }];
  withArchive(files, { sectorSize: 512 }, (archive) => {
    assert.deepEqual(archive.readFile('Interface\\Icons\\crc.blp'), data);
  });
});

// A sector that did not compress is stored verbatim, with no method byte at
// all - the format signals it by the stored length matching the plain one.
// Inflating such a sector is the classic mistake, and random bytes are the
// only way to reach the branch that avoids it.
test('an incompressible file is stored verbatim and read back', () => {
  const data = randomBytes(1500);
  const files = [{ name: 'Interface\\Icons\\noise.blp', data, flags: FLAG_EXISTS | FLAG_COMPRESS }];
  withArchive(files, { sectorSize: 512 }, (archive) => {
    assert.deepEqual(archive.readFile('Interface\\Icons\\noise.blp'), data);
  });
});

// A sector size other than the 512 default, with a final sector that is not a
// whole number of 4-byte words - the partial word the decrypt loop leaves
// alone.
test('a non-default sector size and a ragged final sector read back', () => {
  const data = pattern(9001);
  const files = [{ name: 'Interface\\Icons\\ragged.blp', data, flags: FLAG_EXISTS | FLAG_ENCRYPTED }];
  withArchive(files, { sectorSize: 4096 }, (archive) => {
    assert.deepEqual(archive.readFile('Interface\\Icons\\ragged.blp'), data);
  });
});

test('a name not in the archive resolves to null rather than throwing', () => {
  const data = pattern(64);
  withArchive([{ name: 'Interface\\Icons\\a.blp', data, flags: FLAG_EXISTS | FLAG_SINGLE_UNIT }], {}, (archive) => {
    assert.equal(archive.findFile('Interface\\Icons\\absent.blp'), null);
    assert.throws(() => archive.readFile('Interface\\Icons\\absent.blp'), /not found/);
  });
});

// MPQs are routinely appended to another file, so the header is searched for
// on 512-byte boundaries rather than assumed to be at zero.
test('a header past byte zero is found', () => {
  const data = pattern(64);
  const files = [{ name: 'Interface\\Icons\\a.blp', data, flags: FLAG_EXISTS | FLAG_SINGLE_UNIT }];
  withArchive(files, { prefixSectors: 3 }, (archive) => {
    assert.equal(archive.base, 1536);
    assert.deepEqual(archive.readFile('Interface\\Icons\\a.blp'), data);
  });
});

// Only that the version check lets a 1 through: this writes a version 0
// layout with a 1 in the version field, not a real version 1 header, which is
// 44 bytes with 64-bit table offsets. Reading a genuine one is covered by the
// live tests, since both patch archives are version 1.
test('the version check accepts 1, which the patch archives declare', () => {
  const data = pattern(64);
  const files = [{ name: 'Interface\\Icons\\a.blp', data, flags: FLAG_EXISTS | FLAG_SINGLE_UNIT }];
  withArchive(files, { formatVersion: 1 }, (archive) => {
    assert.deepEqual(archive.readFile('Interface\\Icons\\a.blp'), data);
  });
});

test('a future header version is refused rather than misread', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wow-ops-mpq-'));
  const path = join(dir, 'v2.MPQ');
  const files = [{ name: 'a.blp', data: pattern(64), flags: FLAG_EXISTS | FLAG_SINGLE_UNIT }];
  try {
    writeFileSync(path, buildArchive(files, { formatVersion: 2 }));
    assert.throws(() => openArchive(path), /format version 2 is not supported/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file with no MPQ header at all is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wow-ops-mpq-'));
  const path = join(dir, 'not-an-archive.MPQ');
  try {
    writeFileSync(path, Buffer.alloc(2048, 0x41));
    assert.throws(() => openArchive(path), /no MPQ header found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
