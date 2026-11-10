import { quoteIdentifier } from './sql.js';

// The loot filter the core applies at load time: the row's patch range must
// contain the running patch, and the item must not be forbidden for it. A
// reference row (mincountOrRef < 0) is exempt from the forbidden check
// because its `item` column does not name a real item to check - on this
// database it holds -mincountOrRef, i.e. the reference entry the row points
// at, not an item id (see fetchDropSources below for how this bit anyone who
// assumed otherwise) - the same exemption LootMgr.cpp:105 makes.
// vmangos-core/src/game/LootMgr.cpp:105 (LootStore::LoadLootTable)
function lootRowsSql(schema, table) {
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const forbidden = `${quoteIdentifier(schema)}.${quoteIdentifier('forbidden_items')}`;
  return `SELECT entry, item, ChanceOrQuestChance, groupid, mincountOrRef, maxcount, condition_id
    FROM ${qualified}
    WHERE entry = ?
      AND patch_min <= ? AND ? <= patch_max
      AND ((mincountOrRef < 0) OR (item NOT IN (
        SELECT entry FROM ${forbidden}
        WHERE (after_or_before = 0 AND patch <= ?) OR (after_or_before = 1 AND patch >= ?)
      )))`;
}

async function queryLootRows(pool, schema, table, entry, wowPatch) {
  const [rows] = await pool.query(lootRowsSql(schema, table), [entry, wowPatch, wowPatch, wowPatch, wowPatch]);
  return rows;
}

// Walks one loot table entry, expanding reference rows (mincountOrRef < 0)
// into the rows they point at in reference_loot_template - the same
// substitution LootTemplate::Process performs at runtime
// (vmangos-core/src/game/LootMgr.cpp, LootTemplate::Process /
// LootTemplate::CopyConditions walk the same negative-mincountOrRef link).
// `visited` guards the walk: the world DB here is a released third-party
// dump, and nothing about it promises the reference graph is acyclic, so a
// self- or mutually-referencing chain must terminate rather than hang the
// page that renders it.
async function walk(pool, schema, table, entry, wowPatch, viaReference, visited, results) {
  if (visited.has(entry)) return;
  visited.add(entry);

  const rows = await queryLootRows(pool, schema, table, entry, wowPatch);
  for (const row of rows) {
    const mincountOrRef = Number(row.mincountOrRef);
    if (mincountOrRef < 0) {
      const referencedEntry = -mincountOrRef;
      // Every hop past the first reads reference_loot_template, never the
      // original table - references do not chain back into creature/gameobject
      // loot tables, only into the shared reference store.
      await walk(pool, schema, 'reference_loot_template', referencedEntry, wowPatch, referencedEntry, visited, results);
      continue;
    }

    // One column, two values: the core reads the chance as its absolute
    // value and the sign as the quest-drop flag - vmangos-core's
    // LootStoreItem constructor, src/game/LootMgr.h:119. Carrying the raw
    // number forward would report a 100% quest drop as -100%.
    const chanceOrQuestChance = Number(row.ChanceOrQuestChance);

    results.push({
      item: Number(row.item),
      chance: Math.abs(chanceOrQuestChance),
      needsQuest: chanceOrQuestChance < 0,
      groupId: Number(row.groupid),
      minCount: mincountOrRef,
      maxCount: Number(row.maxcount),
      conditionId: Number(row.condition_id),
      viaReference
    });
  }
}

// Resolves the loot a template actually drops: `lootId` (creature_template.loot_id,
// item_template.*LootTemplate, gameobject_template.data*, etc - never assumed
// to equal the owning entry, since 21 creature templates on this realm have
// loot_id != entry) read straight, with reference rows expanded in place.
export async function fetchLoot(pool, { schema, table, lootId, wowPatch }) {
  const results = [];
  await walk(pool, schema, table, lootId, wowPatch, null, new Set(), results);
  return results;
}

