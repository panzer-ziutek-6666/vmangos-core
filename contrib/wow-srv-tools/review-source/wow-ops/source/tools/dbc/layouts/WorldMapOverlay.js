import { defineLayout, uint, int, str, skipN } from '../layout.js';

// WorldMapOverlay.dbc: the textures the client's world map paints over a
// zone's parchment for each explored area (WorldMapOverlayEntry,
// vmangos-core/src/game/Database/DBCStructure.h:752-768). The core loads none
// of it - WorldMapOverlayEntryfmt is commented out (DBCfmt.h:89) - so the
// field names are the struct's comments. Fields 6-7 (m_mapPointX/Y) and the
// hit rectangle 13-16 are skipped: the zone page draws every overlay, as a
// fully explored map, and needs only the texture, its size and its offset
// within the 1002x668 map frame.
export default defineLayout({
  table: 'world_map_overlay',
  file: 'WorldMapOverlay.dbc',
  columns: [
    uint('id'), uint('world_map_area_id'),
    uint('area_id_1'), uint('area_id_2'), uint('area_id_3'), uint('area_id_4'),
    skipN(2),
    str('texture_name'), uint('texture_width'), uint('texture_height'),
    int('offset_x'), int('offset_y'),
    skipN(4)
  ]
});
