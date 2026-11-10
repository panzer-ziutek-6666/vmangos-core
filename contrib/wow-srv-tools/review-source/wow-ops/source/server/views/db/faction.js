import { escapeHtml } from '../layout.js';
import { entityLink, itemEntityLink, table } from './fields.js';
import { raceNames, classNames } from '../../dbLookups/questFlags.js';

// ReputationRank (vmangos-core/src/game/SharedDefines.h:125-135).
const REP_RANK_NAMES = ['Hated', 'Hostile', 'Unfriendly', 'Neutral', 'Friendly', 'Honored', 'Revered', 'Exalted'];

// ReputationMgr::ReputationToRank (vmangos-core/src/game/ReputationMgr.cpp:32-42):
// walk down from Reputation_Cap + 1 (42999 + 1, ReputationMgr.h:71) by
// PointsInRank (ReputationMgr.cpp:30).
const POINTS_IN_RANK = [36000, 3000, 3000, 3000, 6000, 12000, 21000, 1000];
export function repRank(standing) {
  let limit = 42999 + 1;
  for (let i = POINTS_IN_RANK.length - 1; i >= 0; i--) {
    limit -= POINTS_IN_RANK[i];
    if (standing >= limit) return i;
  }
  return 0;
}

export function repLabel(value) {
  return `${value} (${REP_RANK_NAMES[repRank(value)]})`;
}

function maskText(mask, names, any) {
  return mask ? names(mask).map((n) => escapeHtml(n)).join(', ') : any;
}

function factionList(factions) {
  return `<ul>\n  ${factions.map((f) => `<li>${entityLink({ kind: 'faction', entry: f.id, name: f.name })}</li>`).join('\n  ')}\n</ul>`;
}

export function renderFactionIndex({ groups, internal }) {
  const parts = ['<h1>Factions</h1>'];
  for (const g of groups) parts.push(`<h2>${escapeHtml(g.name)}</h2>\n${factionList(g.factions)}`);
  if (internal.length) parts.push(`<h2>Internal <span class="detail">(no reputation)</span></h2>\n${factionList(internal)}`);
  return parts.join('\n');
}

export function renderFactionPage(data) {
  const { faction, baseRep, npcs, onKill, quests, items, names } = data;
  const parent = faction.parent ? `<p>Part of ${entityLink({ kind: 'faction', entry: faction.parent.id, name: faction.parent.name })}</p>` : '';
  const standing = faction.reputationListId >= 0
    ? `<h2>Starting reputation</h2>
${table(['races', 'classes', 'standing'], baseRep.map((b) => `    <tr><td>${maskText(b.raceMask, raceNames, 'any race')}</td><td>${maskText(b.classMask, classNames, 'any class')}</td><td>${escapeHtml(repLabel(b.value))}</td></tr>`))}`
    : '<p class="detail">This faction carries no reputation; it only decides who is friendly to whom.</p>';
  const shown = npcs.slice(0, 200);
  const more = npcs.length > shown.length ? `<p class="detail">${npcs.length} NPCs; showing ${shown.length}.</p>` : '';

  return `<h1>${escapeHtml(faction.name)}</h1>
${faction.description ? `<p>${escapeHtml(faction.description)}</p>` : ''}
${parent}
<p><a href="/db/factions">back to factions</a></p>
${standing}
<h2>Reputation from kills <span class="detail">(${onKill.length})</span></h2>
${table(['npc', 'reputation', 'up to'], onKill.map((k) => `    <tr><td>${entityLink({ kind: 'creature', entry: k.entry, name: k.name })}</td><td>${k.value}</td><td>${escapeHtml(REP_RANK_NAMES[k.maxStanding] ?? k.maxStanding)}</td></tr>`))}
<h2>Reputation from quests <span class="detail">(${quests.length})</span></h2>
${table(['quest', 'level', 'reputation'], quests.map((q) => `    <tr><td>${entityLink({ kind: 'quest', entry: q.entry, name: q.title })}</td><td>${q.level}</td><td>${q.value}</td></tr>`))}
<h2>Items requiring a standing <span class="detail">(${items.length})</span></h2>
${table(['item', 'requires'], items.map((i) => `    <tr><td>${itemEntityLink(i.entry, names)}</td><td>${escapeHtml(REP_RANK_NAMES[i.rank] ?? i.rank)}</td></tr>`))}
<h2>Members <span class="detail">(${npcs.length})</span></h2>
${table(['npc', 'level'], shown.map((n) => `    <tr><td>${entityLink({ kind: 'creature', entry: n.entry, name: n.name })}</td><td>${n.levelMin === n.levelMax ? n.levelMin : `${n.levelMin}–${n.levelMax}`}</td></tr>`))}
${more}`;
}
