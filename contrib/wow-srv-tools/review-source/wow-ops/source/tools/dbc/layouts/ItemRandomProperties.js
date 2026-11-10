import { defineLayout, uint, str, locstring, skipN } from '../layout.js';

// ItemRandomPropertiesEntry names internalName (m_Name, an unlocalized
// string - not a locstring, per the "path or filename" rule's non-localized
// sibling: an internal identifier) separately from nameSuffix[8]
// (m_name_lang, the localized "of the Bear" text appended to an item's
// name). They are usually the same English text in the client data (row 0
// is "of Intellect" both places), which is why they read as duplicates
// rather than a bug. enchant_id[3] leaves two reserved slots the core's own
// comment calls "unused, 0 only values" - declared here as a skip rather
// than named, matching how every other DBC in this set treats a field the
// core does not read. ItemRandomPropertiesfmt confirms all sixteen fields.
export default defineLayout({
  table: 'item_random_properties',
  file: 'ItemRandomProperties.dbc',
  columns: [
    uint('id'), str('internal_name'),
    uint('enchant_id_1'), uint('enchant_id_2'), uint('enchant_id_3'),
    skipN(2),
    locstring('name_suffix')
  ]
});
