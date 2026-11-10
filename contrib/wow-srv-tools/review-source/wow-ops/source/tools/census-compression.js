import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfigFile } from '../server/config.js';
import { openArchive } from './mpq/archive.js';

// A fixed sample rather than the whole archive: the question is which codecs
// appear at all, and a handful of files answers it as well as ten thousand
// would. The names are chosen so the sample is not confined to one archive:
// the first group resolves in interface.MPQ, the second in patch.MPQ, which
// is where a sixth of the extracted art actually comes from. A sample that
// only interface.MPQ answers reports "matched 0/10" for the patch archives
// and tells you nothing about the very files whose codecs override the base.
const SAMPLE = [
  'Interface\\Icons\\INV_Misc_QuestionMark.blp',
  'Interface\\Icons\\INV_Misc_Rune_01.blp',
  'Interface\\Icons\\Spell_Fire_Flamebolt.blp',
  'Interface\\Icons\\Spell_Holy_Renew.blp',
  'Interface\\Icons\\INV_Sword_04.blp',
  'Interface\\Icons\\Ability_Warrior_Charge.blp',
  'Interface\\Icons\\INV_Potion_51.blp',
  'Interface\\Icons\\Trade_Engineering.blp',
  'Interface\\WorldMap\\Durotar\\Durotar1.blp',
  'Interface\\WorldMap\\Elwynn\\Elwynn1.blp',
  'Interface\\Icons\\Spell_Nature_NullifyPoison.blp',
  'Interface\\Icons\\Spell_Shadow_ShadowWordPain.blp',
  'Interface\\Icons\\Ability_Poisons.blp',
  'Interface\\Icons\\INV_Misc_Ammo_Gunpowder_02.blp'
];

const FLAG_IMPLODE = 0x00000100;
const FLAG_COMPRESS = 0x00000200;
const FLAG_ENCRYPTED = 0x00010000;
const FLAG_SINGLE_UNIT = 0x01000000;

// For a single unit the method byte is the first byte. For a multi-sector
// file it sits wherever the sector table's first entry points - which is not
// the same as the end of the table. A file carrying sector CRCs has one extra
// entry, so assuming the table's length lands inside the table and prints one
// of its own bytes as a codec. That is how this census reported methods 0x66,
// 0x67, 0x9a and 0xcd for four patch.MPQ icons that are plain zlib, and every
// one of those is a number no MPQ stores. Reading the entry rather than
// computing where it ends removes the assumption altogether.
//
// An encrypted file's stored bytes are ciphertext, so the byte cannot be read
// as a method at all - reading it anyway would print a wrong answer that
// looks exactly like a right one.
export function methodFor(mpq, block) {
  if (block.flags & FLAG_ENCRYPTED) return 'encrypted (ciphertext, method unknown)';
  if (block.flags & FLAG_IMPLODE) return 'implode (0x08 whole-file)';
  if (!(block.flags & FLAG_COMPRESS)) return 'stored';
  let at = block.filePos;
  if (!(block.flags & FLAG_SINGLE_UNIT)) at += mpq.read(block.filePos, 4).readUInt32LE(0);
  return `0x${mpq.read(at, 1)[0].toString(16).padStart(2, '0')}`;
}

export function census(dataDir, log = console.log) {
  const tally = new Map();
  for (const name of ['patch-2.MPQ', 'patch.MPQ', 'interface.MPQ']) {
    let mpq;
    try {
      mpq = openArchive(join(dataDir, name));
    } catch (err) {
      // An archive that never opened and one that opened but matched nothing
      // both leave the tally untouched; without this line the two are
      // indistinguishable in the output, which is exactly what produced the
      // wrong client diagnosis on the first pass at this census.
      log(`${name}: did not open (${err.message})`);
      continue;
    }
    try {
      let matched = 0;
      for (const file of SAMPLE) {
        const block = mpq.findFile(file);
        if (!block) continue;
        matched++;
        const key = `${name} ${methodFor(mpq, block)}`;
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
      log(`${name}: opened, matched ${matched}/${SAMPLE.length} sampled files`);
    } finally {
      mpq.close();
    }
  }
  return tally;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const here = dirname(fileURLToPath(import.meta.url));
  const cfg = readConfigFile(join(here, '..', 'config.json'));
  if (!cfg.client) {
    console.error('config.json needs a "client" section. See config.example.json.');
    process.exit(1);
  }
  for (const [key, count] of [...census(cfg.client.dataDir)].sort()) console.log(`${count}\t${key}`);
}
