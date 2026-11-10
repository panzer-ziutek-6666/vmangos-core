import { typesBySlot } from '../../dbLookups/gameObjectTypes.js';

// Sorting is the one place a user-supplied string would have to become SQL
// text: a column name cannot be bound as a parameter. So it is not supplied -
// a key is looked up in this table, and anything not in it is the default.
// Same rule as server/commands/validate.js follows for GM command arguments:
// reject the value rather than try to make it safe.
export const GAMEOBJECT_SORTS = {
  name: 't1.name',
  type: 't1.type',
  entry: 't1.entry'
};

export const PAGE_SIZE = 50;

// A gameobject's lock, loot and quest ids live in a different data slot per
// type, so each is read through a CASE on t1.type rather than one fixed
// column. A realm-wide data0/data1 check called every spell focus locked and
// lootable (its data0 is a focus id, its data1 a radius) - the first row of
// the unfiltered /db/objects page showed exactly that on the 2026-09-23 walk.
// Type ids and slot indexes come from the constant tables in
// server/dbLookups/gameObjectTypes.js, never from the request.
function slotCase(bySlot) {
  const whens = [...bySlot].map(([index, types]) => `WHEN t1.type IN (${types.join(', ')}) THEN t1.data${index}`);
  return `(CASE ${whens.join(' ')} ELSE 0 END)`;
}

export const LOCK_ID_SQL = slotCase(typesBySlot('lock id'));
// Not typesBySlot('loot id'): that would take in 17 FISHINGNODE, whose struct
// names a loot id the core never reads. GameObjectInfo::GetLootId()
// (GameObjectDefines.h:670-680) returns one for chest and fishing hole
// only, both from data1.
export const LOOT_ID_SQL = slotCase(new Map([[1, [3, 25]]]));
// Every type whose struct names a quest id: chest data8 (GameObject.cpp:1227),
// generic data5 (:1243), spell focus data4 (:1249) and goober data1 (:1255),
// the same four ObjectMgr.cpp:9791-9818 collects as quest objects. A goober's
// -1 is a marker, not a quest (ObjectMgr.cpp:9818 tests > 0), so the listview
// treats > 0 as "needs a quest".
export const QUEST_ID_SQL = slotCase(typesBySlot('quest id'));

function intOrNull(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

// A person typing "100%" into the name box means those characters, not
// "anything". LIKE's own wildcards are escaped before the term is bound.
function likeTerm(text) {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
  return `%${escaped}%`;
}

// A truthy checkbox, not a value: an unchecked HTML checkbox is simply
// absent from the submitted form, so any non-empty string here (however the
// form spells "on") means the box was checked.
function isSet(value) {
  return typeof value === 'string' && value !== '';
}

export function parseGameObjectFilters(query = {}) {
  const conditions = [];
  const params = [];
  const applied = {};

  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q) {
    conditions.push('t1.name LIKE ?');
    params.push(likeTerm(q));
    applied.q = q;
  }

  // GameobjectTypes, vmangos-core/src/game/Objects/GameObjectDefines.h:24-67:
  // GAMEOBJECT_TYPE_DOOR = 0 (line 26) through GAMEOBJECT_TYPE_AURA_GENERATOR
  // = 30 (line 65); GAMEOBJECT_TYPE_MAX (line 67) closes the enum and is not
  // a real type. 31 compiled-in values, all live for this 1.12.1 build (no
  // #if gate excludes any of them) - this realm's gameobject_template
  // carries 27 of the 31 distinct.
  const value = intOrNull(query.type, { max: 30 });
  if (value !== null) {
    conditions.push('t1.type = ?');
    params.push(value);
    applied.type = value;
  }

  // Presence, not a value: each type's own lock or loot slot is non-zero
  // (LOCK_ID_SQL, LOOT_ID_SQL above). No parameter is bound.
  if (isSet(query.locked)) {
    conditions.push(`${LOCK_ID_SQL} <> 0`);
    applied.locked = true;
  }
  if (isSet(query.loot)) {
    conditions.push(`${LOOT_ID_SQL} <> 0`);
    applied.loot = true;
  }

  const sort = Object.hasOwn(GAMEOBJECT_SORTS, query.sort) ? query.sort : 'name';
  const dir = query.dir === 'desc' ? 'desc' : 'asc';
  const page = intOrNull(query.page, { min: 1 }) ?? 1;

  applied.sort = sort;
  applied.dir = dir;
  applied.page = page;

  return { conditions, params, sort, dir, page, pageSize: PAGE_SIZE, applied };
}
