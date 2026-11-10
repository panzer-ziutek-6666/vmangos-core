import { worldSchema, qualified } from './sql.js';
import { highestBuildClause, highestPatchClause } from './progressive.js';
import { fetchNames } from '../../dbLookups/names.js';

const REP_SLOTS = [1, 2, 3, 4, 5];
const BASE_SLOTS = [1, 2, 3, 4];

// RACEMASK_ALL_PLAYABLE (vmangos-core/src/game/SharedDefines.h:72-75): every
// playable race's bit, 255 here (eight races, RACE_HUMAN=1 .. RACE_TROLL=8).
const RACEMASK_ALL_PLAYABLE = 255;

// FactionEntry::GetIndexFitTo (vmangos-core/src/game/Database/DBCStructure.h:328-338):
// the first of four sets whose race and class masks match (0 = any) gives the
// starting value. Walk finding B: once the sets seen so far already cover
// every playable race with no class restriction (classMask 0), every player
// of every race is guaranteed to match one of them by race alone - so no set
// after that point can ever be reached, and it is dropped rather than shown.
// A set with both masks 0 is the special case of this (raceMask 0 already
// covers every race), which is why the old "stop at the first 0/0 set" rule
// often agreed with this one - it just stopped one set too late whenever the
// earlier sets alone already covered all eight races (Stormwind: three
// class-unrestricted sets cover 255 between them, so the fourth, {any race,
// any class: 0}, is never reachable and is not shown).
function baseReputation(row) {
  const sets = [];
  let covered = 0;
  for (const i of BASE_SLOTS) {
    const set = { raceMask: Number(row[`base_rep_race_mask${i}`]), classMask: Number(row[`base_rep_class_mask${i}`]), value: Number(row[`base_rep_value${i}`]) };
    sets.push(set);
    if (set.classMask === 0) covered |= set.raceMask === 0 ? RACEMASK_ALL_PLAYABLE : set.raceMask;
    if (covered === RACEMASK_ALL_PLAYABLE) break;
  }
  return sets;
}

