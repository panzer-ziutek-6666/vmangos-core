import { defineLayout, uint, locstring } from '../layout.js';

// SpellItemEnchantmentEntry keeps type[3], amount[3] and spellid[3] live, and
// names the array the core drops in a comment: amount2[3] / m_effectPointsMax
// (fields 7-9, all 'x' in SpellItemEnchantmentfmt
// "niiiiiixxxiiissssssssxii"). Row 2 (a fixed-value "Poison II" proc) has
// amount[0] and amount2[0] both 100 - a min/max pair that happens to be equal
// for a non-random effect, which is exactly the m_effectPointsMin /
// m_effectPointsMax relationship the comment describes.
export default defineLayout({
  table: 'spell_item_enchantment',
  file: 'SpellItemEnchantment.dbc',
  columns: [
    uint('id'),
    uint('type_1'), uint('type_2'), uint('type_3'),
    uint('amount_1'), uint('amount_2'), uint('amount_3'),
    uint('amount_max_1'), uint('amount_max_2'), uint('amount_max_3'),
    uint('spell_id_1'), uint('spell_id_2'), uint('spell_id_3'),
    locstring('description'),
    uint('aura_id'),
    uint('slot')
  ]
});
