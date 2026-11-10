import { quoteIdentifier, worldSchema, withMissingReference } from './sql.js';
import { fetchTemplateRow, highestPatchClause } from './progressive.js';
import { fetchDropSources } from './loot.js';
import { fetchNames, fetchItemNamesWithQuality } from '../../dbLookups/names.js';
import { fetchAreaNames } from '../../dbLookups/maps.js';

// The reverse of Task 9's creature page: given an item, everything that can
// hand it to a player. Every loot-table home that can name an item is read -
// vmangos-core/src/game/LootMgr.cpp:44-52 lists the full set - and each one's
// `entry` is mapped back to the thing that actually owns it, never assumed to
// equal that thing's own entry. That assumption is exactly the trap Task 9's
// creature page documents for loot_id (21 templates on this realm have a
// loot_id that is not their own entry); the same trap exists in reverse here
// for skinning_loot_id, pickpocket_loot_id and vendor_id.

// Collapses a fetchDropSources() result into "the viaReference recorded the
// first time this lootEntry was seen" - direct rows are pushed before
// reference-derived ones (loot.js), so a lootEntry that is reachable both
// directly and through a reference reports the direct route.
function viaReferenceByLootEntry(dropSources) {
  const map = new Map();
  for (const source of dropSources) {
    if (!map.has(source.lootEntry)) map.set(source.lootEntry, source.viaReference);
  }
  return map;
}

// Maps loot-table entries back to the creature_template row that actually
// carries that value in `column` (loot_id / pickpocket_loot_id /
// skinning_loot_id / vendor_id) - the reverse of creature.js's forward read,
// and wrong the same way if done by assuming the value equals the creature's
// own entry.
async function fetchOwningCreatures(pool, schema, wowPatch, column, values) {
  const unique = [...new Set(values.map(Number).filter(Number.isInteger).filter((v) => v !== 0))];
  if (unique.length === 0) return [];
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier('creature_template')}`;
  const col = quoteIdentifier(column);
  const placeholders = unique.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT t1.entry, t1.${col} AS matched FROM ${qualified} t1
     WHERE t1.${col} IN (${placeholders}) AND ${highestPatchClause(schema, 'creature_template', 't1')}`,
    [...unique, wowPatch]
  );
  return rows.map((r) => ({ entry: Number(r.entry), matched: Number(r.matched) }));
}

// gameobject_loot_template's `entry` is not a gameobject_template entry
// either - the core resolves it per gameobject type through
// GameObjectInfo::GetLootId(), and only GAMEOBJECT_TYPE_CHEST (3) and
// GAMEOBJECT_TYPE_FISHINGHOLE (25) ever return a non-zero value, both from
// their template's `data1` column (chest.lootId / fishinghole.lootId -
// vmangos-core/src/game/Objects/GameObjectDefines.h:262-264,462-464,670-678).
// Every other gameobject type is never a loot-table home.
async function fetchOwningGameobjects(pool, schema, wowPatch, values) {
  const unique = [...new Set(values.map(Number).filter(Number.isInteger))];
  if (unique.length === 0) return [];
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier('gameobject_template')}`;
  const placeholders = unique.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT t1.entry, t1.data1 AS matched FROM ${qualified} t1
     WHERE t1.type IN (3, 25) AND t1.data1 IN (${placeholders}) AND ${highestPatchClause(schema, 'gameobject_template', 't1')}`,
    [...unique, wowPatch]
  );
  return rows.map((r) => ({ entry: Number(r.entry), matched: Number(r.matched) }));
}

