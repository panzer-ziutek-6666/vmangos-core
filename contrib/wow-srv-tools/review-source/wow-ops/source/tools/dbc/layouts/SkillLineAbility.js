import { defineLayout, uint } from '../layout.js';

// SkillLineAbilityEntry names every field except two: fields 12-13 are
// commented "unknown, always 0" in the struct itself, which is as close to an
// explicit unk_<index> instruction as the core gets. race_mask_not and
// class_mask_not (fields 5-6) are dropped by the core but still named in the
// comment ("always 0 in 2.4.2"), so they get real names rather than unk_5 /
// unk_6. SkillLineAbilityfmt "niiiixxiiiiixxi" agrees on all fifteen fields.
export default defineLayout({
  table: 'skill_line_ability',
  file: 'SkillLineAbility.dbc',
  columns: [
    uint('id'),
    uint('skill_id'),
    uint('spell_id'),
    uint('race_mask'),
    uint('class_mask'),
    uint('race_mask_not'),
    uint('class_mask_not'),
    uint('req_skill_value'),
    uint('forward_spell_id'),
    uint('learn_on_get_skill'),
    uint('max_value'),
    uint('min_value'),
    uint('unk_12'),
    uint('unk_13'),
    uint('req_train_points')
  ]
});
