import { quoteIdentifier, worldSchema } from './sql.js';
import { fetchTemplateRow } from './progressive.js';
import { fetchLoot } from './loot.js';
import { fetchCreatureSpawns } from './spawns.js';
import { fetchNames, fetchItemNamesWithQuality } from '../../dbLookups/names.js';
import { resolveTaughtSpellIds } from '../../dbLookups/spellLabels.js';
import { fetchFaction } from '../../dbLookups/factions.js';
import { fetchMapNames } from '../../dbLookups/maps.js';

// A cap on rows rendered, not a cap on what spawns - fetchCreatureSpawns still
// returns the true COUNT(*) alongside them. A hundred is generous for a page
// meant to say "here is roughly where this thing stands", not to list every
// guid on the realm.
const SPAWN_LIMIT = 100;

// Zero is "no loot table" on this realm (loot_id/pickpocket_loot_id/
// skinning_loot_id all default to 0, and the creature simply drops nothing
// through that channel) - 9581 creature_template rows on this realm have
// loot_id = 0. Querying entry = 0 against *_loot_template would be a wasted
// round trip that could only ever match a template accidentally keyed 0.
async function lootFor(pool, schema, table, lootId, wowPatch) {
  if (!lootId) return [];
  return fetchLoot(pool, { schema, table, lootId, wowPatch });
}

// npc_vendor (keyed on the creature entry) and npc_vendor_template (keyed on
// creature_template.vendor_id) are read the same way by the core - see
// ObjectMgr::LoadVendors, called once as LoadVendors("npc_vendor", false) and
// once as LoadVendors("npc_vendor_template", true)
// (vmangos-core/src/game/ObjectMgr.h:969-970,
// vmangos-core/src/game/ObjectMgr.cpp:10848-10901). Both tables share the
// same column set; only which column holds the lookup key differs, and that
// key is `entry` in both cases (the creature's own entry in npc_vendor, the
// vendor_id in npc_vendor_template).
//
// Both calls also share the same forbidden_items filter, applied to the raw
// SQL itself rather than after the fact (ObjectMgr.cpp:10857):
// `item NOT IN (SELECT entry FROM forbidden_items WHERE (after_or_before = 0
// AND patch <= wowPatch) OR (after_or_before = 1 AND patch >= wowPatch))`.
// Without it this page would show stock the live server never actually
// loaded for the running patch - the exact failure mode this section exists
// to avoid, and the same filter loot.js already applies to loot rows.
async function fetchVendorRows(pool, schema, table, keyValue, wowPatch) {
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const forbidden = `${quoteIdentifier(schema)}.${quoteIdentifier('forbidden_items')}`;
  const [rows] = await pool.query(
    `SELECT item, maxcount, incrtime, itemflags, condition_id FROM ${qualified}
     WHERE entry = ?
       AND item NOT IN (
         SELECT entry FROM ${forbidden}
         WHERE (after_or_before = 0 AND patch <= ?) OR (after_or_before = 1 AND patch >= ?)
       )
     ORDER BY slot`,
    [keyValue, wowPatch, wowPatch]
  );
  return rows.map((r) => ({
    item: Number(r.item),
    maxCount: Number(r.maxcount),
    incrTime: Number(r.incrtime),
    itemFlags: Number(r.itemflags),
    conditionId: Number(r.condition_id)
  }));
}

// The trainer half of the same split: npc_trainer (creature entry) and
// npc_trainer_template (creature_template.trainer_id), read by
// ObjectMgr::LoadTrainers the same two-call way
// (vmangos-core/src/game/ObjectMgr.h:971,
// vmangos-core/src/game/ObjectMgr.cpp:10668-10846). Unlike the loot and
// template stores, npc_trainer/npc_trainer_template carry no patch column at
// all - the core filters them on the running client build instead
// (`%u BETWEEN build_min AND build_max`, ObjectMgr.cpp:10690), so this reads
// clientBuild, not wowPatch.
async function fetchTrainerRows(pool, schema, table, keyValue, clientBuild) {
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const [rows] = await pool.query(
    `SELECT spell, spellcost, reqskill, reqskillvalue, reqlevel FROM ${qualified}
     WHERE entry = ? AND ? BETWEEN build_min AND build_max`,
    [keyValue, clientBuild]
  );
  return rows.map((r) => ({
    spell: Number(r.spell),
    spellCost: Number(r.spellcost),
    reqSkill: Number(r.reqskill),
    reqSkillValue: Number(r.reqskillvalue),
    reqLevel: Number(r.reqlevel)
  }));
}

// creature_questrelation (offered here) and creature_involvedrelation (ended
// here) are both keyed on the creature's own entry as `id`, and both carry
// patch_min/patch_max like every other progression-filtered table in this
// section - an unfiltered read would offer a quest relation the server never
// loaded for the running patch.
async function fetchQuestIds(pool, schema, table, entry, wowPatch) {
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const [rows] = await pool.query(
    `SELECT quest FROM ${qualified} WHERE id = ? AND patch_min <= ? AND ? <= patch_max`,
    [entry, wowPatch, wowPatch]
  );
  return rows.map((r) => Number(r.quest));
}

