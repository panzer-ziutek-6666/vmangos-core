import { quoteIdentifier, worldSchema } from './sql.js';
import { fetchTemplateRow } from './progressive.js';
import { fetchNames, fetchItemNamesWithQuality } from '../../dbLookups/names.js';
import { fetchFactionNames } from '../../dbLookups/factions.js';
import { fetchAreaNames } from '../../dbLookups/maps.js';
import { resolveTaughtSpellIds } from '../../dbLookups/spellLabels.js';

// The most-columned template on this realm's world DB: quest_template has
// over a hundred columns, most of them numbered slots (Req*1..4, Rew*1..6,
// RewRep*1..5). Every family below reads all of its slots and drops the
// zero/empty ones rather than reporting `undefined` for a slot the row does
// carry a real zero for - "no requirement here" and "reader forgot to read
// this column" must never look the same on the page.
function extractIdCountPairs(row, idPrefix, countPrefix, slots) {
  const result = [];
  for (let i = 1; i <= slots; i++) {
    const id = Number(row[`${idPrefix}${i}`]);
    if (!id) continue;
    result.push({ id, count: Number(row[`${countPrefix}${i}`]) });
  }
  return result;
}

// ReqItemId1..4 (already-owned items required to turn the quest in) and
// ReqSourceId1..4 (items the objective itself provides/spawns, per
// ObjectMgr.cpp's own "`ReqSourceId`" quest-load validation) are two
// different item_template lookups but the same shape on this page - merged
// into one `objectives.items` list, each entry tagged `kind` so the view can
// still tell a hand-in requirement from a source drop apart.
function extractObjectiveItems(row) {
  const required = extractIdCountPairs(row, 'ReqItemId', 'ReqItemCount', 4).map((e) => ({ ...e, kind: 'required' }));
  const source = extractIdCountPairs(row, 'ReqSourceId', 'ReqSourceCount', 4).map((e) => ({ ...e, kind: 'source' }));
  return [...required, ...source];
}

// vmangos-core/src/game/ObjectMgr.cpp:5918-5926 (LoadQuests' own objective
// validation): `int32 id = qinfo->ReqCreatureOrGOId[j]; if (id < 0 &&
// !GetGameObjectTemplate(-id)) ...; if (id > 0 && !GetCreatureTemplate(id))
// ...`. A negative value is a gameobject entry stored negated; a positive
// one is a creature entry - the opposite of every other id column on this
// page, and 36 quests on this realm use the negative form. Getting the sign
// wrong here links confidently to a creature that has nothing to do with the
// quest (or vice versa).
function extractCreatureOrGoObjectives(row) {
  const result = [];
  for (let i = 1; i <= 4; i++) {
    const raw = Number(row[`ReqCreatureOrGOId${i}`]);
    if (!raw) continue;
    result.push({
      kind: raw < 0 ? 'gameobject' : 'creature',
      id: Math.abs(raw),
      count: Number(row[`ReqCreatureOrGOCount${i}`])
    });
  }
  return result;
}

// ReqSpellCast1..4 has no companion count column - the objective is simply
// "cast this spell", once.
function extractSpellIds(row) {
  const result = [];
  for (let i = 1; i <= 4; i++) {
    const id = Number(row[`ReqSpellCast${i}`]);
    if (id) result.push(id);
  }
  return result;
}

function extractReputationSlots(row) {
  const result = [];
  for (let i = 1; i <= 5; i++) {
    const faction = Number(row[`RewRepFaction${i}`]);
    if (!faction) continue;
    result.push({ faction, value: Number(row[`RewRepValue${i}`]) });
  }
  return result;
}

// creature_questrelation (givers), creature_involvedrelation (enders),
// gameobject_questrelation (givers) and gameobject_involvedrelation
// (enders) all carry `id, quest, patch_min, patch_max` - the same shape
// creature.js's fetchQuestIds reads in the other direction (creature ->
// quest ids). Here the lookup is quest -> giver/ender id, so `quest` is the
// filter column and `id` is what's selected. Reading only the creature pair
// would silently lose every quest an object gives or ends.
async function fetchRelationIds(pool, schema, table, questId, wowPatch) {
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const [rows] = await pool.query(
    `SELECT id FROM ${qualified} WHERE quest = ? AND patch_min <= ? AND ? <= patch_max`,
    [questId, wowPatch, wowPatch]
  );
  return rows.map((r) => Number(r.id));
}

