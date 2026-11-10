import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { hashString, decryptBuffer, HASH_TABLE_OFFSET, HASH_NAME_A, HASH_NAME_B, HASH_FILE_KEY } from './crypt.js';

const MPQ_MAGIC = 0x1A51504D; // 'MPQ\x1A'
const HASH_ENTRY_EMPTY = 0xFFFFFFFF;
const HASH_ENTRY_DELETED = 0xFFFFFFFE;

const FLAG_IMPLODE = 0x00000100;
const FLAG_COMPRESS = 0x00000200;
const FLAG_ENCRYPTED = 0x00010000;
const FLAG_FIX_KEY = 0x00020000;
const FLAG_SINGLE_UNIT = 0x01000000;
const FLAG_SECTOR_CRC = 0x04000000;
const FLAG_EXISTS = 0x80000000;

const COMPRESSION_ZLIB = 0x02;
const COMPRESSION_PKWARE = 0x08;

export class UnsupportedCompressionError extends Error {
  constructor(method, name) {
    const known = method === COMPRESSION_PKWARE ? ' (PKWARE DCL)' : '';
    super(`${name}: compression method 0x${method.toString(16)}${known} is not implemented`);
    this.name = 'UnsupportedCompressionError';
    this.method = method;
  }
}

// PKWARE DCL is deliberately not implemented. tools/census-compression.js
// sampled every archive this client ships, across both the icon and world-map
// trees and both the base and the patch archives, and found only zlib and
// stored sectors - and the full extraction, which touches every art file the
// browser will need, reported zero compression failures. Rather than write a
// decoder for a codec no file here uses, an unrecognised method raises the
// typed error above and the extractor counts it per file, so a PKWARE file
// appearing in some later archive becomes a line in the report rather than a
// crash or a corrupt image. A cycle that does add PKWARE support should run
// the census against the archives actually in use first: this note records
// what was true for this client, not a property of the format.

// A sector is stored verbatim when compressing it did not pay off; the format
// signals that by its stored length matching its uncompressed length, with no
// method byte at all. Decompressing such a sector is the classic mistake.
function decompressSector(chunk, expectedSize, name) {
  if (chunk.length >= expectedSize) return chunk.subarray(0, expectedSize);
  const method = chunk[0];
  const body = chunk.subarray(1);
  if (method === COMPRESSION_ZLIB) return inflateSync(body);
  // A recognised codec and an unrecognised byte are the same outcome here -
  // both raise the typed error and both land in the extractor's report - but
  // the error text distinguishes them, because the two mean different things
  // to whoever reads it. See the note beside UnsupportedCompressionError.
  throw new UnsupportedCompressionError(method, name);
}

function readAt(fd, offset, length) {
  const buf = Buffer.allocUnsafe(length);
  let read = 0;
  while (read < length) {
    const got = readSync(fd, buf, read, length - read, offset + read);
    if (got === 0) throw new Error(`unexpected end of archive at ${offset + read}`);
    read += got;
  }
  return buf;
}

// The archive does not have to start at byte 0 - MPQs are routinely appended
// to another file - so the header is searched for on 512-byte boundaries, the
// same alignment the format guarantees.
function findHeader(fd, size) {
  for (let offset = 0; offset + 32 <= size; offset += 512) {
    const probe = readAt(fd, offset, 4);
    if (probe.readUInt32LE(0) === MPQ_MAGIC) return offset;
  }
  throw new Error('no MPQ header found');
}

