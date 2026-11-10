import { readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfigFile } from '../server/config.js';
import { MAP_TILES } from './extract-art.js';

const MAP_COLUMNS = 4;

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A src is a URL path, not text. Escaping it for HTML leaves `#`, `?` and a
// bare space meaning what they mean in a URL, so a file whose name contained
// one would link somewhere else entirely - and the sheet would show a broken
// image for art that extracted perfectly. Every name this client ships is
// identifier-safe today, which is exactly why the mistake would go unnoticed
// until some later archive's is not.
function encodePathSegment(name) {
  return escapeHtml(encodeURIComponent(name));
}

// Icons render at their natural size (no CSS width/height) because a resized
// icon is exactly the kind of thing a human eye catches and an assertion
// cannot: a wrong decode often still produces a correctly-sized image.
function iconFigure(name) {
  const safe = escapeHtml(name);
  return `<img src="icons/${encodePathSegment(name)}" title="${safe}" alt="${safe}" loading="lazy">`;
}

// The tiles laid out 4 wide, in tile order, so a correct extraction visibly
// assembles into one map and a scrambled one visibly does not. A missing tile
// leaves an empty grid cell rather than shifting the rest out of position.
// The count comes from the extractor: if the two ever disagreed, every zone
// would render as a wall of placeholders and read as a failed extraction,
// which is the opposite of the truth.
function zoneSection(zone, tileNames) {
  const cells = [];
  for (let tile = 1; tile <= MAP_TILES; tile++) {
    const name = `${tile}.png`;
    cells.push(tileNames.has(name)
      ? `<img src="maps/${encodePathSegment(zone)}/${name}" title="${escapeHtml(zone)} ${tile}" alt="${escapeHtml(zone)} tile ${tile}" loading="lazy">`
      : '<div class="missing-tile"></div>');
  }
  return `<section class="zone"><h3>${escapeHtml(zone)}</h3><div class="tiles">${cells.join('')}</div></section>`;
}

// Both directories are written by the extractor, so the only realistic reason
// either is absent is that the sheet was generated before anything was
// extracted. A raw ENOENT stack names a path and leaves the operator to work
// out what makes it appear.
function listOrExplain(path) {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    throw new Error(`${path} does not exist. Run "npm run extract-art" first.`);
  }
}

export function buildContactSheet({ assetsRoot }) {
  const iconNames = listOrExplain(join(assetsRoot, 'icons')).map((entry) => entry.name).sort();
  const zoneNames = listOrExplain(join(assetsRoot, 'maps'))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const zoneSections = zoneNames.map((zone) => {
    const tileNames = new Set(readdirSync(join(assetsRoot, 'maps', zone)));
    return zoneSection(zone, tileNames);
  });

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Extracted art contact sheet</title>
<style>
  body { background: #111; color: #eee; font-family: sans-serif; margin: 0; padding: 1.5rem; }
  h1, h2, h3 { font-weight: normal; }
  .icons { display: flex; flex-wrap: wrap; gap: 2px; background: #000; padding: 2px; }
  .icons img { display: block; image-rendering: pixelated; background: #222; }
  .zone { margin-bottom: 1.5rem; }
  .tiles { display: grid; grid-template-columns: repeat(${MAP_COLUMNS}, auto); gap: 1px; background: #000; width: max-content; }
  .tiles img, .missing-tile { display: block; width: 128px; height: 128px; background: #222; }
</style>
</head>
<body>
<h1>${iconNames.length} icons</h1>
<div class="icons">
${iconNames.map(iconFigure).join('\n')}
</div>
<h2>${zoneNames.length} zone maps</h2>
${zoneSections.join('\n')}
</body>
</html>
`;

  const outPath = join(assetsRoot, 'contact-sheet.html');
  writeFileSync(outPath, html);
  return { outPath, iconCount: iconNames.length, zoneCount: zoneNames.length };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const here = dirname(fileURLToPath(import.meta.url));
  const cfg = readConfigFile(join(here, '..', 'config.json'));
  if (!cfg.assets) {
    console.error('config.json needs an "assets" section. See config.example.json.');
    process.exit(1);
  }
  const { outPath, iconCount, zoneCount } = buildContactSheet({ assetsRoot: cfg.assets.root });
  console.log(`wrote ${outPath} (${iconCount} icons, ${zoneCount} zone maps)`);
}
