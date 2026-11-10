import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUTS, layoutFor } from '../tools/dbc/layouts/index.js';

test('every layout has a unique table name and a source file', () => {
  const tables = new Set();
  for (const layout of LAYOUTS) {
    assert.ok(layout.file.endsWith('.dbc'), `${layout.table} has no source file`);
    assert.equal(tables.has(layout.table), false, `duplicate table ${layout.table}`);
    tables.add(layout.table);
  }
});

test('every layout starts with an id column, which becomes the primary key', () => {
  for (const layout of LAYOUTS) {
    assert.equal(layout.columns[0].name, 'id', `${layout.table} does not start with id`);
  }
});

test('layoutFor finds a layout by table name', () => {
  assert.equal(layoutFor('spell_cast_times').file, 'SpellCastTimes.dbc');
  assert.equal(layoutFor('nothing'), undefined);
});

test('world_map_area imports the internal map name as field 3', () => {
  const layout = layoutFor('world_map_area');
  assert.deepEqual(layout.columns.map((c) => c.name),
    ['id', 'map_id', 'area_id', 'name', 'loc_left', 'loc_right', 'loc_top', 'loc_bottom']);
  assert.equal(layout.fieldCount, 8);
});

// TalentTabEntry (vmangos-core/src/game/Database/DBCStructure.h:676-686):
// id, name (locstring 1-9), spell icon (10), race mask (11), class mask (12),
// order index (13), background file (14) - fifteen fields.
test('talent_tab imports name, icon, class, order, background and file row', () => {
  const layout = layoutFor('talent_tab');
  assert.deepEqual(layout.columns.filter((c) => c.name).map((c) => c.name),
    ['id', 'name', 'spell_icon_id', 'class_mask', 'tab_page', 'background', 'dbc_row']);
  assert.equal(layout.fieldCount, 15);
});

// WorldMapOverlayEntry (vmangos-core/src/game/Database/DBCStructure.h:752-768):
// id, world map area (1), four area ids (2-5), map point x/y (6-7), texture
// name (8), texture width/height (9-10), offset x/y (11-12) and a hit rect
// (13-16) - seventeen fields. The core reads none of it (DBCfmt.h:89 is
// commented out); the zone page draws the overlays.
test('world_map_overlay imports texture, size and offset, keyed to its world map area', () => {
  const layout = layoutFor('world_map_overlay');
  assert.deepEqual(layout.columns.filter((c) => c.name).map((c) => c.name),
    ['id', 'world_map_area_id', 'area_id_1', 'area_id_2', 'area_id_3', 'area_id_4', 'texture_name', 'texture_width', 'texture_height', 'offset_x', 'offset_y']);
  assert.equal(layout.fieldCount, 17);
});
