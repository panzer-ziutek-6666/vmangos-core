import { escapeHtml } from '../layout.js';
import { renderRawRow, renderPatchLine, itemEntityLink, renderQuestList, lootChanceCell } from './fields.js';
import { gameObjectTypeName } from '../../dbLookups/gameObjectTypes.js';

// Neither `creature` nor `gameobject` stores a zone or area id -
// server/queries/db/spawns.js. Naming one needs terrain data this panel does
// not have, so this only ever shows a map and coordinates - never a zone,
// and never a note implying one could be derived. Unlike creature's spawn
// table, gameobject has no `column` (a single `id`, not id..id5), so there
// is no "spawned via" column here.
function renderSpawns(spawns, maps) {
  if (spawns.rows.length === 0) {
    return '<p class="detail">No spawns recorded.</p>';
  }

  const rows = spawns.rows
    .map((s) => {
      const mapName = maps.get(s.map);
      const mapLabel = mapName ? escapeHtml(mapName) : `map ${escapeHtml(s.map)}`;
      const coords = `${s.x.toFixed(1)}, ${s.y.toFixed(1)}, ${s.z.toFixed(1)}`;
      return `      <tr><td>${escapeHtml(s.guid)}</td><td>${mapLabel}</td><td>${escapeHtml(coords)}</td></tr>`;
    })
    .join('\n');

  const count = spawns.total > spawns.rows.length
    ? `<p class="detail">${escapeHtml(spawns.total)} spawns total; showing ${escapeHtml(spawns.rows.length)}.</p>`
    : `<p class="detail">${escapeHtml(spawns.total)} spawn${spawns.total === 1 ? '' : 's'}.</p>`;

  return `<table>
    <thead><tr><th>guid</th><th>map</th><th>x, y, z</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  ${count}`;
}

// data0..data23, every slot, whether or not this type's data union names it
// (server/queries/db/gameobject.js's buildDataSlots) - an unlabelled slot
// still shows its raw number, never dropped, the same "an honest gap costs
// nothing" rule server/dbLookups/gameObjectTypes.js documents for itself.
function renderDataSlots(dataSlots) {
  const rows = dataSlots
    .map((s) => `      <tr><td>data${escapeHtml(s.index)}</td><td>${s.label ? escapeHtml(s.label) : '<span class="detail">—</span>'}</td><td>${escapeHtml(s.value)}</td></tr>`)
    .join('\n');
  return `<table>
    <thead><tr><th>slot</th><th>meaning</th><th>value</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
}

function renderLootTable(loot, names) {
  if (loot.length === 0) {
    return '<p class="detail">No loot table.</p>';
  }
  const rows = loot
    .map((l) => `      <tr><td>${itemEntityLink(l.item, names)}</td><td>${lootChanceCell(l)}</td><td>${escapeHtml(l.minCount)}-${escapeHtml(l.maxCount)}</td><td>${l.viaReference ? escapeHtml(l.viaReference) : '—'}</td></tr>`)
    .join('\n');
  return `<table>
    <thead><tr><th>item</th><th>chance</th><th>count</th><th>via reference</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
}

// The read-only gameobject page: a decoded summary, the labelled data slots,
// the spawns, the loot and the quest relations, then - at the bottom,
// always - the raw row and the patch it was read at.
//
// `data` is loadGameObject's return value with one addition: `wowPatch`, the
// configured patch the page was rendered against, which the route attaches
// before calling this (loadGameObject itself has no reason to carry the
// server's own configuration back out through its return value) - the same
// convention Tasks 9-11 established.
export function renderGameObjectPage(data) {
  const { row, dataSlots, faction, spawns, loot, questsGiven, questsEnded, names, maps, patch, patches, wowPatch } = data;

  const facts = `<table class="facts">
  <tr><th>entry</th><td>${escapeHtml(data.entry)}</td></tr>
  <tr><th>type</th><td>${escapeHtml(gameObjectTypeName(row.type))}</td></tr>
  <tr><th>display id</th><td>${escapeHtml(row.displayId)}</td></tr>
  <tr><th>faction</th><td>${faction ? escapeHtml(faction.name) : `faction template ${escapeHtml(row.faction)}`}</td></tr>
  <tr><th>flags</th><td>${escapeHtml(row.flags)}</td></tr>
  <tr><th>size</th><td>${escapeHtml(row.size)}</td></tr>
  <tr><th>script_name</th><td>${row.script_name ? escapeHtml(row.script_name) : '—'}</td></tr>
</table>`;

  return `<h1>${escapeHtml(row.name)}</h1>
<p><a href="/db/objects">back to objects</a></p>
${facts}

<h2>Data</h2>
${renderDataSlots(dataSlots)}

<h2>Spawns</h2>
${renderSpawns(spawns, maps)}

<h2>Loot</h2>
${renderLootTable(loot, names)}

<h2>Quests given</h2>
${renderQuestList(questsGiven, names.quest, 'Does not offer any quest.')}

<h2>Quests ended here</h2>
${renderQuestList(questsEnded, names.quest, 'Does not complete any quest here.')}

${renderPatchLine({ patch, patches, wowPatch })}
${renderRawRow(row)}`;
}
