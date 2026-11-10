import { defineLayout, uint, locstring } from '../layout.js';

// The core never references this file - no struct, no DBCfmt.h entry - so
// there is nothing to cross-check against, only the data and community
// documentation of SpellMechanic.dbc (ID, StateName). Row 0's second field
// reads "charmed", row 1 "disoriented", row 2 "disarmed" - short mechanic
// names, one per row - and field 9 carries the same large locale-flags
// constant (4128894) seen closing out other locstrings in this build, which
// puts the name at fields 1-9 (8 locale slots plus the flags word) and
// accounts for all 10 fields.
export default defineLayout({
  table: 'spell_mechanic',
  file: 'SpellMechanic.dbc',
  columns: [uint('id'), locstring('state_name')]
});
