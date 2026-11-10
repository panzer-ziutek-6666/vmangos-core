import { defineLayout, uint, locstring, skipN } from '../layout.js';

// ItemSetEntry's own id field is commented out in the struct - the core
// indexes this table by it ('d' in ItemSetEntryfmt) but never stores it as a
// member - yet it is still real DBC data, so it is declared like every
// other table's id rather than skipped. itemId[17] (the seventeen set
// pieces) is likewise commented out and unused by the core, so it is
// skipped rather than named, same as the reserved slots in
// ItemRandomProperties. spells[8]/items_to_triggerspell[8] are the pieces
// that survive: which set bonus spell fires, and how many pieces it takes.
// SUPPORTED_CLIENT_BUILD > CLIENT_BUILD_1_10_2 is true for this client, so
// the trailing required_skill_id/required_skill_value pair (added after
// 1.6.1, still present past 1.10.2) applies; ItemSetEntryfmt for that range
// is 45 fields, which matches the file.
export default defineLayout({
  table: 'item_set',
  file: 'ItemSet.dbc',
  columns: [
    uint('id'),
    locstring('name'),
    skipN(17),
    uint('spell_id_1'), uint('spell_id_2'), uint('spell_id_3'), uint('spell_id_4'),
    uint('spell_id_5'), uint('spell_id_6'), uint('spell_id_7'), uint('spell_id_8'),
    uint('items_to_trigger_spell_1'), uint('items_to_trigger_spell_2'), uint('items_to_trigger_spell_3'), uint('items_to_trigger_spell_4'),
    uint('items_to_trigger_spell_5'), uint('items_to_trigger_spell_6'), uint('items_to_trigger_spell_7'), uint('items_to_trigger_spell_8'),
    uint('required_skill_id'), uint('required_skill_value')
  ]
});
