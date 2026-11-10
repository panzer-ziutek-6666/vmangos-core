import { defineLayout, uint, float } from '../layout.js';

// SpellRadiusEntry only keeps { ID, Radius } live, but the comment names the
// two fields it drops: m_radiusPerLevel and m_radiusMax (float, commented
// out). SpellRadiusfmt "nfxx" agrees on the count and on Radius being the
// only field the core reads. Across every one of the file's 24 rows, field 2
// (radius_per_level) is always 0 and field 3 (radius_max) is always exactly
// equal to field 1 - this build never uses either for scaling, it just
// mirrors radius into radius_max.
export default defineLayout({
  table: 'spell_radius',
  file: 'SpellRadius.dbc',
  columns: [uint('id'), float('radius'), float('radius_per_level'), float('radius_max')]
});