// Everything the creature page needs, in one call. Returns null when the
// world pool is not configured or the entry does not exist (patch-filtered,
// per fetchTemplateRow) - either way the route has nothing to render and can
// 404 instead of guessing.
export async function loadCreature(pools, config, entry) {
  const pool = pools?.world;
  if (!pool) return null;
  const schema = worldSchema(config);
  if (!schema) return null;

  const wowPatch = config.realm.wowPatch;
  const clientBuild = config.realm.clientBuild;
  const numericEntry = Number(entry);

  const template = await fetchTemplateRow(pool, {
    schema, table: 'creature_template', entry: numericEntry, wowPatch
  });
  if (!template) return null;
  const row = template.row;

  const [
    faction,
    spawns,
    loot, pickpocketLoot, skinningLoot,
    vendorOwn, vendorTemplate,
    trainerOwn, trainerTemplate,
    questsGiven, questsEnded
  ] = await Promise.all([
    fetchFaction(pool, { schema, factionTemplateId: Number(row.faction), clientBuild }),
    // A genuine query failure here (a dead pool, say) must still propagate -
    // a page that reports "no spawns" when the truth is "the database is
    // unreachable" is exactly the kind of confident falsehood this section
    // exists not to print. The one thing that must not throw is a COUNT(*)
    // that comes back with zero rows, which spawns.js now guards directly.
    fetchCreatureSpawns(pool, { schema, entry: numericEntry, wowPatch, limit: SPAWN_LIMIT }),
    lootFor(pool, schema, 'creature_loot_template', Number(row.loot_id), wowPatch),
    lootFor(pool, schema, 'pickpocketing_loot_template', Number(row.pickpocket_loot_id), wowPatch),
    lootFor(pool, schema, 'skinning_loot_template', Number(row.skinning_loot_id), wowPatch),
    fetchVendorRows(pool, schema, 'npc_vendor', numericEntry, wowPatch),
    Number(row.vendor_id)
      ? fetchVendorRows(pool, schema, 'npc_vendor_template', Number(row.vendor_id), wowPatch)
      : Promise.resolve([]),
    fetchTrainerRows(pool, schema, 'npc_trainer', numericEntry, clientBuild),
    Number(row.trainer_id)
      ? fetchTrainerRows(pool, schema, 'npc_trainer_template', Number(row.trainer_id), clientBuild)
      : Promise.resolve([]),
    fetchQuestIds(pool, schema, 'creature_questrelation', numericEntry, wowPatch),
    fetchQuestIds(pool, schema, 'creature_involvedrelation', numericEntry, wowPatch)
  ]);

  const vendor = [
    ...vendorOwn.map((v) => ({ ...v, source: 'creature' })),
    ...vendorTemplate.map((v) => ({ ...v, source: 'template' }))
  ];
  const trainerRaw = [
    ...trainerOwn.map((t) => ({ ...t, source: 'creature' })),
    ...trainerTemplate.map((t) => ({ ...t, source: 'template' }))
  ];

  // A trainer row's own `spell` column often names a teaching spell, not the
  // spell it grants (see resolveTaughtSpellIds) - one batch read of every
  // trainer spell on this creature resolves each to the spell its page and
  // link should actually name.
  const taughtByTrainerSpell = await resolveTaughtSpellIds(pool, {
    schema, ids: trainerRaw.map((t) => t.spell), clientBuild
  });
  const trainer = trainerRaw.map((t) => ({ ...t, taughtSpell: taughtByTrainerSpell.get(t.spell) ?? t.spell }));

  // Batched by kind, one fetchNames call each - never one query per id. A
  // creature page can carry two hundred loot rows on its own; a query per id
  // would turn one page load into hundreds of round trips.
  const itemIds = [
    ...loot.map((l) => l.item),
    ...pickpocketLoot.map((l) => l.item),
    ...skinningLoot.map((l) => l.item),
    ...vendor.map((v) => v.item)
  ];
  const questIds = [...questsGiven, ...questsEnded];
  const spellIds = trainer.map((t) => t.taughtSpell);
  const mapIds = spawns.rows.map((s) => s.map);

  const [{ names: itemNames, qualities: itemQuality }, questNames, spellNames, mapNames] = await Promise.all([
    fetchItemNamesWithQuality(pool, { schema, ids: itemIds, wowPatch }),
    fetchNames(pool, { schema, kind: 'quest', ids: questIds, wowPatch, clientBuild }),
    fetchNames(pool, { schema, kind: 'spell', ids: spellIds, wowPatch, clientBuild }),
    fetchMapNames(pool, { schema, mapIds, wowPatch })
  ]);

  return {
    entry: numericEntry,
    patch: template.patch,
    patches: template.patches,
    row,
    faction,
    spawns,
    loot, pickpocketLoot, skinningLoot,
    vendor, trainer,
    questsGiven, questsEnded,
    names: { item: itemNames, itemQuality, quest: questNames, spell: spellNames },
    maps: mapNames
  };
}
