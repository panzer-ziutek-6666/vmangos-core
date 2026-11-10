import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfigFile } from '../server/config.js';
import { openArchive, UnsupportedCompressionError } from './mpq/archive.js';
import { spellIconPaths, itemIconCandidates, worldMapDirectories, worldMapOverlays, talentBackgrounds, TALENT_PARTS, ICON_DIR } from './dbc/artNames.js';
import { decodeBlp, UnsupportedBlpError } from './blp/decode.js';
import { encodePng } from './png/encode.js';

// Later archives in this list lose to earlier ones. The 1.12 patches replace
// art that interface.MPQ still contains, so reading the base archive alone
// would quietly produce pre-patch icons.
const ARCHIVES = ['patch-2.MPQ', 'patch.MPQ', 'interface.MPQ'];
export const MAP_TILES = 12;

function openArchives(dataDir) {
  const open = [];
  try {
    for (const name of ARCHIVES) {
      const path = join(dataDir, name);
      if (existsSync(path)) open.push(openArchive(path));
    }
  } catch (err) {
    // A failure partway through the loop still leaves earlier archives open;
    // this function throws before returning anything the caller could close,
    // so it has to close what it already opened itself.
    for (const archive of open) archive.close();
    throw err;
  }
  if (open.length === 0) throw new Error(`no MPQ archives found under the configured client data directory`);
  return {
    read(name) {
      for (const archive of open) {
        if (archive.findFile(name)) return archive.readFile(name);
      }
      return null;
    },
    close() {
      for (const archive of open) archive.close();
    }
  };
}

function convert(archives, sourceName, targetPath) {
  const raw = archives.read(sourceName);
  if (!raw) return 'missing';
  const image = decodeBlp(raw);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, encodePng(image));
  return 'written';
}

// Spell-icon paths come first: they are exact paths read from the client's
// own data and nearly all resolve, so a limited run (a smoke test, or a run
// capped while chasing a miss) actually exercises real archive hits instead
// of stalling on item-candidate junk. Item candidates are mostly model and
// texture names that exist only to be tested against the archive - useful
// for the full run's miss report, not for a limited one. Each group is
// sorted on its own so the order stays deterministic.
//
// De-duplication keys on the lower-cased path, not the path itself: the
// archive lookup is case-insensitive (MPQ name hashing uppercases before
// hashing) and the output filename is lowercased, so two targets differing
// only in case would both resolve, both count as written, and silently
// overwrite the same output file. Folding case here, before either list is
// built, means that collision is caught regardless of which group - or
// which order within a group - produced the second spelling.
//
// Each target carries the group it came from, because a miss means opposite
// things in the two groups. See ICON_GROUPS for what that buys.
function iconTargets(dbcDir) {
  const seen = new Set();
  function addUnique(path, into) {
    const key = path.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    into.push(path);
  }
  const spellIcons = [];
  for (const path of spellIconPaths(dbcDir)) addUnique(path, spellIcons);
  spellIcons.sort();
  const itemIcons = [];
  for (const candidate of itemIconCandidates(dbcDir)) addUnique(`${ICON_DIR}${candidate}.blp`, itemIcons);
  itemIcons.sort();
  return [
    ...spellIcons.map((path) => ({ path, group: 'spell' })),
    ...itemIcons.map((path) => ({ path, group: 'item' }))
  ];
}

// A spell-icon path is an exact path read from the client's own data, so
// nearly all of them resolve and a miss there carries information: on this
// client 19 of 1019 are cut content the archives genuinely do not ship, and
// a number much above that means a name list or the archive precedence
// broke. An item candidate is a guess offered to the archive on purpose, so
// about 90% of them miss on a perfectly healthy run. One combined figure
// buries the first signal inside the second - a break that dropped every
// asset coming from patch.MPQ would move the combined number by roughly 2.5%
// and nobody would see it. Counting the groups separately keeps the small,
// meaningful number visible and gives a later run something to regress
// against.
const ICON_GROUPS = { spell: 'spell icons', item: 'item candidates' };

// Failures are dominated by "not in any archive" from the item candidates,
// so printing the first twenty of them says nothing. One line per distinct
// reason, largest first, does: a compression or decode reason appearing at
// all is the interesting outcome, however few times it happened.
export function summarizeFailures(failures) {
  const byReason = new Map();
  for (const failure of failures) {
    const group = byReason.get(failure.reason) ?? { reason: failure.reason, count: 0, examples: [] };
    group.count++;
    if (group.examples.length < 3) group.examples.push(failure.name);
    byReason.set(failure.reason, group);
  }
  return [...byReason.values()].sort((a, b) => b.count - a.count);
}

function tally() {
  return { written: 0, missing: 0, failed: 0 };
}

