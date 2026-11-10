import { defineLayout, uint, str, locstring, skip, rowIndex } from '../layout.js';

// TalentTabEntryfmt is "nxxxxxxxxxxxiix" (vmangos-core/src/game/Database/DBCfmt.h:82):
// the core keeps only the id, class mask and order index. The calculator also
// needs what the core skips - the tree's name (locstring, fields 1-9), its
// spell icon (10) and its background texture name (14), the directory the art
// extractor writes the tree's four tiles to (DBCStructure.h:676-686). Field 11
// is a race mask nothing reads. dbc_row is the record's position in the file:
// the client breaks order-index ties by it (Mage Arcane 81 and Fire 41 both
// carry 0, and Arcane, the earlier row, comes first).
export default defineLayout({
  table: 'talent_tab',
  file: 'TalentTab.dbc',
  columns: [
    uint('id'), locstring('name'), uint('spell_icon_id'), skip(),
    uint('class_mask'), uint('tab_page'), str('background'),
    rowIndex('dbc_row')
  ]
});
