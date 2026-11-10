import { defineLayout, uint, locstring, skip, skipN } from '../layout.js';

// ChrRacesEntryfmt ("niixiixxiiiiixixissssssssxxxx", DBCfmt.h line 36) is
// twenty-nine fields. ChrRacesEntry (DBCStructure.h lines 143-168) names
// eleven of them: flags (NOT_PLAYABLE/BARE_FEET/CAN_MOUNT), the faction this
// race reputations against, the two display ids the client model-swaps
// between for the race's genders, team (m_BaseLanguage - Alliance/Horde),
// creature type (blizzlike always humanoid), the login-visual and
// daze/stun-visual spells every race shares, the resurrection-sickness
// spell, the mask of taxi nodes a new character of this race starts with
// already discovered, the intro cinematic id, and the localized race name.
// Everything else is commented out in the struct: an exploration sound id,
// a client path prefix and one flatly "unused" field, a splash sound id, a
// client file string, and - after the name - two facial-hair customization
// slots and one hair-customization slot.
export default defineLayout({
  table: 'chr_races',
  file: 'ChrRaces.dbc',
  columns: [
    uint('id'), uint('flags'), uint('faction'), skip(),
    uint('model_m'), uint('model_f'), skipN(2),
    uint('team'), uint('creature_type'), uint('login_spell'), uint('daze_spell'), uint('res_sickness_spell'),
    skip(), uint('starting_taxi_mask'), skip(), uint('cinematic_sequence'),
    locstring('name'),
    skipN(3)
  ]
});
