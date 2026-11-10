// Realm-list presentation values. Every table here was read out of this
// machine's own client or the core's source, not taken from convention.
//
// The realm type (realmlist.icon) is NOT interpreted by the core at all - it
// is passed through to the client verbatim (vmangos-core/src/realmd/
// RealmList.cpp:191). What the client does with it: GetRealmInfo
// (WoW.exe:0x46ee40) looks the value up in the Cfg_Configs.dbc store at
// 0xc0dfa0 (stride 0x14, type at +4, PvP at +8, RP at +0xc) and returns the
// two booleans to Interface\GlueXML\RealmList.lua:53-64, which picks the
// label. Cfg_Configs.dbc, extracted from the 1.12.1 client's patch.MPQ,
// holds exactly these 11 rows.
const REALM_TYPE_FLAGS = [
  { icon: 0, pvp: 0, rp: 0 },
  { icon: 1, pvp: 1, rp: 0 },
  { icon: 2, pvp: 0, rp: 0 },
  { icon: 3, pvp: 1, rp: 0 },
  { icon: 4, pvp: 0, rp: 0 },
  { icon: 5, pvp: 1, rp: 0 },
  { icon: 6, pvp: 0, rp: 1 },
  { icon: 7, pvp: 0, rp: 1 },
  { icon: 8, pvp: 1, rp: 1 },
  { icon: 9, pvp: 0, rp: 0 },
  { icon: 10, pvp: 1, rp: 0 }
];

function labelFor({ pvp, rp }) {
  if (pvp && rp) return 'RP PvP';
  if (rp) return 'RP';
  if (pvp) return 'PvP';
  return 'Normal';
}

export const REALM_TYPES = REALM_TYPE_FLAGS.map((t) => ({ icon: t.icon, label: labelFor(t) }));

// A value with no Cfg_Configs row leaves pvp and rp false in the client, so
// the realm list shows GAMETYPE_NORMAL. Mirror that rather than inventing an
// "unknown" the client never displays.
export function realmTypeName(icon) {
  return REALM_TYPES.find((t) => t.icon === Number(icon))?.label ?? 'Normal';
}

// vmangos-core/src/shared/RealmZone.h:23-52.
export const REALM_ZONES = [
  { id: 0, name: 'Unknown' }, { id: 1, name: 'Development' }, { id: 2, name: 'United States' },
  { id: 3, name: 'Oceanic' }, { id: 4, name: 'Latin America' }, { id: 5, name: 'Tournament 5' },
  { id: 6, name: 'Korea' }, { id: 7, name: 'Tournament 7' }, { id: 8, name: 'English' },
  { id: 9, name: 'German' }, { id: 10, name: 'French' }, { id: 11, name: 'Spanish' },
  { id: 12, name: 'Russian' }, { id: 13, name: 'Tournament 13' }, { id: 14, name: 'Taiwan' },
  { id: 15, name: 'Tournament 15' }, { id: 16, name: 'China' }, { id: 17, name: 'CN1' },
  { id: 18, name: 'CN2' }, { id: 19, name: 'CN3' }, { id: 20, name: 'CN4' },
  { id: 21, name: 'CN5' }, { id: 22, name: 'CN6' }, { id: 23, name: 'CN7' },
  { id: 24, name: 'CN8' }, { id: 25, name: 'Tournament 25' }, { id: 26, name: 'Test Server' },
  { id: 27, name: 'Tournament 27' }, { id: 28, name: 'QA Server' }, { id: 29, name: 'CN9' },
  { id: 30, name: 'Test Server 2' }
];

export function realmZoneName(id) {
  return REALM_ZONES.find((z) => z.id === Number(id))?.name ?? 'unknown';
}

// RealmCategoryIdsByRealmZoneByMajorVersion[1] - the Classic row - from
// vmangos-core/src/realmd/RealmList.cpp:70-88. This is what decides which
// tab of the client's realm list a realm appears under, and on a 1.12
// client nearly every zone collapses onto category 1.
const CLASSIC_CATEGORY_BY_ZONE = [
  0, 1, 1, 5, 1, 1, 1, 1, 1, 2, 3, 5, 1, 1, 1, 1, 1, 1, 1, 2,
  1, 1, 1, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1
];

export function realmCategoryForClassic(zoneId) {
  const zone = Number(zoneId);
  // GetRealmCategoryIdByBuildAndZone maps an out-of-range zone to
  // REALM_ZONE_DEVELOPMENT (1) before the lookup (RealmList.cpp:80-82).
  const index = Number.isInteger(zone) && zone >= 0 && zone < CLASSIC_CATEGORY_BY_ZONE.length ? zone : 1;
  return CLASSIC_CATEGORY_BY_ZONE[index];
}

// REALM_FLAG_INVALID (0x01) is not in this list because it is not a
// presentation flag: realmd's own query filters those rows out entirely
// (RealmList.cpp:177-181), so setting it hides the realm rather than
// decorating it. The panel offers it separately, as a visibility switch.
export const HIDDEN_FLAG_BIT = 1;

// Anything outside this mask is stripped by realmd with an error in the log
// (RealmList.cpp:198-202), so offering UNK1 (0x08), UNK2 (0x10) or FULL
// (0x80) would be offering a setting that silently does not stick.
export const REALM_FLAGS = [
  { bit: 0x02, name: 'offline', note: 'shown greyed out; the client refuses to connect' },
  { bit: 0x04, name: 'specify build', note: 'appends the version from the first realmbuilds entry to the name' },
  { bit: 0x20, name: 'new players', note: 'marked as a recommended realm for new players' },
  { bit: 0x40, name: 'recommended', note: 'marked as recommended' }
];

export const ALLOWED_FLAG_MASK = REALM_FLAGS.reduce((mask, f) => mask | f.bit, 0);

export function realmFlagNames(mask) {
  const value = Number(mask) || 0;
  return REALM_FLAGS.filter((f) => (value & f.bit) !== 0).map((f) => f.name);
}