export function openArchive(path) {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    const base = findHeader(fd, size);
    const header = readAt(fd, base, 32);
    // Version 0 is the original header; version 1 adds 64-bit table offsets in a
    // longer header. This client's patch archives are version 1 and they carry the
    // art that overrides the base archive, so rejecting them would silently extract
    // pre-patch icons. The high halves of those offsets only matter above 4 GB,
    // which no archive here approaches - asserted rather than assumed.
    const formatVersion = header.readUInt16LE(12);
    if (formatVersion > 1) {
      throw new Error(`${path}: MPQ format version ${formatVersion} is not supported`);
    }
    if (size > 0xFFFFFFFF) {
      throw new Error(`${path}: archives above 4 GB need the version 1 high offsets`);
    }
    const sectorSize = 512 << header.readUInt16LE(14);
    const hashTablePos = base + header.readUInt32LE(16);
    const blockTablePos = base + header.readUInt32LE(20);
    const hashTableSize = header.readUInt32LE(24);
    const blockTableSize = header.readUInt32LE(28);

    const hashTable = readAt(fd, hashTablePos, hashTableSize * 16);
    decryptBuffer(hashTable, hashString('(hash table)', HASH_FILE_KEY));
    const blockTable = readAt(fd, blockTablePos, blockTableSize * 16);
    decryptBuffer(blockTable, hashString('(block table)', HASH_FILE_KEY));

    // findFile and read are closures rather than methods on the returned
    // object, so readFile below does not reach through `this` for either of
    // them. A method that does breaks the moment it is destructured off the
    // archive - which nothing here does today, and which is exactly why the
    // breakage would be found by whoever writes that code next.
    const read = (offset, length) => readAt(fd, base + offset, length);

    function findFile(name) {
      const start = hashString(name, HASH_TABLE_OFFSET) & (hashTableSize - 1);
      const wantA = hashString(name, HASH_NAME_A);
      const wantB = hashString(name, HASH_NAME_B);
      for (let probe = 0; probe < hashTableSize; probe++) {
        const at = ((start + probe) & (hashTableSize - 1)) * 16;
        const blockIndex = hashTable.readUInt32LE(at + 12);
        if (blockIndex === HASH_ENTRY_EMPTY) return null; // the chain ends here
        if (blockIndex === HASH_ENTRY_DELETED) continue;
        if (hashTable.readUInt32LE(at) !== wantA) continue;
        if (hashTable.readUInt32LE(at + 4) !== wantB) continue;
        if (blockIndex >= blockTableSize) return null;
        const b = blockIndex * 16;
        return {
          filePos: blockTable.readUInt32LE(b),
          compressedSize: blockTable.readUInt32LE(b + 4),
          fileSize: blockTable.readUInt32LE(b + 8),
          flags: blockTable.readUInt32LE(b + 12)
        };
      }
      return null;
    }

    return {
      path,
      base,
      sectorSize,
      hashTableSize,
      blockTableSize,
      read,
      findFile,
      readFile(name) {
        const block = findFile(name);
        if (!block || !(block.flags & FLAG_EXISTS)) throw new Error(`${name}: not found in ${path}`);

        let key = 0;
        if (block.flags & FLAG_ENCRYPTED) {
          const base = name.split('\\').pop();
          key = hashString(base, HASH_FILE_KEY);
          if (block.flags & FLAG_FIX_KEY) key = ((key + block.filePos) ^ block.fileSize) >>> 0;
        }

        const compressed = Boolean(block.flags & (FLAG_COMPRESS | FLAG_IMPLODE));

        if (block.flags & FLAG_SINGLE_UNIT) {
          const raw = read(block.filePos, block.compressedSize);
          if (block.flags & FLAG_ENCRYPTED) decryptBuffer(raw, key);
          if (!compressed || raw.length >= block.fileSize) return raw.subarray(0, block.fileSize);
          if (block.flags & FLAG_IMPLODE) throw new UnsupportedCompressionError(COMPRESSION_PKWARE, name);
          return decompressSector(raw, block.fileSize, name);
        }

        const sectorCount = Math.ceil(block.fileSize / sectorSize);
        if (!compressed) {
          const raw = read(block.filePos, block.fileSize);
          // Keyed per sector, exactly as the compressed path below is: the
          // format advances the key by the sector index whether or not the
          // sector was compressed. Decrypting the whole file under one key
          // returns garbage for every sector after the first, at the right
          // length and with no error - the one silent-corruption outcome the
          // rest of this module goes out of its way to avoid.
          if (block.flags & FLAG_ENCRYPTED) {
            for (let i = 0; i < sectorCount; i++) {
              decryptBuffer(raw.subarray(i * sectorSize, Math.min((i + 1) * sectorSize, raw.length)), (key + i) >>> 0);
            }
          }
          return raw;
        }

        const entries = sectorCount + 1 + ((block.flags & FLAG_SECTOR_CRC) ? 1 : 0);
        const table = read(block.filePos, entries * 4);
        if (block.flags & FLAG_ENCRYPTED) decryptBuffer(table, (key - 1) >>> 0);

        const out = Buffer.allocUnsafe(block.fileSize);
        let written = 0;
        for (let i = 0; i < sectorCount; i++) {
          const start = table.readUInt32LE(i * 4);
          const end = table.readUInt32LE((i + 1) * 4);
          const chunk = read(block.filePos + start, end - start);
          if (block.flags & FLAG_ENCRYPTED) decryptBuffer(chunk, (key + i) >>> 0);
          const expected = Math.min(sectorSize, block.fileSize - written);
          let plain;
          if (block.flags & FLAG_IMPLODE) {
            plain = chunk.length >= expected ? chunk.subarray(0, expected) : null;
            if (!plain) throw new UnsupportedCompressionError(COMPRESSION_PKWARE, name);
          } else {
            plain = decompressSector(chunk, expected, name);
          }
          plain.copy(out, written);
          written += plain.length;
        }
        if (written !== block.fileSize) {
          throw new Error(`${name}: decompressed ${written} bytes, expected ${block.fileSize}`);
        }
        return out;
      },
      close() {
        closeSync(fd);
      }
    };
  } catch (err) {
    closeSync(fd);
    throw err;
  }
}