function line(label, counts) {
  return `${label}: ${counts.written} written, ${counts.missing} missing, ${counts.failed} failed`;
}

export async function extractArt({ client, assets, limit = Infinity, log = console.log }) {
  const archives = openArchives(client.dataDir);
  const report = {
    // byGroup rather than two more keys beside written/missing/failed: a
    // group named after an outcome would otherwise collide with the headline
    // counters and corrupt them silently.
    icons: { ...tally(), byGroup: { spell: tally(), item: tally() } },
    maps: tally(),
    overlays: tally(),
    talents: tally(),
    failures: []
  };
  try {
    const icons = iconTargets(client.dbcDir).slice(0, limit === Infinity ? undefined : limit);
    for (const { path: source, group } of icons) {
      // Lowercased on the way out: the archive is case-insensitive and the
      // web layer will not be, so one spelling has to win here.
      const base = source.split('\\').pop().replace(/\.blp$/i, '').toLowerCase();
      let outcome;
      try {
        outcome = convert(archives, source, join(assets.root, 'icons', `${base}.png`));
        if (outcome === 'missing') report.failures.push({ name: source, reason: 'not in any archive' });
      } catch (err) {
        outcome = 'failed';
        report.failures.push({ name: source, reason: reasonFor(err) });
      }
      report.icons[outcome]++;
      report.icons.byGroup[group][outcome]++;
    }
    log(line('icons', report.icons));
    for (const [group, label] of Object.entries(ICON_GROUPS)) log(`  ${line(label, report.icons.byGroup[group])}`);

    if (limit === Infinity) {
      for (const zone of worldMapDirectories(client.dbcDir)) {
        for (let tile = 1; tile <= MAP_TILES; tile++) {
          const source = `Interface\\WorldMap\\${zone}\\${zone}${tile}.blp`;
          const target = join(assets.root, 'maps', zone.toLowerCase(), `${tile}.png`);
          try {
            const outcome = convert(archives, source, target);
            report.maps[outcome]++;
            if (outcome === 'missing') report.failures.push({ name: source, reason: 'not in any archive' });
          } catch (err) {
            report.maps.failed++;
            report.failures.push({ name: source, reason: reasonFor(err) });
          }
        }
      }
      log(line('maps', report.maps));

      // Each explored area's overlay tiles, written beside the zone's own map
      // tiles so the zone page reads both from one directory.
      for (const { zone, texture, tiles } of worldMapOverlays(client.dbcDir)) {
        for (let tile = 1; tile <= tiles; tile++) {
          const source = `Interface\\WorldMap\\${zone}\\${texture}${tile}.blp`;
          const target = join(assets.root, 'maps', zone.toLowerCase(), 'overlays', `${texture.toLowerCase()}${tile}.png`);
          try {
            const outcome = convert(archives, source, target);
            report.overlays[outcome]++;
            if (outcome === 'missing') report.failures.push({ name: source, reason: 'not in any archive' });
          } catch (err) {
            report.overlays.failed++;
            report.failures.push({ name: source, reason: reasonFor(err) });
          }
        }
      }
      log(line('overlays', report.overlays));

      for (const background of talentBackgrounds(client.dbcDir)) {
        for (const part of TALENT_PARTS) {
          const source = `Interface\\TalentFrame\\${background}-${part}.blp`;
          const target = join(assets.root, 'talents', background.toLowerCase(), `${part}.png`);
          try {
            const outcome = convert(archives, source, target);
            report.talents[outcome]++;
            if (outcome === 'missing') report.failures.push({ name: source, reason: 'not in any archive' });
          } catch (err) {
            report.talents.failed++;
            report.failures.push({ name: source, reason: reasonFor(err) });
          }
        }
      }
      log(line('talents', report.talents));
    }
  } finally {
    archives.close();
  }
  return report;
}

// A codec this tool does not implement is a measurement, not a crash: the run
// finishes and says how much art it could not convert and why.
function reasonFor(err) {
  if (err instanceof UnsupportedCompressionError) return `compression 0x${err.method.toString(16)}`;
  if (err instanceof UnsupportedBlpError) return `blp ${err.reason}`;
  return err.message;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const here = dirname(fileURLToPath(import.meta.url));
  const cfg = readConfigFile(join(here, '..', 'config.json'));
  if (!cfg.client || !cfg.assets) {
    console.error('config.json needs a "client" section and an "assets" section. See config.example.json.');
    process.exit(1);
  }
  const report = await extractArt({ client: cfg.client, assets: cfg.assets });
  for (const group of summarizeFailures(report.failures)) {
    console.error(`  ${group.count} x ${group.reason} (e.g. ${group.examples.join(', ')})`);
  }
}
