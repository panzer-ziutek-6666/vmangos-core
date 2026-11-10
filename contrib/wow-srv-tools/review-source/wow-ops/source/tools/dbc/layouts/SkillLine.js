import { defineLayout, uint, int, locstring, loctext } from '../layout.js';

// SkillLineEntry keeps categoryId, name and spellIcon live; the comment names
// the two fields it drops: skillCostID (uint32, always the same
// m_skillCostsID lookup in this build) and description, a second locstring.
// SkillLinefmt "nixssssssssxxxxxxxxxxi" agrees: one 'i' for categoryId, one
// 'x' for skillCostID, 8 's' + 1 'x' for name, 9 more 'x' for description,
// then the final 'i' for spellIcon.
//
// description is loctext rather than locstring: row 0's field 21 - the
// coincidental decode of spellIcon's small integer value landing inside the
// string block - lands mid-sentence in a multi-clause paragraph ("...higher
// defense makes..."), long enough that VARCHAR(512) is not a safe bet.
export default defineLayout({
  table: 'skill_line',
  file: 'SkillLine.dbc',
  columns: [
    uint('id'),
    int('category_id'),
    uint('skill_cost_id'),
    locstring('name'),
    loctext('description'),
    uint('spell_icon')
  ]
});
