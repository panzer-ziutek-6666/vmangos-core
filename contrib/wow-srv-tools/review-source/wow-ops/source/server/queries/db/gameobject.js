import { quoteIdentifier, worldSchema } from './sql.js';
import { fetchTemplateRow } from './progressive.js';
import { fetchLoot } from './loot.js';
import { fetchGameObjectSpawns } from './spawns.js';
import { fetchNames, fetchItemNamesWithQuality } from '../../dbLookups/names.js';
import { fetchFaction } from '../../dbLookups/factions.js';
import { fetchMapNames } from '../../dbLookups/maps.js';
import { knownDataSlots } from '../../dbLookups/gameObjectTypes.js';

// A cap on rows rendered, not a cap on what spawns - fetchGameObjectSpawns
// still returns the true COUNT(*) alongside them, the same convention
// Task 9's creature page uses (server/queries/db/creature.js).
const SPAWN_LIMIT = 100;

// GameObjectInfo::GetLootId() only ever returns a nonzero value for these two
// types, and both read it from the same union slot: chest.lootId and
// fishinghole.lootId are both slot 1 of their respective structs
// (vmangos-core/src/game/Objects/GameObjectDefines.h:262-264 chest,
// :462-464 fishinghole; the switch itself is :670-680). Every other type -
// including 17 GAMEOBJECT_TYPE_FISHINGNODE, whose struct also names a
// lootId at slot 1 (GameObjectDefines.h:398-402) - falls through GetLootId()'s
// `default: return 0` and is never a loot-table home. Both types that do
// resolve are read through the same gameobject_loot_template store
// (LootTemplates_Gameobject, vmangos-core/src/game/LootMgr.cpp:47 and
// vmangos-core/src/game/Objects/Player.cpp:7925), so one lookup covers both.
const LOOT_DATA_SLOT = 1;
const LOOT_TYPES = new Set([3, 25]);

function lootIdFor(row, type) {
  return LOOT_TYPES.has(Number(type)) ? Number(row[`data${LOOT_DATA_SLOT}`]) : 0;
}

// Zero (or a type with no loot slot at all) means "no loot table" - querying
// entry = 0 would be a wasted round trip that could only ever match a row
// accidentally keyed 0, and a type outside LOOT_TYPES must not be queried at
// all, per the brief: a type 17 fishing node with a nonzero data1 must still
// report no loot, because the core never reads that slot as a loot id for it.
async function lootFor(pool, schema, lootId, wowPatch) {
  if (!lootId) return [];
  return fetchLoot(pool, { schema, table: 'gameobject_loot_template', lootId, wowPatch });
}

// data0..data23 are always present on the page - every slot, whether or not
// this type's data union names it (server/dbLookups/gameObjectTypes.js,
// knownDataSlots). A slot past a shorter type's union, or on a type with no
// struct in the union at all, gets `label: null` and the page shows the bare
// number rather than guessing.
function buildDataSlots(row, type) {
  const labels = knownDataSlots(type);
  const slots = [];
  for (let i = 0; i <= 23; i++) {
    slots.push({ index: i, value: Number(row[`data${i}`]), label: labels.get(i) ?? null });
  }
  return slots;
}

// gameobject_questrelation (offered here) and gameobject_involvedrelation
// (ended here) are both keyed on the gameobject's own entry as `id` and both
// carry patch_min/patch_max - the same shape and same columns creature.js's
// fetchQuestIds reads for creature_questrelation/creature_involvedrelation.
async function fetchQuestIds(pool, schema, table, entry, wowPatch) {
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const [rows] = await pool.query(
    `SELECT quest FROM ${qualified} WHERE id = ? AND patch_min <= ? AND ? <= patch_max`,
    [entry, wowPatch, wowPatch]
  );
  return rows.map((r) => Number(r.quest));
}

// Everything the gameobject page needs, in one call. Returns null when the
// world pool is not configured or the entry does not exist (patch-filtered,
// per fetchTemplateRow) - either way the route has nothing to render and can
// 404 instead of guessing.
export async function loadGameObject(pools, config, entry) {
  const pool = pools?.world;
  if (!pool) return null;
  const schema = worldSchema(config);
  if (!schema) return null;

  const wowPatch = config.realm.wowPatch;
  const clientBuild = config.realm.clientBuild;
  const numericEntry = Number(entry);

  const template = await fetchTemplateRow(pool, {
    schema, table: 'gameobject_template', entry: numericEntry, wowPatch
  });
  if (!template) return null;
  const row = template.row;
  const type = Number(row.type);

  const dataSlots = buildDataSlots(row, type);

  const [spawns, loot, questsGiven, questsEnded, faction] = await Promise.all([
    // A genuine query failure here must still propagate - a page reporting
    // "no spawns" when the database is unreachable is the confident
    // falsehood this section exists not to print (creature.js's own
    // comment on this point applies unchanged).
    fetchGameObjectSpawns(pool, { schema, entry: numericEntry, wowPatch, limit: SPAWN_LIMIT }),
    lootFor(pool, schema, lootIdFor(row, type), wowPatch),
    fetchQuestIds(pool, schema, 'gameobject_questrelation', numericEntry, wowPatch),
    fetchQuestIds(pool, schema, 'gameobject_involvedrelation', numericEntry, wowPatch),
    // gameobject_template.faction is a faction_template id, the same id
    // space creature_template.faction lives in (Task 9's fetchFaction call
    // in creature.js) - not the plain `faction` (Faction.dbc) id
    // quest_template.RewRepFaction1..5 uses (Task 11's fetchFactionNames).
    // GameObject::IsHostileTo resolves it through GetFactionTemplateEntry()
    // (vmangos-core/src/game/Objects/GameObject.cpp:2124); the same function
    // treats 0 as "no faction set" (GameObject.cpp:2120, `if
    // (!GetGOInfo()->faction) return true`), so the lookup is skipped
    // entirely for a zero value rather than asking fetchFaction for a
    // faction_template row that was never meant to exist.
    Number(row.faction)
      ? fetchFaction(pool, { schema, factionTemplateId: Number(row.faction), clientBuild })
      : Promise.resolve(null)
  ]);

  // Batched by kind, one fetchNames call each - never one query per id.
  const itemIds = loot.map((l) => l.item);
  const questIds = [...questsGiven, ...questsEnded];
  const mapIds = spawns.rows.map((s) => s.map);

  const [{ names: itemNames, qualities: itemQuality }, questNames, mapNames] = await Promise.all([
    fetchItemNamesWithQuality(pool, { schema, ids: itemIds, wowPatch }),
    fetchNames(pool, { schema, kind: 'quest', ids: questIds, wowPatch, clientBuild }),
    fetchMapNames(pool, { schema, mapIds, wowPatch })
  ]);

  return {
    entry: numericEntry,
    patch: template.patch,
    patches: template.patches,
    row,
    dataSlots,
    faction,
    spawns,
    loot,
    questsGiven, questsEnded,
    names: { item: itemNames, itemQuality, quest: questNames },
    maps: mapNames
  };
}
