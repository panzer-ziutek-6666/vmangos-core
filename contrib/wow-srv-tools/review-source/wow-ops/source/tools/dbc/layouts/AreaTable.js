import { defineLayout, uint, int, locstring, skipN } from '../layout.js';

// The core reads this as "niiiixxxxxissssssssxixxxi": id, map, parent area,
// area bit, flags, five fields it skips, the sound preference, the localized
// name, then the faction group and three more it skips before the team.
export default defineLayout({
  table: 'area_table',
  file: 'AreaTable.dbc',
  columns: [
    uint('id'), uint('map_id'), uint('parent_area_id'), uint('area_bit'), uint('flags'),
    skipN(5),
    uint('sound_provider_id'),
    locstring('name'),
    uint('faction_group_id'), skipN(3), int('exploration_level')
  ]
});