// Everything the quest page needs, in one call. Returns null when the world
// pool is not configured or the entry does not exist (patch-filtered, per
// fetchTemplateRow) - either way the route has nothing to render and can 404
// instead of guessing.
export async function loadQuest(pools, config, entry) {
  const pool = pools?.world;
  if (!pool) return null;
  const schema = worldSchema(config);
  if (!schema) return null;

  const wowPatch = config.realm.wowPatch;
  const clientBuild = config.realm.clientBuild;
  const numericEntry = Number(entry);

  const template = await fetchTemplateRow(pool, {
    schema, table: 'quest_template', entry: numericEntry, wowPatch
  });
  if (!template) return null;
  const row = template.row;

  const objectiveItems = extractObjectiveItems(row);
  const creaturesOrObjects = extractCreatureOrGoObjectives(row);
  const objectiveSpells = extractSpellIds(row);
  const rewardItems = extractIdCountPairs(row, 'RewItemId', 'RewItemCount', 4);
  const rewardChoiceItems = extractIdCountPairs(row, 'RewChoiceItemId', 'RewChoiceItemCount', 6);
  const reputationSlots = extractReputationSlots(row);

  // The core casts RewSpellCast when the quest sets one, else RewSpell -
  // never both (vmangos-core/src/game/Objects/Player.cpp:13431: "uint32
  // spellId = pQuest->GetRewSpellCast() ? pQuest->GetRewSpellCast() :
  // pQuest->GetRewSpell();"). About 226 quests on this realm carry a
  // RewSpellCast with no RewSpell at all - reading RewSpell alone shows
  // "spell —" for every one of them. RewSpellCast is itself very often a
  // teaching spell rather than the spell actually learned, resolved through
  // the same lookup a trainer row's spell column needs
  // (server/dbLookups/spellLabels.js, resolveTaughtSpellIds).
  const rewardSpellRaw = Number(row.RewSpellCast) || Number(row.RewSpell);
  const rewardTaught = await resolveTaughtSpellIds(pool, {
    schema, ids: rewardSpellRaw ? [rewardSpellRaw] : [], clientBuild
  });
  const rewardSpell = rewardSpellRaw ? (rewardTaught.get(rewardSpellRaw) ?? rewardSpellRaw) : 0;

  const [creatureGivers, creatureEnders, objectGivers, objectEnders] = await Promise.all([
    fetchRelationIds(pool, schema, 'creature_questrelation', numericEntry, wowPatch),
    fetchRelationIds(pool, schema, 'creature_involvedrelation', numericEntry, wowPatch),
    fetchRelationIds(pool, schema, 'gameobject_questrelation', numericEntry, wowPatch),
    fetchRelationIds(pool, schema, 'gameobject_involvedrelation', numericEntry, wowPatch)
  ]);

  const givers = [
    ...creatureGivers.map((id) => ({ kind: 'creature', id })),
    ...objectGivers.map((id) => ({ kind: 'gameobject', id }))
  ];
  const enders = [
    ...creatureEnders.map((id) => ({ kind: 'creature', id })),
    ...objectEnders.map((id) => ({ kind: 'gameobject', id }))
  ];

  // Batched by kind, one fetchNames/fetchFactionNames call each - never one
  // query per id, no matter how many objective/reward/relation rows the
  // quest carries.
  const creatureIds = [
    ...creaturesOrObjects.filter((o) => o.kind === 'creature').map((o) => o.id),
    ...givers.filter((g) => g.kind === 'creature').map((g) => g.id),
    ...enders.filter((e) => e.kind === 'creature').map((e) => e.id)
  ];
  const gameobjectIds = [
    ...creaturesOrObjects.filter((o) => o.kind === 'gameobject').map((o) => o.id),
    ...givers.filter((g) => g.kind === 'gameobject').map((g) => g.id),
    ...enders.filter((e) => e.kind === 'gameobject').map((e) => e.id)
  ];
  const itemIds = [
    ...objectiveItems.map((i) => i.id),
    ...rewardItems.map((i) => i.id),
    ...rewardChoiceItems.map((i) => i.id),
    Number(row.SrcItemId)
  ];
  const spellIds = [...objectiveSpells, rewardSpell];
  // PrevQuestId and NextQuestId are signed (int32) - a negative value marks
  // an "OR" prerequisite relationship rather than a different quest
  // (ObjectMgr.cpp's own chain-loading reads them through abs()); the id
  // referenced is always the absolute value.
  const questChainIds = [row.PrevQuestId, row.NextQuestId, row.NextQuestInChain, row.BreadcrumbForQuestId]
    .map((v) => Math.abs(Number(v)))
    .filter((v) => v !== 0);
  const factionIds = reputationSlots.map((r) => r.faction);

  const [creatureNames, gameobjectNames, { names: itemNames, qualities: itemQuality }, spellNames, questNames, factionNames, areaNames] = await Promise.all([
    fetchNames(pool, { schema, kind: 'creature', ids: creatureIds, wowPatch, clientBuild }),
    fetchNames(pool, { schema, kind: 'gameobject', ids: gameobjectIds, wowPatch, clientBuild }),
    fetchItemNamesWithQuality(pool, { schema, ids: itemIds, wowPatch }),
    fetchNames(pool, { schema, kind: 'spell', ids: spellIds, wowPatch, clientBuild }),
    fetchNames(pool, { schema, kind: 'quest', ids: questChainIds, wowPatch, clientBuild }),
    fetchFactionNames(pool, { schema, factionIds, clientBuild }),
    fetchAreaNames(pool, { schema, areaIds: Number(row.ZoneOrSort) > 0 ? [Number(row.ZoneOrSort)] : [] })
  ]);

  const reputation = reputationSlots.map((r) => ({
    faction: r.faction,
    value: r.value,
    name: factionNames.get(r.faction) ?? null
  }));

  const namedEntity = (entity) => ({
    ...entity,
    name: (entity.kind === 'creature' ? creatureNames : gameobjectNames).get(entity.id) ?? null
  });

  return {
    entry: numericEntry,
    patch: template.patch,
    patches: template.patches,
    row,
    objectives: {
      items: objectiveItems,
      creaturesOrObjects,
      spells: objectiveSpells
    },
    rewards: {
      items: rewardItems,
      choiceItems: rewardChoiceItems,
      xp: Number(row.RewXP),
      money: Number(row.RewOrReqMoney),
      spell: rewardSpell,
      reputation
    },
    givers: givers.map(namedEntity),
    enders: enders.map(namedEntity),
    names: {
      creature: creatureNames,
      item: itemNames,
      itemQuality,
      gameobject: gameobjectNames,
      quest: questNames,
      spell: spellNames,
      area: areaNames
    }
  };
}
