// A minimal MPQ writer, for tests only. The reader under tools/mpq/ has no
// synthetic fixture otherwise: every archive on this machine is a real client
// archive, so the paths the client happens not to use - an encrypted file, a
// file stored across several sectors without compression - could only be
// exercised by hope. This builds those archives byte by byte.
//
// It is deliberately written from the format, not from the reader: the
// encryption here is the inverse of the reader's, spelled out again rather
// than imported, so a test passes only when the two independently agree.
//
// What that does and does not establish. The cipher is genuinely independent -
// its crypt table is rebuilt here and encryptBuffer is derived from the format,
// not from decryptBuffer. The *conventions* are not: that FIX_KEY mixes in
// (filePos, fileSize), that the sector table is keyed at key - 1, that sector i
// takes key + i, and that offsets are relative to filePos are agreed by
// construction between this writer and the reader. They match the format as
// documented, and no file in this client's archives is encrypted, so nothing
// here cross-checks them against a real archive. A test built on this fixture
// proves the reader is self-consistent with the format as understood; the live
// tests are what tie that understanding to real bytes.
import { deflateSync } from 'node:zlib';
import { hashString, HASH_TABLE_OFFSET, HASH_NAME_A, HASH_NAME_B, HASH_FILE_KEY } from '../../tools/mpq/crypt.js';

const MPQ_MAGIC = 0x1A51504D;
const HEADER_SIZE = 32;
const HASH_ENTRY_EMPTY = 0xFFFFFFFF;

export const FLAG_IMPLODE = 0x00000100;
export const FLAG_COMPRESS = 0x00000200;
export const FLAG_ENCRYPTED = 0x00010000;
export const FLAG_FIX_KEY = 0x00020000;
export const FLAG_SINGLE_UNIT = 0x01000000;
export const FLAG_SECTOR_CRC = 0x04000000;
export const FLAG_EXISTS = 0x80000000;

const COMPRESSION_ZLIB = 0x02;

// The crypt table is rebuilt here rather than imported so the encryption side
// of every test is independent of the code under test.
const CRYPT_TABLE = (() => {
  const table = new Uint32Array(0x500);
  let seed = 0x00100001;
  for (let index1 = 0; index1 < 0x100; index1++) {
    for (let index2 = index1, i = 0; i < 5; i++, index2 += 0x100) {
      seed = (seed * 125 + 3) % 0x2AAAAB;
      const high = (seed & 0xFFFF) << 16;
      seed = (seed * 125 + 3) % 0x2AAAAB;
      table[index2] = ((high | (seed & 0xFFFF)) >>> 0);
    }
  }
  return table;
})();

export function encryptBuffer(buf, key) {
  let k = key >>> 0;
  let seed = 0xEEEEEEEE;
  for (let i = 0; i + 4 <= buf.length; i += 4) {
    seed = (seed + CRYPT_TABLE[0x400 + (k & 0xFF)]) >>> 0;
    const plain = buf.readUInt32LE(i);
    buf.writeUInt32LE((plain ^ ((k + seed) >>> 0)) >>> 0, i);
    k = ((((~k) << 0x15) + 0x11111111) | (k >>> 0x0B)) >>> 0;
    seed = (plain + seed + (seed << 5) + 3) >>> 0;
  }
}

function fileKey(name, filePos, fileSize, flags) {
  let key = hashString(name.split('\\').pop(), HASH_FILE_KEY);
  if (flags & FLAG_FIX_KEY) key = ((key + filePos) ^ fileSize) >>> 0;
  return key >>> 0;
}

// One sector per sectorSize bytes of the file, the last holding whatever is
// left. That is what makes the multi-sector paths reachable: a file shorter
// than one sector never takes them.
function storedSectors(data, sectorSize, compress) {
  const sectors = [];
  for (let at = 0; at < data.length; at += sectorSize) {
    const plain = data.subarray(at, Math.min(at + sectorSize, data.length));
    if (!compress) {
      sectors.push(Buffer.from(plain));
      continue;
    }
    const body = deflateSync(plain);
    // The format stores a sector verbatim when compression did not pay off,
    // signalled by its stored length matching its plain length.
    sectors.push(body.length + 1 >= plain.length
      ? Buffer.from(plain)
      : Buffer.concat([Buffer.from([COMPRESSION_ZLIB]), body]));
  }
  return sectors;
}

