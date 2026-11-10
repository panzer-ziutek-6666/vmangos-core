import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { iconPathFor, talentBackgrounds, worldMapOverlays } from '../tools/dbc/artNames.js';
import { withDbc, writeDbc } from './helpers/dbc.js';

test('a path already under the icon directory keeps its name', () => {
  assert.equal(iconPathFor('Interface\\Icons\\Spell_Fire_Flamebolt'), 'Interface\\Icons\\Spell_Fire_Flamebolt.blp');
});

test('a path under another directory is rewritten to the icon directory', () => {
  // The one record in this client that does this is Spells\Icon\Spell_Fire_Fire,
  // a directory the archive does not contain; its basename resolves there.
  assert.equal(iconPathFor('Spells\\Icon\\Spell_Fire_Fire'), 'Interface\\Icons\\Spell_Fire_Fire.blp');
});

test('forward slashes are accepted', () => {
  assert.equal(iconPathFor('Interface/Icons/INV_Robe_02'), 'Interface\\Icons\\INV_Robe_02.blp');
});

test('a bare name with no directory is placed in the icon directory', () => {
  assert.equal(iconPathFor('INV_Sword_04'), 'Interface\\Icons\\INV_Sword_04.blp');
});

// TalentTab.dbc field 14 is the background texture name (DBCStructure.h:685,
// "m_backgroundFile"); fifteen fields per record.
test('talentBackgrounds reads field 14, skips empties and repeats', () => {
  const row = (id, bg) => [id, { str: 'Tree' }, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 128, 0, { str: bg }];
  withDbc({ name: 'TalentTab.dbc', rows: [row(81, 'MageArcane'), row(41, 'MageFire'), row(99, ''), row(100, 'MageFire')] }, (path) => {
    assert.deepEqual(talentBackgrounds(dirname(path)), ['MageArcane', 'MageFire']);
  });
});

// An overlay's texture is split into 256-px tiles named <texture>1..N, where
// N is ceil(width / 256) * ceil(height / 256) (the client's world map lays
// them out row by row); they live in the zone's own map directory, which is
// WorldMapArea.dbc field 3 for the overlay's world map area (field 1).
test('worldMapOverlays names every overlay tile under its zone directory', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'overlay-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeDbc(join(dir, 'WorldMapArea.dbc'), { rows: [[30, 0, 12, { str: 'Elwynn' }, { float: 0 }, { float: 0 }, { float: 0 }, { float: 0 }]] });
  const overlay = (id, area, name, w, h) => [id, area, 0, 0, 0, 0, 0, 0, { str: name }, w, h, 0, 0, 0, 0, 0, 0];
  writeDbc(join(dir, 'WorldMapOverlay.dbc'), { rows: [overlay(1, 30, 'Goldshire', 256, 256), overlay(2, 30, 'Northshire', 300, 200), overlay(3, 99, 'Nowhere', 128, 128), overlay(4, 30, '', 64, 64)] });
  assert.deepEqual(worldMapOverlays(dir), [
    { zone: 'Elwynn', texture: 'Goldshire', tiles: 1 },
    { zone: 'Elwynn', texture: 'Northshire', tiles: 2 }
  ]);
});