export async function loadFaction(pools, config, id) {
  const pool = pools?.world;
  const schema = worldSchema(config);
  if (!pool || !schema) return null;
  const clientBuild = config.realm.clientBuild;
  const wowPatch = config.realm.wowPatch;
  const factionId = Number(id);

  const [rows] = await pool.query(
    `SELECT t1.* FROM ${qualified(schema, 'faction')} t1 WHERE t1.id = ? AND ${highestBuildClause(schema, 'faction', 't1', 'id')}`,
    [factionId, clientBuild]
  );
  const row = rows.find((r) => Number(r.id) === factionId);
  if (!row) return null;

  const parentId = Number(row.team);
  const parent = parentId
    ? (await pool.query(
        `SELECT t1.id, t1.name FROM ${qualified(schema, 'faction')} t1 WHERE t1.id = ? AND ${highestBuildClause(schema, 'faction', 't1', 'id')}`,
        [parentId, clientBuild]
      ))[0].find((r) => Number(r.id) === parentId) ?? null
    : null;

  // creature_template.faction is a faction_template id (Creature.cpp:637,
  // 656-657; server/dbLookups/factions.js), so members are found through the
  // templates that name this faction.
  const [templates] = await pool.query(
    `SELECT t1.id FROM ${qualified(schema, 'faction_template')} t1 WHERE t1.faction_id = ? AND ${highestBuildClause(schema, 'faction_template', 't1', 'id')}`,
    [factionId, clientBuild]
  );
  const templateIds = templates.map((t) => Number(t.id));
  // creature_template.faction is unindexed; 15,217 rows scan in one statement.
  const [npcRows] = templateIds.length
    ? await pool.query(
        `SELECT t1.entry, t1.name, t1.level_min, t1.level_max FROM ${qualified(schema, 'creature_template')} t1
         WHERE t1.faction IN (${templateIds.map(() => '?').join(', ')}) AND ${highestPatchClause(schema, 'creature_template', 't1')}
         ORDER BY t1.name, t1.entry`,
        [...templateIds, wowPatch]
      )
    : [[]];

  // Keyed (creature_id, patch) and loaded "highest patch not above" by hand
  // (vmangos-core/src/game/ObjectMgr.cpp:8970) - correlated on creature_id,
  // which highestPatchClause (keyed on entry) cannot express.
  const onKillTable = qualified(schema, 'creature_onkill_reputation');
  const [onKillRows] = await pool.query(
    `SELECT k.* FROM ${onKillTable} k
     WHERE (k.RewOnKillRepFaction1 = ? OR k.RewOnKillRepFaction2 = ?)
       AND k.patch = (SELECT MAX(k2.patch) FROM ${onKillTable} k2 WHERE k2.creature_id = k.creature_id AND k2.patch <= ?)`,
    [factionId, factionId, wowPatch]
  );
  const onKillNames = await fetchNames(pool, { schema, kind: 'creature', ids: onKillRows.map((r) => Number(r.creature_id)), wowPatch });

  const [questRows] = await pool.query(
    `SELECT t1.entry, t1.Title, t1.QuestLevel, ${REP_SLOTS.map((i) => `t1.RewRepFaction${i}, t1.RewRepValue${i}`).join(', ')}
     FROM ${qualified(schema, 'quest_template')} t1
     WHERE (${REP_SLOTS.map((i) => `t1.RewRepFaction${i} = ?`).join(' OR ')}) AND ${highestPatchClause(schema, 'quest_template', 't1')}
     ORDER BY t1.QuestLevel, t1.Title`,
    [...REP_SLOTS.map(() => factionId), wowPatch]
  );

  // Player::CanUseItem refuses the item below this rank
  // with EQUIP_ERR_CANT_EQUIP_REPUTATION
  // (vmangos-core/src/game/Objects/Player.cpp:10240, 10259).
  const [itemRows] = await pool.query(
    `SELECT t1.entry, t1.name, t1.quality, t1.required_reputation_rank FROM ${qualified(schema, 'item_template')} t1
     WHERE t1.required_reputation_faction = ? AND ${highestPatchClause(schema, 'item_template', 't1')}
     ORDER BY t1.required_reputation_rank, t1.name`,
    [factionId, wowPatch]
  );

  return {
    faction: {
      id: factionId, name: row.name ?? '', description: row.description ?? '',
      reputationListId: Number(row.reputation_list_id),
      parent: parent ? { id: Number(parent.id), name: parent.name ?? '' } : null
    },
    baseRep: baseReputation(row),
    npcs: npcRows.map((r) => ({ entry: Number(r.entry), name: r.name ?? '', levelMin: Number(r.level_min), levelMax: Number(r.level_max) })),
    onKill: onKillRows.map((r) => {
      const slot = Number(r.RewOnKillRepFaction1) === factionId ? 1 : 2;
      return { entry: Number(r.creature_id), name: onKillNames.get(Number(r.creature_id)) ?? '', value: Number(r[`RewOnKillRepValue${slot}`]), maxStanding: Number(r[`MaxStanding${slot}`]) };
    }),
    quests: questRows.map((r) => {
      const slot = REP_SLOTS.find((i) => Number(r[`RewRepFaction${i}`]) === factionId);
      return { entry: Number(r.entry), title: r.Title ?? '', level: Number(r.QuestLevel), value: Number(r[`RewRepValue${slot}`]) };
    }),
    items: itemRows.map((r) => ({ entry: Number(r.entry), name: r.name ?? '', quality: Number(r.quality), rank: Number(r.required_reputation_rank) })),
    names: {
      item: new Map(itemRows.map((r) => [Number(r.entry), r.name ?? ''])),
      itemQuality: new Map(itemRows.map((r) => [Number(r.entry), Number(r.quality)]))
    }
  };
}
