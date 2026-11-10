import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildContactSheet } from '../tools/contact-sheet.js';
import { MAP_TILES } from '../tools/extract-art.js';

// A synthetic asset root shaped like a real extraction: icons/<name>.png and
// maps/<zone>/<tile>.png. The PNG bytes are irrelevant here - the sheet only
// lists what is on disk.
function withRoot({ icons = [], zones = {} }, run) {
  const root = mkdtempSync(join(tmpdir(), 'wow-ops-sheet-'));
  try {
    mkdirSync(join(root, 'icons'), { recursive: true });
    for (const name of icons) writeFileSync(join(root, 'icons', name), 'x');
    mkdirSync(join(root, 'maps'), { recursive: true });
    for (const [zone, tiles] of Object.entries(zones)) {
      mkdirSync(join(root, 'maps', zone), { recursive: true });
      for (const tile of tiles) writeFileSync(join(root, 'maps', zone, `${tile}.png`), 'x');
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function allTiles() {
  return Array.from({ length: MAP_TILES }, (_, i) => i + 1);
}

function sheetFor(root) {
  const result = buildContactSheet({ assetsRoot: root });
  return { result, html: readFileSync(result.outPath, 'utf8') };
}

test('every icon on disk gets one image, and the heading counts them', () => {
  withRoot({ icons: ['a.png', 'b.png', 'c.png'], zones: {} }, (root) => {
    const { result, html } = sheetFor(root);
    assert.equal(result.iconCount, 3);
    assert.match(html, /<h1>3 icons<\/h1>/);
    assert.equal(html.match(/src="icons\//g).length, 3);
  });
});

test('a zone renders one cell per tile', () => {
  withRoot({ zones: { durotar: allTiles() } }, (root) => {
    const { result, html } = sheetFor(root);
    assert.equal(result.zoneCount, 1);
    assert.equal(html.match(/src="maps\/durotar\//g).length, MAP_TILES);
    // The class name also appears in the stylesheet, so count the cells.
    assert.equal(html.match(/class="missing-tile"/g), null);
  });
});

// A missing tile must leave a hole rather than shift the rest: the whole
// point of the layout is that a human eye catches a scrambled map, and a
// closed-up grid fakes exactly that.
test('a missing tile leaves a placeholder and does not shift the others', () => {
  withRoot({ zones: { durotar: allTiles().filter((tile) => tile !== 5) } }, (root) => {
    const { html } = sheetFor(root);
    assert.equal(html.match(/class="missing-tile"/g).length, 1);
    assert.equal(html.match(/src="maps\/durotar\//g).length, MAP_TILES - 1);
    const cells = html.match(/(<img src="maps\/durotar\/\d+\.png"|<div class="missing-tile">)/g);
    assert.equal(cells.length, MAP_TILES);
    assert.match(cells[4], /missing-tile/, 'the hole is at tile 5, in position 5');
  });
});

// The value is a URL path, not text: a name with a character that is legal in
// a filename but special in a URL would produce a link to the wrong file.
test('an icon name is URL-encoded in the src', () => {
  withRoot({ icons: ['inv_misc_a#b.png'] }, (root) => {
    const { html } = sheetFor(root);
    assert.match(html, /src="icons\/inv_misc_a%23b\.png"/);
    assert.doesNotMatch(html, /src="icons\/inv_misc_a#b\.png"/);
  });
});

// A quote is not a legal filename character on this platform, so the name
// that exercises escaping is one with an ampersand - and the live asset root
// has one: inv_misc_fork&knife.png.
test('a name is HTML-escaped in the title and URL-encoded in the src', () => {
  withRoot({ icons: ['inv_misc_fork&knife.png'] }, (root) => {
    const { html } = sheetFor(root);
    assert.match(html, /title="inv_misc_fork&amp;knife\.png"/);
    assert.match(html, /src="icons\/inv_misc_fork%26knife\.png"/);
  });
});

test('an asset root with no extraction in it says so instead of throwing ENOENT', () => {
  const root = mkdtempSync(join(tmpdir(), 'wow-ops-sheet-'));
  try {
    assert.throws(() => buildContactSheet({ assetsRoot: root }), /extract-art/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
