import { defineLayout, uint, locstring } from '../layout.js';

// Resistances.dbc has no loader in this core either - the only trace of it
// is a comment on ItemPrototype::DamageType ("id from Resistances.dbc").
// Field order (id, flags, a SoundKit id for the resist "fizzle" sound, then
// the localized school name) is WoWDBDefs' Resistances.dbd for this build
// range, confirmed against the file: id 0 ("Physical") is the only row with
// flags set, which matches physical damage being the one school every other
// piece of core code treats as a special case; the school names read
// "Physical", "Holy", "Fire", "Nature", "Frost", "Shadow", "Arcane" in id
// order, matching SPELL_SCHOOL_*; and the fizzle sound ids climb roughly in
// step with id while staying 0 for Physical, which cannot fizzle a spell.
// Field count matches at 12.
export default defineLayout({
  table: 'resistances',
  file: 'Resistances.dbc',
  columns: [
    uint('id'), uint('flags'), uint('fizzle_sound_id'), locstring('name')
  ]
});
