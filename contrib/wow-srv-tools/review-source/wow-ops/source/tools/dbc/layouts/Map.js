import { defineLayout, uint, locstring, skip, skipN } from '../layout.js';

// This core moved map metadata to a hand-maintained `map_template` SQL
// table (SQLStorages.cpp), so MapEntryfmt survives in DBCfmt.h but nothing
// parses Map.dbc with it any more, and Maps/Map.h's MapEntry is that SQL
// table's shape, not the DBC's - it cannot be used to name these fields.
// MapEntryfmt itself still holds - unchanged in mangoszero-server and
// tortoise-wow - "nxixssssssssxxxxxxxixxxxxxxxxxxxxxxxxxixxx", and the four
// fields it does not skip check out against this client's real Map.dbc: id, then
// instance_type reads 0 for every continent/city map, 1 for every five-man
// instance, 2 for every raid and 3 for exactly Alterac Valley/Warsong
// Gulch/Arathi Basin (plus the unused PvPZone02 stub) - the standard
// MAP_COMMON/MAP_INSTANCE/MAP_RAID/MAP_BATTLEGROUND split - then the
// localized map name.
//
// The two remaining integers (fields 19 and 38) are real, read fields with
// no core struct behind them. A community layout for this build calls field
// 19 ParentMapID, but this file's own data does not support that name: city
// instances read values like 717, 1337 and 2437 there, far past this
// client's ~550 map ids and squarely in AreaTable's id range instead, so
// whatever it references is not a map. Field 38 has no candidate that
// survives inspection at all. Both are left unk_<index> rather than carry a
// name the data contradicts or that nothing backs.
export default defineLayout({
  table: 'map',
  file: 'Map.dbc',
  columns: [
    uint('id'), skip(),
    uint('instance_type'), skip(),
    locstring('name'),
    skipN(6),
    uint('unk_19'),
    skipN(18),
    uint('unk_38'),
    skipN(3)
  ]
});
