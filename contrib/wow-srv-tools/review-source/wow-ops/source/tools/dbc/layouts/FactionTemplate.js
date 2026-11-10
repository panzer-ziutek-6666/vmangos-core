import { defineLayout, uint } from '../layout.js';

// FactionTemplateEntry names all fourteen fields and the core reads every
// one of them (they drive IsFriendlyTo/IsHostileTo), so there is nothing to
// skip: id, the faction it reputation-links to, the template's own flags,
// the three faction-mask fields (ourMask/friendlyMask/hostileMask) used for
// the coarse team-vs-team checks, then the two four-entry arrays that name
// specific enemy and friend factions for exceptions the masks can't express.
export default defineLayout({
  table: 'faction_template',
  file: 'FactionTemplate.dbc',
  columns: [
    uint('id'), uint('faction'), uint('faction_flags'),
    uint('our_mask'), uint('friendly_mask'), uint('hostile_mask'),
    uint('enemy_faction_1'), uint('enemy_faction_2'), uint('enemy_faction_3'), uint('enemy_faction_4'),
    uint('friend_faction_1'), uint('friend_faction_2'), uint('friend_faction_3'), uint('friend_faction_4')
  ]
});
