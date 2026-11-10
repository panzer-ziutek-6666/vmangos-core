import test from 'node:test';
import assert from 'node:assert/strict';
import { iconPath, renderIcon } from '../server/views/db/icon.js';

test('a plain DBC icon name becomes a path under the art mount', () => {
  assert.equal(iconPath('INV_Sword_39'), '/db/art/icons/INV_Sword_39.png');
});

// Measured on this client: of 2219 distinct inventory_icon values, some are
// written with the source file's extension still on them, e.g. INV_Chest_Fur.tga.
test('an extension already on the DBC name is stripped, not doubled', () => {
  assert.equal(iconPath('INV_Chest_Fur.tga'), '/db/art/icons/INV_Chest_Fur.png');
  assert.equal(iconPath('INV_Chest_Fur.blp'), '/db/art/icons/INV_Chest_Fur.png');
});

test('a missing or empty name yields no path at all', () => {
  assert.equal(iconPath(null), null);
  assert.equal(iconPath(''), null);
  assert.equal(iconPath('   '), null);
});

// The art root is served as static files; a name is never allowed to walk out
// of it, whatever the reference import put in the column.
test('a name that tries to escape the art directory yields no path', () => {
  assert.equal(iconPath('../../../etc/passwd'), null);
  assert.equal(iconPath('sub/dir/icon'), null);
});

test('an icon with no file renders an empty frame, never a broken image', () => {
  const html = renderIcon(null, 'Thunderfury');
  assert.match(html, /class="icon"/);
  assert.doesNotMatch(html, /<img/);
});

test('an icon renders inside the frame with the name as alt text', () => {
  const html = renderIcon('INV_Sword_39', 'Thunder"fury');
  assert.match(html, /<img src="\/db\/art\/icons\/INV_Sword_39\.png"/);
  assert.match(html, /alt="Thunder&quot;fury"/);
});
