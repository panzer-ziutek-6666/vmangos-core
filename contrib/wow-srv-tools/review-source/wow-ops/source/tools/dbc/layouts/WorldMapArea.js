import { defineLayout, uint, float, str } from '../layout.js';

// WorldMapAreaEntryfmt is "xinxffff": the core's own WorldMapAreaEntry drops
// the row's id and looks entries up by area_id instead ('n' marks that as
// the indexed field, not field 0). The id is still real, unique DBC data
// though, and every table in this registry keys on one, so it is declared
// rather than skipped. WorldMapAreaEntry's remaining fields are map_id,
// area_id, the unlocalized internal area name (imported; it names the
// directory the zone's map tiles were extracted to, tools/dbc/artNames.js),
// then the four screen-space bounds it names y1/y2/x1/x2 after their DBC
// comments (m_locLeft/m_locRight/m_locTop/m_locBottom). Kept under those
// comment names rather than the core's y/x member names, since "left" and
// "top" say which edge without having to remember the core's axis order.
export default defineLayout({
  table: 'world_map_area',
  file: 'WorldMapArea.dbc',
  columns: [
    uint('id'),
    uint('map_id'), uint('area_id'), str('name'),
    float('loc_left'), float('loc_right'), float('loc_top'), float('loc_bottom')
  ]
});