// npc_vendor (keyed on the creature's own entry) and npc_vendor_template
// (keyed on creature_template.vendor_id) are both read the reverse way here:
// which vendor rows stock this item. Same forbidden_items filter
// ObjectMgr::LoadVendors applies at load time (vmangos-core/src/game/ObjectMgr.cpp:10857)
// - without it this page would list a seller the live server never actually
// loaded for the running patch.
async function fetchVendorEntries(pool, schema, table, item, wowPatch) {
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const forbidden = `${quoteIdentifier(schema)}.${quoteIdentifier('forbidden_items')}`;
  const [rows] = await pool.query(
    `SELECT entry FROM ${qualified}
     WHERE item = ?
       AND item NOT IN (
         SELECT entry FROM ${forbidden}
         WHERE (after_or_before = 0 AND patch <= ?) OR (after_or_before = 1 AND patch >= ?)
       )`,
    [item, wowPatch, wowPatch]
  );
  return rows.map((r) => Number(r.entry));
}

// The four quest_template column families that can name an item
// (vmangos-core world DB schema): required as a turn-in (ReqItemId1..4) or
// as a source drop (ReqSourceId1..4), or rewarded outright (RewItemId1..4)
// or as a reward choice (RewChoiceItemId1..6). Read in one query, under the
// same progressive patch clause every other template table here uses.
const QUEST_REQUIRE_COLUMNS = [
  'ReqItemId1', 'ReqItemId2', 'ReqItemId3', 'ReqItemId4',
  'ReqSourceId1', 'ReqSourceId2', 'ReqSourceId3', 'ReqSourceId4'
];
const QUEST_REWARD_COLUMNS = [
  'RewItemId1', 'RewItemId2', 'RewItemId3', 'RewItemId4',
  'RewChoiceItemId1', 'RewChoiceItemId2', 'RewChoiceItemId3',
  'RewChoiceItemId4', 'RewChoiceItemId5', 'RewChoiceItemId6'
];
const QUEST_ITEM_COLUMNS = [...QUEST_REQUIRE_COLUMNS, ...QUEST_REWARD_COLUMNS];

