import { defineLayout, uint, int, locstring } from '../layout.js';

// This core never reads Faction.dbc directly - reputation faction rows come
// from the world DB `faction` table instead (ObjectMgr::LoadFactions), which
// mirrors the DBC field order closely enough to confirm it: id, an int
// reputationListID (-1 for factions that carry no reputation, per
// FactionEntry::CanHaveReputation), four race masks, four class masks, four
// base rep values, four rep-flag words, the parent/team id, a localized
// name and a localized description. FactionEntry's own field-index comments
// in DBCStructure.h (lines 310-324: "0 m_ID" through "36 string flags")
// agree at 37 fields; description is unused by the core (LoadFactions only
// reads name) but is still real DBC data, so it is declared rather than
// skipped.
export default defineLayout({
  table: 'faction',
  file: 'Faction.dbc',
  columns: [
    uint('id'), int('reputation_list_id'),
    uint('base_rep_race_mask_1'), uint('base_rep_race_mask_2'), uint('base_rep_race_mask_3'), uint('base_rep_race_mask_4'),
    uint('base_rep_class_mask_1'), uint('base_rep_class_mask_2'), uint('base_rep_class_mask_3'), uint('base_rep_class_mask_4'),
    int('base_rep_value_1'), int('base_rep_value_2'), int('base_rep_value_3'), int('base_rep_value_4'),
    uint('reputation_flags_1'), uint('reputation_flags_2'), uint('reputation_flags_3'), uint('reputation_flags_4'),
    uint('team'),
    locstring('name'),
    locstring('description')
  ]
});
