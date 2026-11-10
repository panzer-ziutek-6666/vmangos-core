// MPQ's key schedule. Every table and most file data in the archive is
// encrypted with a key derived from this 0x500-entry table, which the format
// generates from a fixed seed - there is nothing secret in it, it is simply
// how the archive is written.

export const HASH_TABLE_OFFSET = 0;
export const HASH_NAME_A = 1;
export const HASH_NAME_B = 2;
export const HASH_FILE_KEY = 3;

const CRYPT_TABLE = buildCryptTable();

function buildCryptTable() {
  const table = new Uint32Array(0x500);
  let seed = 0x00100001;
  for (let index1 = 0; index1 < 0x100; index1++) {
    for (let index2 = index1, i = 0; i < 5; i++, index2 += 0x100) {
      seed = (seed * 125 + 3) % 0x2AAAAB;
      const high = (seed & 0xFFFF) << 16;
      seed = (seed * 125 + 3) % 0x2AAAAB;
      const low = seed & 0xFFFF;
      table[index2] = (high | low) >>> 0;
    }
  }
  return table;
}

// The client hands the archive Windows paths in whatever case the caller
// typed, so both are normalised before hashing.
function upperByte(byte) {
  return byte >= 0x61 && byte <= 0x7A ? byte - 0x20 : byte;
}

export function hashString(name, type) {
  const bytes = Buffer.from(name.replace(/\//g, '\\'), 'latin1');
  let seed1 = 0x7FED7FED;
  let seed2 = 0xEEEEEEEE;
  for (const raw of bytes) {
    const ch = upperByte(raw);
    seed1 = (CRYPT_TABLE[(type << 8) + ch] ^ ((seed1 + seed2) >>> 0)) >>> 0;
    seed2 = (ch + seed1 + seed2 + (seed2 << 5) + 3) >>> 0;
  }
  return seed1 >>> 0;
}

// Decrypts whole 32-bit words in place. A trailing partial word cannot be
// decrypted and is left alone: the format never produces one, and silently
// mangling it would hide a parsing mistake upstream.
export function decryptBuffer(buf, key) {
  let k = key >>> 0;
  let seed = 0xEEEEEEEE;
  for (let i = 0; i + 4 <= buf.length; i += 4) {
    seed = (seed + CRYPT_TABLE[0x400 + (k & 0xFF)]) >>> 0;
    const plain = (buf.readUInt32LE(i) ^ ((k + seed) >>> 0)) >>> 0;
    k = ((((~k) << 0x15) + 0x11111111) | (k >>> 0x0B)) >>> 0;
    seed = (plain + seed + (seed << 5) + 3) >>> 0;
    buf.writeUInt32LE(plain, i);
  }
}
