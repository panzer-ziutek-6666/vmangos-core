import { escapeHtml } from '../layout.js';
import { renderRawRow, renderPatchLine, entityLink, itemEntityLink } from './fields.js';
import { raceNames, classNames, questFlagNames } from '../../dbLookups/questFlags.js';
import { questSide, questTypeName, questLevelLabel, categoryLabel } from '../../dbLookups/questCategories.js';

// Each spell links to its own page and carries its hover card
// (server/views/db/spell.js) - entityLink's own "#<id>" fallback covers a
// name lookup miss, the same way creature.js's renderTrainer now links a
// spell it cannot name.
function spellLabel(id, spellNames) {
  if (!id) return null;
  return entityLink({ kind: 'spell', entry: id, name: spellNames.get(id) });
}

// quest_template's own text columns are third-party dump content, not
// something this panel generated - escaped first, and only then does a
// newline become a <br>. Escaping after converting the break would eat the
// <br> tag itself; escaping first and converting after is the only order
// that is safe from both directions.
function textBlock(label, text) {
  const value = String(text ?? '');
  if (value.trim().length === 0) return '';
  const html = escapeHtml(value).replaceAll('\n', '<br>');
  return `<h3>${escapeHtml(label)}</h3>\n<p class="detail">${html}</p>`;
}

// Chain fields (PrevQuestId, NextQuestId, NextQuestInChain,
// BreadcrumbForQuestId) are all quest ids; PrevQuestId/NextQuestId can carry
// a negative sign that marks an "OR" prerequisite rather than naming a
// different quest (vmangos-core/src/game/ObjectMgr.cpp reads them through
// abs() when building the chain), so the link always points at the absolute
// value.
function chainLink(value, questNames) {
  const raw = Number(value);
  if (!raw) return '—';
  const id = Math.abs(raw);
  const suffix = raw < 0 ? ' <span class="detail">(OR)</span>' : '';
  return `${entityLink({ kind: 'quest', entry: id, name: questNames.get(id) })}${suffix}`;
}

function renderCreaturesOrObjects(objectives, names) {
  if (objectives.length === 0) {
    return '<p class="detail">No creature or object objectives.</p>';
  }
  const rows = objectives
    .map((o) => {
      const nameMap = o.kind === 'creature' ? names.creature : names.gameobject;
      return `      <tr><td>${entityLink({ kind: o.kind, entry: o.id, name: nameMap.get(o.id) })}</td><td>${escapeHtml(o.kind)}</td><td>${escapeHtml(o.count)}</td></tr>`;
    })
    .join('\n');
  return `<table>
    <thead><tr><th>target</th><th>kind</th><th>count</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
}

function renderItemObjectives(items, names) {
  if (items.length === 0) {
    return '<p class="detail">No item objectives.</p>';
  }
  const rows = items
    .map((i) => `      <tr><td>${itemEntityLink(i.id, names)}</td><td>${escapeHtml(i.count)}</td><td>${i.kind === 'source' ? 'source' : 'hand in'}</td></tr>`)
    .join('\n');
  return `<table>
    <thead><tr><th>item</th><th>count</th><th>required as</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
}

function renderSpellObjectives(spellIds, spellNames) {
  if (spellIds.length === 0) {
    return '<p class="detail">No spells to cast.</p>';
  }
  const items = spellIds.map((id) => `<li>${spellLabel(id, spellNames)}</li>`).join('\n    ');
  return `<ul>
    ${items}
  </ul>`;
}