function encodeFile(name, data, flags, sectorSize, filePos) {
  const encrypted = Boolean(flags & FLAG_ENCRYPTED);
  const compressed = Boolean(flags & FLAG_COMPRESS);
  const key = encrypted ? fileKey(name, filePos, data.length, flags) : 0;

  if (flags & FLAG_SINGLE_UNIT) {
    let body = compressed
      ? Buffer.concat([Buffer.from([COMPRESSION_ZLIB]), deflateSync(data)])
      : Buffer.from(data);
    if (body.length >= data.length && compressed) body = Buffer.from(data);
    if (encrypted) encryptBuffer(body, key);
    return body;
  }

  const sectors = storedSectors(data, sectorSize, compressed);
  if (!compressed) {
    // No offset table at all: an uncompressed multi-sector file is just its
    // sectors end to end, and each is keyed with key + its index.
    const parts = sectors.map((sector, i) => {
      const copy = Buffer.from(sector);
      if (encrypted) encryptBuffer(copy, (key + i) >>> 0);
      return copy;
    });
    return Buffer.concat(parts);
  }

  // One offset per sector plus the end offset - and one more when the file
  // carries sector CRCs, which are stored as an extra pseudo-sector after the
  // data. That extra entry is the whole reason a reader cannot get the first
  // sector's position by computing where the table ends.
  const crcSector = (flags & FLAG_SECTOR_CRC) ? Buffer.alloc(sectors.length * 4) : null;
  const entries = sectors.length + 1 + (crcSector ? 1 : 0);
  const table = Buffer.alloc(entries * 4);
  let offset = table.length;
  table.writeUInt32LE(offset, 0);
  [...sectors, ...(crcSector ? [crcSector] : [])].forEach((sector, i) => {
    offset += sector.length;
    table.writeUInt32LE(offset, (i + 1) * 4);
  });
  if (encrypted) encryptBuffer(table, (key - 1) >>> 0);
  const body = sectors.map((sector, i) => {
    const copy = Buffer.from(sector);
    if (encrypted) encryptBuffer(copy, (key + i) >>> 0);
    return copy;
  });
  return Buffer.concat([table, ...body, ...(crcSector ? [crcSector] : [])]);
}

// files: [{ name, data, flags }]. `prefixSectors` puts that many 512-byte
// blocks before the header, which is how a real archive appended to another
// file is shaped.
export function buildArchive(files, { sectorSize = 512, hashTableSize = 16, prefixSectors = 0, formatVersion = 0 } = {}) {
  const sectorShift = Math.log2(sectorSize / 512);
  if (!Number.isInteger(sectorShift)) throw new Error('sectorSize must be 512 << n');

  const blobs = [];
  let filePos = HEADER_SIZE;
  const blocks = files.map(({ name, data, flags }) => {
    const stored = encodeFile(name, data, flags, sectorSize, filePos);
    blobs.push(stored);
    const block = { filePos, compressedSize: stored.length, fileSize: data.length, flags };
    filePos += stored.length;
    return block;
  });

  const hashTable = Buffer.alloc(hashTableSize * 16, 0xFF);
  files.forEach(({ name }, index) => {
    const start = hashString(name, HASH_TABLE_OFFSET) & (hashTableSize - 1);
    for (let probe = 0; probe < hashTableSize; probe++) {
      const at = ((start + probe) & (hashTableSize - 1)) * 16;
      if (hashTable.readUInt32LE(at + 12) !== HASH_ENTRY_EMPTY) continue;
      hashTable.writeUInt32LE(hashString(name, HASH_NAME_A), at);
      hashTable.writeUInt32LE(hashString(name, HASH_NAME_B), at + 4);
      hashTable.writeUInt32LE(0, at + 8); // locale and platform
      hashTable.writeUInt32LE(index, at + 12);
      return;
    }
    throw new Error(`hash table full: ${name}`);
  });
  encryptBuffer(hashTable, hashString('(hash table)', HASH_FILE_KEY));

  const blockTable = Buffer.alloc(blocks.length * 16);
  blocks.forEach((block, i) => {
    blockTable.writeUInt32LE(block.filePos, i * 16);
    blockTable.writeUInt32LE(block.compressedSize, i * 16 + 4);
    blockTable.writeUInt32LE(block.fileSize, i * 16 + 8);
    blockTable.writeUInt32LE(block.flags >>> 0, i * 16 + 12);
  });
  encryptBuffer(blockTable, hashString('(block table)', HASH_FILE_KEY));

  const hashTablePos = filePos;
  const blockTablePos = hashTablePos + hashTable.length;

  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32LE(MPQ_MAGIC, 0);
  header.writeUInt32LE(HEADER_SIZE, 4);
  header.writeUInt32LE(blockTablePos + blockTable.length, 8);
  header.writeUInt16LE(formatVersion, 12);
  header.writeUInt16LE(sectorShift, 14);
  header.writeUInt32LE(hashTablePos, 16);
  header.writeUInt32LE(blockTablePos, 20);
  header.writeUInt32LE(hashTableSize, 24);
  header.writeUInt32LE(blocks.length, 28);

  // The header must land on a 512-byte boundary, which is the only alignment
  // the reader scans for.
  const pad = Buffer.alloc(prefixSectors * 512);
  return Buffer.concat([pad, header, ...blobs, hashTable, blockTable]);
}
