import { defineLayout, uint, skipN } from '../layout.js';

// TalentEntryfmt ("niiiiiiiixxxxixxixxxi", DBCfmt.h line 81) is twenty-one
// fields: id, the tab/row/column position, five rank spell ids (a talent can
// hold up to five ranks, each a separate spell), four fields padding out
// that rank array, the prerequisite talent, two more padding fields, its
// required rank, then three more skips - the struct (TalentEntry,
// DBCStructure.h lines 660-674) comments the middle one of those three out
// as "m_flags ... need disable higest ranks on reset talent tree" and never
// reads it - before the last field, which the struct names DependsOnSpell:
// a spell the player must already know for the talent to unlock
// (Player::LearnTalent checks talentInfo->DependsOnSpell against HasSpell).
export default defineLayout({
  table: 'talent',
  file: 'Talent.dbc',
  columns: [
    uint('id'), uint('tab_id'), uint('row'), uint('column'),
    uint('rank_1'), uint('rank_2'), uint('rank_3'), uint('rank_4'), uint('rank_5'),
    skipN(4),
    uint('prereq_talent'), skipN(2), uint('prereq_rank'), skipN(3), uint('required_spell')
  ]
});