function renderRewardItems(title, items, names) {
  if (items.length === 0) {
    return `<h3>${escapeHtml(title)}</h3><p class="detail">None.</p>`;
  }
  const rows = items
    .map((i) => `      <tr><td>${itemEntityLink(i.id, names)}</td><td>${escapeHtml(i.count)}</td></tr>`)
    .join('\n');
  return `<h3>${escapeHtml(title)}</h3>
  <table>
    <thead><tr><th>item</th><th>count</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
}

// RewRepFaction1..5 names a Faction.dbc entry directly, not a faction_template
// id (server/dbLookups/factions.js, fetchFactionNames).
function renderReputation(reputation) {
  if (reputation.length === 0) {
    return '<p class="detail">No reputation reward.</p>';
  }
  const items = reputation
    .map((r) => `<li>${entityLink({ kind: 'faction', entry: r.faction, name: r.name })}: ${escapeHtml(r.value)}</li>`)
    .join('\n    ');
  return `<ul>
    ${items}
  </ul>`;
}

function renderRelationList(entities, emptyLabel) {
  if (entities.length === 0) {
    return `<p class="detail">${escapeHtml(emptyLabel)}</p>`;
  }
  const items = entities.map((e) => `<li>${entityLink({ kind: e.kind, entry: e.id, name: e.name })} <span class="detail">(${escapeHtml(e.kind)})</span></li>`).join('\n    ');
  return `<ul>
    ${items}
  </ul>`;
}

// The read-only quest page: a decoded summary, the text blocks, the
// objectives and rewards, the giver/ender lists, then - at the bottom,
// always - the raw row and the patch it was read at.
//
// `data` is loadQuest's return value with one addition: `wowPatch`, the
// configured patch the page was rendered against, which the route attaches
// before calling this (loadQuest itself has no reason to carry the server's
// own configuration back out through its return value) - the same
// convention Tasks 9 and 10 established.
export function renderQuestPage(data) {
  const { row, objectives, rewards, givers, enders, names, patch, patches, wowPatch } = data;

  // QuestLevel, MinLevel and MaxLevel are three unrelated facts, not two ends
  // of a range - rendering them as `${MinLevel}-${QuestLevel}` reads
  // backwards for 35 quests on this realm (quest 3401: MinLevel 53,
  // QuestLevel 48) and silently drops MaxLevel, which is nonzero on 219
  // quests. Each gets its own row; MaxLevel of 0 means "no cap" and is
  // dashed rather than printed as a level nobody can be above.
  const facts = `<table class="facts">
  <tr><th>entry</th><td>${escapeHtml(data.entry)}</td></tr>
  <tr><th>quest level</th><td>${escapeHtml(row.QuestLevel)}</td></tr>
  <tr><th>minimum level</th><td>${escapeHtml(row.MinLevel)}</td></tr>
  <tr><th>maximum level</th><td>${row.MaxLevel ? escapeHtml(row.MaxLevel) : '—'}</td></tr>
  <tr><th>category</th><td>${Number(row.ZoneOrSort) > 0 ? entityLink({ kind: 'zone', entry: Number(row.ZoneOrSort), name: names.area?.get(Number(row.ZoneOrSort)) }) : escapeHtml(categoryLabel(row.ZoneOrSort, names.area?.get(Number(row.ZoneOrSort))) ?? '—')}</td></tr>
  <tr><th>required races</th><td>${raceNames(row.RequiredRaces).map((n) => escapeHtml(n)).join(', ')}</td></tr>
  <tr><th>required classes</th><td>${classNames(row.RequiredClasses).map((n) => escapeHtml(n)).join(', ')}</td></tr>
  <tr><th>flags</th><td>${questFlagNames(row.QuestFlags).map((n) => escapeHtml(n)).join(', ') || '—'}</td></tr>
  <tr><th>starting item</th><td>${row.SrcItemId ? itemEntityLink(Number(row.SrcItemId), names) : '—'}</td></tr>
</table>`;

  // ExclusiveGroup is a grouping key, not a quest id: the core inserts it
  // into m_ExclusiveQuestGroups keyed on its raw value
  // (vmangos-core/src/game/ObjectMgr.cpp:6176-6177,
  // `m_ExclusiveQuestGroups.insert(value_type(qinfo->ExclusiveGroup,
  // qinfo->GetQuestId()))`) with no check anywhere that the value names an
  // existing quest - unlike PrevQuestId/NextQuestId/BreadcrumbForQuestId,
  // which are all validated against m_QuestTemplatesMap at load time. Two
  // quests sharing this number are mutually exclusive; the number itself is
  // never dereferenced as a quest id, so linking it would point at the wrong
  // thing (or nothing) as often as not.
  const chain = `<table class="facts">
  <tr><th>previous quest</th><td>${chainLink(row.PrevQuestId, names.quest)}</td></tr>
  <tr><th>next quest</th><td>${chainLink(row.NextQuestId, names.quest)}</td></tr>
  <tr><th>next in chain</th><td>${chainLink(row.NextQuestInChain, names.quest)}</td></tr>
  <tr><th>breadcrumb for</th><td>${chainLink(row.BreadcrumbForQuestId, names.quest)}</td></tr>
  <tr><th>exclusive group</th><td>${row.ExclusiveGroup ? escapeHtml(row.ExclusiveGroup) : '—'} <span class="detail">(a grouping key shared by other quests, not itself a quest id - not linked)</span></td></tr>
</table>`;

  const text = [
    textBlock('Details', row.Details),
    textBlock('Objectives', row.Objectives),
    textBlock('Objective 1', row.ObjectiveText1),
    textBlock('Objective 2', row.ObjectiveText2),
    textBlock('Objective 3', row.ObjectiveText3),
    textBlock('Objective 4', row.ObjectiveText4),
    textBlock('Offer reward', row.OfferRewardText),
    textBlock('Request items', row.RequestItemsText),
    textBlock('Completion', row.EndText)
  ].filter((b) => b.length > 0).join('\n');

  const money = Number(rewards.money);
  const moneyLine = money === 0
    ? '—'
    : money < 0
      ? `${escapeHtml(Math.abs(money))} copper <span class="detail">(required to complete, not a reward)</span>`
      : `${escapeHtml(money)} copper`;

  const category = categoryLabel(row.ZoneOrSort, names.area?.get(Number(row.ZoneOrSort)));
  const summary = [
    `Level ${questLevelLabel(row.QuestLevel)}`,
    Number(row.MinLevel) ? `Requires level ${row.MinLevel}` : null,
    `Races: ${questSide(row.RequiredRaces)}`,
    category,
    questTypeName(row.Type)
  ].filter(Boolean).map((s) => escapeHtml(s)).join(' · ');

  return `<h1>${escapeHtml(row.Title)}</h1>
<p class="summary">${summary}</p>
<p><a href="/db/quests">back to quests</a></p>
${facts}

<h2>Chain</h2>
${chain}

${text ? `<h2>Text</h2>\n${text}` : ''}

<h2>Objectives</h2>
<h3>Creatures / objects</h3>
${renderCreaturesOrObjects(objectives.creaturesOrObjects, names)}
<h3>Items</h3>
${renderItemObjectives(objectives.items, names)}
<h3>Spells</h3>
${renderSpellObjectives(objectives.spells, names.spell)}

<h2>Rewards</h2>
<table class="facts">
  <tr><th>experience</th><td>${escapeHtml(rewards.xp)}</td></tr>
  <tr><th>money</th><td>${moneyLine}</td></tr>
  <tr><th>spell</th><td>${rewards.spell ? spellLabel(rewards.spell, names.spell) : '—'}</td></tr>
</table>
${renderRewardItems('Items', rewards.items, names)}
${renderRewardItems('Choice of', rewards.choiceItems, names)}
<h3>Reputation</h3>
${renderReputation(rewards.reputation)}

<h2>Given by</h2>
${renderRelationList(givers, 'Not offered by any creature or object.')}

<h2>Completed at</h2>
${renderRelationList(enders, 'Not completed at any creature or object.')}

${renderPatchLine({ patch, patches, wowPatch })}
${renderRawRow(row)}`;
}
