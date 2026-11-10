import { defineLayout, uint, float, locstring } from '../layout.js';

// SpellRangeEntry only keeps { ID, minRange, maxRange } as live struct
// members, but the surrounding comment names every field the core skips:
// Flags, then a Name locstring, then a ShortName locstring - matching
// SpellRangefmt "nffxxxxxxxxxxxxxxxxxxx" (22 x/f/n slots) field for field.
// Row data confirms it: field 2 as a float is a plausible max range (5.0,
// 20.0, ...), and fields 4 and 13 hold readable text ("Self Only", "Combat
// Range", "Short") at the positions the two locstrings would start.
export default defineLayout({
  table: 'spell_range',
  file: 'SpellRange.dbc',
  columns: [
    uint('id'),
    float('min_range'),
    float('max_range'),
    uint('flags'),
    locstring('name'),
    locstring('short_name')
  ]
});
