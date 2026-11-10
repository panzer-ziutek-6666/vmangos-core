import { defineLayout, uint, locstring, skip, skipN } from '../layout.js';

// ChrClassesEntryfmt has two versions in DBCfmt.h (lines 31-35), split on
// whether the client is past 1.9.4; this build (5875, well above that line)
// reads "nxxixssssssssxxix" - seventeen fields. ChrClassesEntry
// (DBCStructure.h lines 122-134) names three of them: the power type a class
// uses (mana/rage/energy - m_DisplayPower), the localized class name, and a
// spell-family id (m_spellClassSet) later spell code keys off of. Everything
// else is commented out in the struct: two leading unknowns, a pet name
// token, a class .mdx filename, and a flags word (0x1 marks the class as
// having a relic slot, i.e. Hunter/Paladin's ranged/relic item slot).
export default defineLayout({
  table: 'chr_classes',
  file: 'ChrClasses.dbc',
  columns: [
    uint('id'), skipN(2), uint('power_type'), skip(),
    locstring('name'),
    skip(), uint('spell_family'), skip()
  ]
});
