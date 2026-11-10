import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRawRow, renderPatchLine, dbLink, renderQuestList } from '../server/views/db/fields.js';

test('every column of the row is rendered', () => {
  const html = renderRawRow({ entry: 448, name: 'Hogger', level_min: 9 });
  assert.match(html, /entry/);
  assert.match(html, /level_min/);
  assert.match(html, /Hogger/);
});

test('the block says how many columns it holds', () => {
  const html = renderRawRow({ a: 1, b: 2, c: 3 });
  assert.match(html, /all 3 columns/);
});

test('world DB text is escaped', () => {
  // Item and quest text is operator-supplied content from a released dump.
  const html = renderRawRow({ name: '<script>alert(1)</script>' });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('a null column renders as an em dash, not the word null', () => {
  assert.match(renderRawRow({ subname: null }), /—/);
});

test('the patch line names the row shown and its variants', () => {
  const line = renderPatchLine({ patch: 7, patches: [0, 7, 9], wowPatch: 10 });
  assert.match(line, /patch 7/);
  assert.match(line, /0, 7, 9/);
});

test('an entry with a single patch row says so without listing variants', () => {
  const line = renderPatchLine({ patch: 0, patches: [0], wowPatch: 10 });
  assert.doesNotMatch(line, /variant/);
});

// dbLink and renderQuestList were duplicated verbatim across creature.js,
// item.js, quest.js and gameobject.js; hoisted here so every entity page
// shares one implementation.
test('dbLink names a link by its resolved name, and falls back to the bare id when there is none', () => {
  assert.equal(dbLink('creature', 448, 'Hogger'), '<a href="/db/creature/448">Hogger</a>');
  assert.equal(dbLink('item', 2586, null), '<a href="/db/item/2586">#2586</a>');
});

test('dbLink escapes an unresolved id and a resolved name alike', () => {
  assert.match(dbLink('creature', '448', '<b>x</b>'), /&lt;b&gt;x&lt;\/b&gt;/);
});

test('renderQuestList links every id and reports the empty label when there are none', () => {
  assert.match(renderQuestList([], new Map(), 'Nothing here.'), /Nothing here\./);
  const html = renderQuestList([176], new Map([[176, 'Investigate Hogger']]), 'Nothing here.');
  assert.match(html, /href="\/db\/quest\/176"\s+hx-get="\/db\/tooltip\/quest\/176"[^>]*>Investigate Hogger<\/a>/);
});