// The reverse direction: given an item, which loot table entries drop it -
// either directly, or by pointing (mincountOrRef < 0) at a reference_loot_template
// entry that carries it.
export async function fetchDropSources(pool, { schema, table, item, wowPatch }) {
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const forbidden = `${quoteIdentifier(schema)}.${quoteIdentifier('forbidden_items')}`;

  // Direct droppers: the table's own rows naming this item. A reference row
  // (mincountOrRef < 0) does NOT carry item = 0 - on this database it stores
  // item = -mincountOrRef, i.e. the reference entry number it points at
  // (confirmed against creature_loot_template: every row with
  // mincountOrRef < 0 has item = -mincountOrRef). Without `mincountOrRef > 0`
  // here, `item = ?` also matches every reference row that happens to POINT
  // AT a reference entry equal to the item id being searched for, which is a
  // coincidence of numbering, not a real drop - live-confirmed for item 2043,
  // which `/db/item/2043` showed as "dropped by" Baron Bloodbane (entry
  // 10819) solely because that creature's loot table references
  // reference_loot_template entry 2043, and 2043 is also an item id on this
  // realm. Items 2023, 2043 and 2073 are affected the same way.
  const [directRows] = await pool.query(
    `SELECT entry FROM ${qualified}
     WHERE item = ?
       AND mincountOrRef > 0
       AND patch_min <= ? AND ? <= patch_max
       AND item NOT IN (
         SELECT entry FROM ${forbidden}
         WHERE (after_or_before = 0 AND patch <= ?) OR (after_or_before = 1 AND patch >= ?)
       )`,
    [item, wowPatch, wowPatch, wowPatch, wowPatch]
  );
  const sources = directRows.map((row) => ({ lootEntry: Number(row.entry), viaReference: null }));

  // Reference entries that carry this item, subject to the same load-time
  // filter - reference_loot_template is loaded through the identical
  // LootStore::LoadLootTable path (LootMgr.cpp:105).
  // Same `mincountOrRef > 0` guard as directRows above: reference_loot_template
  // can itself hold nested reference rows (19 on this realm), whose `item`
  // column is likewise the entry they point at, not a real item.
  const referenceTable = `${quoteIdentifier(schema)}.${quoteIdentifier('reference_loot_template')}`;
  const [referenceRows] = await pool.query(
    `SELECT entry FROM ${referenceTable}
     WHERE item = ?
       AND mincountOrRef > 0
       AND patch_min <= ? AND ? <= patch_max
       AND item NOT IN (
         SELECT entry FROM ${forbidden}
         WHERE (after_or_before = 0 AND patch <= ?) OR (after_or_before = 1 AND patch >= ?)
       )`,
    [item, wowPatch, wowPatch, wowPatch, wowPatch]
  );

  // For each reference entry, find the rows in `table` whose mincountOrRef
  // points at it (the negation) - these are the templates that inherit the
  // item through that reference. Reference-holding rows are exempt from the
  // forbidden check (LootMgr.cpp:105), so it is not repeated here.
  //
  // This unwinds exactly ONE level of reference indirection: it looks for a
  // holder in `table` (a creature/item/gameobject/... loot table) pointing
  // directly at `referenceEntry`, never for a holder in reference_loot_template
  // itself pointing at it (a nested reference, of which this realm's data has
  // 19 - reference_loot_template rows whose own mincountOrRef is negative).
  // The forward walk (`walk`, above) recurses arbitrarily deep and would
  // follow such a chain; this reverse direction does not. That is currently
  // sufficient rather than a bug: every nested reference target on this
  // database is also referenced directly from a creature loot table (checked
  // by hand against creature_loot_template - the count of items unreachable
  // by this one-hop reverse walk is exactly 0), so nothing is missed today.
  // A future world DB dump could introduce a reference reachable only through
  // another reference, at which point this would need to walk reference_loot_template
  // the same recursive way `walk` already does for the forward direction.
  for (const row of referenceRows) {
    const referenceEntry = Number(row.entry);
    const [holderRows] = await pool.query(
      `SELECT entry FROM ${qualified}
       WHERE mincountOrRef = ?
         AND patch_min <= ? AND ? <= patch_max`,
      [-referenceEntry, wowPatch, wowPatch]
    );
    for (const holder of holderRows) {
      sources.push({ lootEntry: Number(holder.entry), viaReference: referenceEntry });
    }
  }

  return sources;
}
