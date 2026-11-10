import { defineLayout, uint, str } from '../layout.js';

// This core never loads ItemDisplayInfo.dbc - DBCStores.cpp keeps only a
// commented-out sItemDisplayInfoStore ("not used currently"), and the struct
// that survives in DBCStructure.h is a two-field stub unrelated to the real
// file. Item icons and models are display-only and no server-side logic
// needs them, so nothing here ever had a reason to parse it.
//
// With no core struct to check against, the field order below is the
// classic-era layout documented for this client range (WoWDBDefs'
// ItemDisplayInfo.dbd, build range 1.0.0.3980-1.12.3.6141) and confirmed
// against this client's actual file: model_name_1 reads real .mdx paths
// (e.g. "Stave_2H_Long_A_01.mdx" on a staff row), inventory_icon reads
// "INV_*" icon names on every row, and the eight texture slots read the
// skin-overlay names (Sleeve/Chest/Pants) a robe row fills in. The
// geoset/sound/visual integer fields cannot be told apart from a
// coincidentally-valid string offset by inspection alone (a small integer
// can double as one, the same trap AreaTable's own layout.js comment
// warns about), so they are taken on the documented order rather than
// eyeballed. Field count matches at 23.
export default defineLayout({
  table: 'item_display_info',
  file: 'ItemDisplayInfo.dbc',
  columns: [
    uint('id'),
    str('model_name_1'), str('model_name_2'),
    str('model_texture_1'), str('model_texture_2'),
    str('inventory_icon'),
    uint('geoset_group_1'), uint('geoset_group_2'), uint('geoset_group_3'),
    uint('flags'),
    uint('spell_visual_id'),
    uint('group_sound_index'),
    uint('helmet_geoset_vis_1'), uint('helmet_geoset_vis_2'),
    str('texture_1'), str('texture_2'), str('texture_3'), str('texture_4'),
    str('texture_5'), str('texture_6'), str('texture_7'), str('texture_8'),
    uint('item_visual')
  ]
});
