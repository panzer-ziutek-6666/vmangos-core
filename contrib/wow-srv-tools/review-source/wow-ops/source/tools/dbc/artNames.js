import { join } from 'node:path';
import { readDbc } from './reader.js';

const ICON_DIR = 'Interface\\Icons\\';

// SpellIcon.dbc stores a full texture path without the extension. One record
// points to Spells\Icon\, a directory that does not exist in the archive; its
// basename resolves correctly under Interface\Icons\. Normalize all paths to
// the canonical icon directory.
export function iconPathFor(rawPath) {
  const normalized = rawPath.replace(/\//g, '\\');
  const basename = normalized.split('\\').pop();
  return `${ICON_DIR}${basename}.blp`;
}

export function spellIconPaths(dbcDir) {
  const dbc = readDbc(join(dbcDir, 'SpellIcon.dbc'));
  const out = new Set();
  for (let row = 0; row < dbc.recordCount; row++) {
    const raw = dbc.string(row, 1).trim();
    if (!raw) continue;
    out.add(iconPathFor(raw));
  }
  return [...out];
}

// ItemDisplayInfo.dbc holds model names, textures and the inventory icon in
// separate string columns, and the column index differs between builds.
// Rather than trusting an index, collect every string that looks like an icon
// name (no dots, no spaces; icon names are simple identifiers like INV_Robe_02).
// Drop model and texture filenames (.mdx, .blp) and paths with spaces, as they
// are never icon names. The archive then decides which candidates are real icons.
export function itemIconCandidates(dbcDir) {
  const dbc = readDbc(join(dbcDir, 'ItemDisplayInfo.dbc'));
  const out = new Set();
  for (let row = 0; row < dbc.recordCount; row++) {
    for (let field = 0; field < dbc.fieldCount; field++) {
      const value = dbc.string(row, field).trim();
      if (value && /^[\w-]+$/.test(value)) out.add(value);
    }
  }
  return [...out];
}

// Zone maps live at Interface\WorldMap\<name>\<name><1..12>.blp, where <name>
// is WorldMapArea.dbc's internal area name - field 3, the string the core
// skips when it reads this file as "xinxffff".
export function worldMapDirectories(dbcDir) {
  const dbc = readDbc(join(dbcDir, 'WorldMapArea.dbc'));
  const out = new Set();
  for (let row = 0; row < dbc.recordCount; row++) {
    const name = dbc.string(row, 3).trim();
    if (name) out.add(name);
  }
  return [...out];
}

// A talent tree's background is four textures,
// Interface\TalentFrame\<name>-{TopLeft,TopRight,BottomLeft,BottomRight}.blp,
// where <name> is TalentTab.dbc's field 14 (m_backgroundFile,
// vmangos-core/src/game/Database/DBCStructure.h:685) - skipped by the core,
// read here the way worldMapDirectories reads WorldMapArea.dbc.
export const TALENT_PARTS = ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'];

export function talentBackgrounds(dbcDir) {
  const dbc = readDbc(join(dbcDir, 'TalentTab.dbc'));
  const out = new Set();
  for (let row = 0; row < dbc.recordCount; row++) {
    const name = dbc.string(row, 14).trim();
    if (name) out.add(name);
  }
  return [...out];
}

// The client's world map paints each explored area over a zone's parchment
// from WorldMapOverlay.dbc (WorldMapOverlayEntry,
// vmangos-core/src/game/Database/DBCStructure.h:752-768): the texture name is
// field 8, its width and height 9-10, and field 1 names the WorldMapArea row
// whose internal name (its field 3) is the directory the textures sit in,
// Interface\WorldMap\<zone>\<texture><n>.blp. The texture is cut into 256-px
// tiles numbered row by row, ceil(width / 256) * ceil(height / 256) of them.
// An overlay whose area has no directory, or with no texture, is skipped.
export function worldMapOverlays(dbcDir) {
  const areas = readDbc(join(dbcDir, 'WorldMapArea.dbc'));
  const dirs = new Map();
  for (let row = 0; row < areas.recordCount; row++) dirs.set(areas.uint(row, 0), areas.string(row, 3).trim());
  const dbc = readDbc(join(dbcDir, 'WorldMapOverlay.dbc'));
  const out = [];
  for (let row = 0; row < dbc.recordCount; row++) {
    const zone = dirs.get(dbc.uint(row, 1));
    const texture = dbc.string(row, 8).trim();
    if (!zone || !texture) continue;
    out.push({ zone, texture, tiles: Math.ceil(dbc.uint(row, 9) / 256) * Math.ceil(dbc.uint(row, 10) / 256) });
  }
  return out;
}

export { ICON_DIR };
