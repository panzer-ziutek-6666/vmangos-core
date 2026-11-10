import { defineLayout, uint, locstring } from '../layout.js';

// The core never references this file either. Fields 1-9 are a name
// locstring by the same evidence as SpellMechanic: field 1 reads "None",
// "Magic", "Curse", ... one dispel-type name per row, and field 9 closes with
// a locale-flags constant (8323198, then 4128894 for the last two rows).
//
// Fields 10 and 11 could not be identified. Field 10 is 1 for exactly the
// four "debuff type" rows (Magic, Curse, Disease, Poison; ids 1-4) and 0
// everywhere else, including row 0 (None); field 11 exactly mirrors field 1's
// raw value on those same four rows and is 0 elsewhere. That pattern picks
// out a real distinction (the four dispellable debuff categories) but not
// one confidently nameable as "Mask" or "ImmunityPossible" - field 11
// duplicating field 1 verbatim, rather than holding an independent bitmask,
// does not match either of those names closely enough to claim.
export default defineLayout({
  table: 'spell_dispel_type',
  file: 'SpellDispelType.dbc',
  columns: [uint('id'), locstring('internal_name'), uint('unk_10'), uint('unk_11')]
});