async function fetchQuestRows(pool, schema, item, wowPatch) {
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier('quest_template')}`;
  const quoted = QUEST_ITEM_COLUMNS.map((c) => quoteIdentifier(c));
  const selectCols = quoted.map((c) => `t1.${c}`).join(', ');
  const whereCols = quoted.map((c) => `t1.${c} = ?`).join(' OR ');
  const [rows] = await pool.query(
    `SELECT t1.entry, ${selectCols} FROM ${qualified} t1
     WHERE (${whereCols}) AND ${highestPatchClause(schema, 'quest_template', 't1')}`,
    [...QUEST_ITEM_COLUMNS.map(() => item), wowPatch]
  );
  return rows;
}

const NO_EXTRAS = { inventoryIcon: null, setName: null };

// The icon and set name both live in the reference schema the importer
// (tools/import-dbc.js) writes, which may never have been run on this
// checkout - the same optional-join rule listItems() already follows
// (server/queries/db/items.js). Without dbcSchema configured, neither read
// happens at all: both come back null rather than as an empty query. A
// configured-but-missing-or-partial schema (the importer failed or was never
// run to completion) fails the query itself rather than returning an empty
// result, so that path is caught by withMissingReference and falls back to
// the same nulls, instead of surfacing the driver's raw error.
async function fetchItemExtras(pool, dbcSchema, row) {
  if (!dbcSchema) return NO_EXTRAS;

  return withMissingReference(NO_EXTRAS, async () => {
    const display = `${quoteIdentifier(dbcSchema)}.${quoteIdentifier('item_display_info')}`;
    const itemSet = `${quoteIdentifier(dbcSchema)}.${quoteIdentifier('item_set')}`;
    const [[iconRows], [setRows]] = await Promise.all([
      pool.query(`SELECT inventory_icon FROM ${display} WHERE id = ?`, [Number(row.display_id) || 0]),
      pool.query(`SELECT name FROM ${itemSet} WHERE id = ?`, [Number(row.set_id) || 0])
    ]);
    return {
      inventoryIcon: iconRows[0]?.inventory_icon ?? null,
      setName: setRows[0]?.name ?? null
    };
  });
}

function classifyQuests(rows, item) {
  const requiring = [];
  const rewarding = [];
  for (const row of rows) {
    const entry = Number(row.entry);
    const requires = QUEST_REQUIRE_COLUMNS.some((c) => Number(row[c]) === item);
    const rewards = QUEST_REWARD_COLUMNS.some((c) => Number(row[c]) === item);
    if (requires) requiring.push(entry);
    if (rewards) rewarding.push(entry);
  }
  return { questsRequiring: requiring, questsRewarding: rewarding };
}

// Everything the item page needs, in one call. Returns null when the world
// pool is not configured or the entry does not exist (patch-filtered, per
// fetchTemplateRow) - either way the route has nothing to render and can 404
// instead of guessing.
export async function loadItem(pools, config, entry) {
  const pool = pools?.world;
  if (!pool) return null;
  const schema = worldSchema(config);
  if (!schema) return null;
  const dbcSchema = config.mysql?.dbcSchema ?? null;

  const wowPatch = config.realm.wowPatch;
  const clientBuild = config.realm.clientBuild;
  const numericEntry = Number(entry);

  const template = await fetchTemplateRow(pool, {
    schema, table: 'item_template', entry: numericEntry, wowPatch
  });
  if (!template) return null;
  const row = template.row;

  const [
    creatureDrops, itemDrops, objectDrops,
    skinningDrops, pickpocketDrops, fishingDrops,
    vendorCreature, vendorTemplateIds,
    questRows, extras
  ] = await Promise.all([
    fetchDropSources(pool, { schema, table: 'creature_loot_template', item: numericEntry, wowPatch }),
    fetchDropSources(pool, { schema, table: 'item_loot_template', item: numericEntry, wowPatch }),
    fetchDropSources(pool, { schema, table: 'gameobject_loot_template', item: numericEntry, wowPatch }),
    fetchDropSources(pool, { schema, table: 'skinning_loot_template', item: numericEntry, wowPatch }),
    fetchDropSources(pool, { schema, table: 'pickpocketing_loot_template', item: numericEntry, wowPatch }),
    fetchDropSources(pool, { schema, table: 'fishing_loot_template', item: numericEntry, wowPatch }),
    fetchVendorEntries(pool, schema, 'npc_vendor', numericEntry, wowPatch),
    fetchVendorEntries(pool, schema, 'npc_vendor_template', numericEntry, wowPatch),
    fetchQuestRows(pool, schema, numericEntry, wowPatch),
    fetchItemExtras(pool, dbcSchema, row)
  ]);

  const [creatureOwners, skinningOwners, pickpocketOwners, vendorTemplateOwners] = await Promise.all([
    fetchOwningCreatures(pool, schema, wowPatch, 'loot_id', creatureDrops.map((d) => d.lootEntry)),
    fetchOwningCreatures(pool, schema, wowPatch, 'skinning_loot_id', skinningDrops.map((d) => d.lootEntry)),
    fetchOwningCreatures(pool, schema, wowPatch, 'pickpocket_loot_id', pickpocketDrops.map((d) => d.lootEntry)),
    fetchOwningCreatures(pool, schema, wowPatch, 'vendor_id', vendorTemplateIds)
  ]);
  const objectOwners = await fetchOwningGameobjects(pool, schema, wowPatch, objectDrops.map((d) => d.lootEntry));

  // Batched by kind, one fetchNames call each - never one query per id.
  const creatureIds = [
    ...creatureOwners.map((o) => o.entry),
    ...skinningOwners.map((o) => o.entry),
    ...pickpocketOwners.map((o) => o.entry),
    ...vendorCreature,
    ...vendorTemplateOwners.map((o) => o.entry)
  ];
  const itemIds = itemDrops.map((d) => d.lootEntry);
  const gameobjectIds = objectOwners.map((o) => o.entry);
  const questIds = questRows.map((r) => Number(r.entry));
  const areaIds = fishingDrops.map((d) => d.lootEntry);
  const spellIds = [1, 2, 3, 4, 5]
    .map((i) => Number(row[`spellid_${i}`]))
    .filter((id) => id);

  const [creatureNames, { names: itemNames, qualities: itemQuality }, gameobjectNames, questNames, areaNames, spellNames] = await Promise.all([
    fetchNames(pool, { schema, kind: 'creature', ids: creatureIds, wowPatch, clientBuild }),
    fetchItemNamesWithQuality(pool, { schema, ids: itemIds, wowPatch }),
    fetchNames(pool, { schema, kind: 'gameobject', ids: gameobjectIds, wowPatch, clientBuild }),
    fetchNames(pool, { schema, kind: 'quest', ids: questIds, wowPatch, clientBuild }),
    fetchAreaNames(pool, { schema, areaIds }),
    fetchNames(pool, { schema, kind: 'spell', ids: spellIds, wowPatch, clientBuild })
  ]);

  const creatureVia = viaReferenceByLootEntry(creatureDrops);
  const objectVia = viaReferenceByLootEntry(objectDrops);
  const skinningVia = viaReferenceByLootEntry(skinningDrops);
  const pickpocketVia = viaReferenceByLootEntry(pickpocketDrops);

  const droppedBy = creatureOwners.map((o) => ({
    entry: o.entry,
    name: creatureNames.get(o.entry) ?? null,
    viaReference: creatureVia.get(o.matched) ?? null
  }));

  // item_loot_template is keyed on the container item's own entry
  // ("item entry with ITEM_FLAG_LOOTABLE", LootMgr.cpp:48) - no reverse join
  // is needed, the lootEntry already is the container's item_template entry.
  const containedIn = itemDrops.map((d) => ({
    entry: d.lootEntry,
    name: itemNames.get(d.lootEntry) ?? null,
    quality: itemQuality.get(d.lootEntry) ?? null,
    viaReference: d.viaReference
  }));

  const objectLoot = objectOwners.map((o) => ({
    entry: o.entry,
    name: gameobjectNames.get(o.entry) ?? null,
    viaReference: objectVia.get(o.matched) ?? null
  }));

  // fishing_loot_template's entry is an Area.dbc id ("area id", LootMgr.cpp:46),
  // not a creature or gameobject entry - resolved through area_template
  // (fetchAreaNames, server/dbLookups/maps.js), which every fishing entry on
  // this realm resolves through with zero misses.
  const gatheredFrom = {
    skinning: skinningOwners.map((o) => ({
      entry: o.entry,
      name: creatureNames.get(o.entry) ?? null,
      viaReference: skinningVia.get(o.matched) ?? null
    })),
    pickpocketing: pickpocketOwners.map((o) => ({
      entry: o.entry,
      name: creatureNames.get(o.entry) ?? null,
      viaReference: pickpocketVia.get(o.matched) ?? null
    })),
    fishing: fishingDrops.map((d) => ({
      entry: d.lootEntry,
      name: areaNames.get(d.lootEntry) ?? null,
      viaReference: d.viaReference
    }))
  };

  const soldBy = [
    ...vendorCreature.map((entry) => ({
      entry, name: creatureNames.get(entry) ?? null, viaReference: null, source: 'creature'
    })),
    ...vendorTemplateOwners.map((o) => ({
      entry: o.entry, name: creatureNames.get(o.entry) ?? null, viaReference: null, source: 'template'
    }))
  ];

  const { questsRequiring, questsRewarding } = classifyQuests(questRows, numericEntry);

  return {
    entry: numericEntry,
    patch: template.patch,
    patches: template.patches,
    row,
    inventoryIcon: extras.inventoryIcon,
    setName: extras.setName,
    droppedBy, containedIn, objectLoot, gatheredFrom, soldBy,
    questsRequiring, questsRewarding,
    names: { creature: creatureNames, item: itemNames, itemQuality, gameobject: gameobjectNames, quest: questNames, area: areaNames, spell: spellNames }
  };
}
