import { defineLayout, uint, skipN } from '../layout.js';

// LockEntry is eight parallel case arrays around an id: Type[8] (what opens
// this case - key, skill, item...), Index[8] (which key/item/spell it takes)
// and Skill[8] (the lock skill and required value for a skill-type case).
// The core's own Action[8] is commented out ("m_Action") and never read, so
// it is skipped like every other unused array in this set rather than
// named - declared in full (eight skips) so the count stays honest.
// LockEntryfmt confirms all thirty-three fields.
export default defineLayout({
  table: 'lock',
  file: 'Lock.dbc',
  columns: [
    uint('id'),
    uint('type_1'), uint('type_2'), uint('type_3'), uint('type_4'),
    uint('type_5'), uint('type_6'), uint('type_7'), uint('type_8'),
    uint('index_1'), uint('index_2'), uint('index_3'), uint('index_4'),
    uint('index_5'), uint('index_6'), uint('index_7'), uint('index_8'),
    uint('skill_1'), uint('skill_2'), uint('skill_3'), uint('skill_4'),
    uint('skill_5'), uint('skill_6'), uint('skill_7'), uint('skill_8'),
    skipN(8)
  ]
});
