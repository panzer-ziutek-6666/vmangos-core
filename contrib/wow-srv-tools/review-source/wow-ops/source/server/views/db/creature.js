import { escapeHtml } from '../layout.js';
import { renderRawRow, renderPatchLine, itemEntityLink, renderQuestList, lootChanceCell, entityLink } from './fields.js';
import {
  creatureTypeName, creatureRankName, creatureFamilyName, unitClassName, npcFlagNames,
  movementTypeName, inhabitTypeNames
} from '../../dbLookups/creatureTypes.js';

// Neither `creature` nor `gameobject` stores a zone or area id -
// server/queries/db/spawns.js. Naming one needs terrain data this panel does
// not have, so this only ever shows a map and coordinates - never a zone,
// and never a note implying one could be derived.
function renderSpawns(spawns, maps) {
  if (spawns.rows.length === 0) {
    return '<p class="detail">No spawns recorded.</p>';
  }

  const rows = spawns.rows
    .map((s) => {
      const mapName = maps.get(s.map);
      const mapLabel = mapName ? escapeHtml(mapName) : `map ${escapeHtml(s.map)}`;
      const coords = `${s.x.toFixed(1)}, ${s.y.toFixed(1)}, ${s.z.toFixed(1)}`;
      return `      <tr><td>${escapeHtml(s.guid)}</td><td>${mapLabel}</td><td>${escapeHtml(coords)}</td><td>${escapeHtml(s.column ?? '—')}</td></tr>`;
    })
    .join('\n');

  const count = spawns.total > spawns.rows.length
    ? `<p class="detail">${escapeHtml(spawns.total)} spawns total; showing ${escapeHtml(spawns.rows.length)}.</p>`
    : `<p class="detail">${escapeHtml(spawns.total)} spawn${spawns.total === 1 ? '' : 's'}.</p>`;

  return `<table>
    <thead><tr><th>guid</th><th>map</th><th>x, y, z</th><th>spawned via</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  ${count}`;
}

function renderLootTable(title, loot, names) {
  if (loot.length === 0) {
    return `<h3>${escapeHtml(title)}</h3><p class="detail">No loot table.</p>`;
  }
  const rows = loot
    .map((l) => `      <tr><td>${itemEntityLink(l.item, names)}</td><td>${lootChanceCell(l)}</td><td>${escapeHtml(l.minCount)}-${escapeHtml(l.maxCount)}</td><td>${l.viaReference ? escapeHtml(l.viaReference) : '—'}</td></tr>`)
    .join('\n');
  return `<h3>${escapeHtml(title)}</h3>
  <table>
    <thead><tr><th>item</th><th>chance</th><th>count</th><th>via reference</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
}

function renderVendor(vendor, names) {
  if (vendor.length === 0) {
    return '<p class="detail">Not a vendor, or no stock configured.</p>';
  }
  const rows = vendor
    .map((v) => `      <tr><td>${itemEntityLink(v.item, names)}</td><td>${escapeHtml(v.maxCount)}</td><td>${escapeHtml(v.incrTime)}</td><td>${escapeHtml(v.source)}</td></tr>`)
    .join('\n');
  return `<table>
    <thead><tr><th>item</th><th>max stock</th><th>restock (s)</th><th>source</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
}

// Each spell taught links to its own page and carries its hover card
// (entityLink's own "#<id>" fallback covers a name lookup miss) rather than
// the plain "spell #<id>" text this used to fall back to. `t.taughtSpell`
// (loadCreature's resolveTaughtSpellIds) is what to link, not `t.spell` -
// the trainer row itself usually names a teaching spell
// (vmangos-core/src/game/ObjectMgr.cpp:10721-10735), and linking that spell
// instead sends a player to the wrong page (e.g. "Fireball" pointing at the
// Mage's own rank-2 teaching spell rather than Fireball itself).
function renderTrainer(trainer, spellNames) {
  if (trainer.length === 0) {
    return '<p class="detail">Not a trainer, or no spells configured.</p>';
  }
  const rows = trainer
    .map((t) => {
      const link = entityLink({ kind: 'spell', entry: t.taughtSpell, name: spellNames.get(t.taughtSpell) });
      return `      <tr><td>${link}</td><td>${escapeHtml(t.spellCost)}</td><td>${escapeHtml(t.reqLevel)}</td><td>${escapeHtml(t.source)}</td></tr>`;
    })
    .join('\n');
  return `<table>
    <thead><tr><th>spell</th><th>cost</th><th>req level</th><th>source</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
}

// The read-only creature page: a decoded summary, every related list linking
// back into this same section, and - at the bottom, always - the raw row and
// the patch it was read at, so nothing this page does not yet know how to
// explain is ever simply missing.
//
// `data` is loadCreature's return value with one addition: `wowPatch`, the
// configured patch the page was rendered against, which the route attaches
// before calling this (loadCreature itself has no reason to carry the
// server's own configuration back out through its return value).
export function renderCreaturePage(data) {
  const { row, faction, spawns, loot, pickpocketLoot, skinningLoot, vendor, trainer, questsGiven, questsEnded, names, maps, patch, patches, wowPatch } = data;

  const title = row.subname ? `${row.name} — ${row.subname}` : row.name;

  const facts = `<table class="facts">
  <tr><th>entry</th><td>${escapeHtml(data.entry)}</td></tr>
  <tr><th>faction</th><td>${faction ? entityLink({ kind: 'faction', entry: faction.factionId, name: faction.name }) : `faction template ${escapeHtml(row.faction)}`}</td></tr>
  <tr><th>type</th><td>${escapeHtml(creatureTypeName(row.type))}</td></tr>
  <tr><th>family</th><td>${escapeHtml(creatureFamilyName(row.pet_family))}</td></tr>
  <tr><th>rank</th><td>${escapeHtml(creatureRankName(row.rank))}</td></tr>
  <tr><th>class</th><td>${escapeHtml(unitClassName(row.unit_class))}</td></tr>
  <tr><th>level</th><td>${escapeHtml(row.level_min)}–${escapeHtml(row.level_max)}</td></tr>
  <tr><th>npc flags</th><td>${npcFlagNames(row.npc_flags).map((n) => escapeHtml(n)).join(', ') || '—'}</td></tr>
  <tr><th>movement type</th><td>${escapeHtml(movementTypeName(row.movement_type))}</td></tr>
  <tr><th>inhabit type</th><td>${inhabitTypeNames(row.inhabit_type).map((n) => escapeHtml(n)).join(', ') || '—'}</td></tr>
  <tr><th>ai_name</th><td>${row.ai_name ? escapeHtml(row.ai_name) : '—'}</td></tr>
  <tr><th>script_name</th><td>${row.script_name ? escapeHtml(row.script_name) : '—'}</td></tr>
</table>`;

  return `<h1>${escapeHtml(title)}</h1>
<p><a href="/db/npcs">back to NPCs</a></p>
${facts}

<h2>Spawns</h2>
${renderSpawns(spawns, maps)}

<h2>Loot</h2>
${renderLootTable('Killed', loot, names)}
${renderLootTable('Pickpocketed', pickpocketLoot, names)}
${renderLootTable('Skinned', skinningLoot, names)}

<h2>Vendor</h2>
${renderVendor(vendor, names)}

<h2>Trainer</h2>
${renderTrainer(trainer, names.spell)}

<h2>Quests given</h2>
${renderQuestList(questsGiven, names.quest, 'Does not offer any quest.')}

<h2>Quests ended here</h2>
${renderQuestList(questsEnded, names.quest, 'Does not complete any quest here.')}

${renderPatchLine({ patch, patches, wowPatch })}
${renderRawRow(row)}`;
}
