import { defineLayout, uint, str } from '../layout.js';

// Not a locstring: an icon path is a filename, the same in every locale, so
// this file has one string field rather than nine. The core never loads this
// file (no struct, no DBCfmt.h entry), so the layout comes from the data
// itself: row 0's second field decodes to a plausible
// "Interface\Icons\..." path and nothing else in the two-field record could
// hold it.
export default defineLayout({
  table: 'spell_icon',
  file: 'SpellIcon.dbc',
  columns: [uint('id'), str('path')]
});
