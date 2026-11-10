import { escapeHtml } from '../layout.js';
import { renderRawRow, renderPatchLine, dbLink, renderQuestList, qualityClass, entityLink, RESISTANCE_COLUMNS } from './fields.js';
import { renderIcon } from './icon.js';
import {
  itemQualityName, itemClassName, itemSubclassName, inventoryTypeName, bondingName,
  itemStatName, spellSchoolName, itemSpellTriggerName
} from '../../dbLookups/itemClasses.js';

// One reverse-source list: every entry already carries its own name
// (resolved at load time in loadItem) and an optional viaReference, shown
// in the label so a reference-only route is never confused with a direct
// one. An item-kind source (the "Contained in" list) is linked through
// entityLink, not the plain dbLink every other kind uses, so this page's own
// cross-links carry the same hover tooltip the listview and set pages do
// (README's "an item page's own cross-links" claim) - containedIn carries
// the container's own item quality (queries/db/item.js reads it off the
// loot row), so the link is quality-coloured like any other item link; only
// a container whose quality lookup misses takes the body-link accent with
// no class (fields.js).
function renderSourceList(title, sources, kind, emptyLabel) {
  const heading = `<h3>${escapeHtml(title)}</h3>`;
  if (sources.length === 0) {
    return `${heading}<p class="detail">${escapeHtml(emptyLabel)}</p>`;
  }
  const items = sources
    .map((s) => {
      const via = s.viaReference ? ` <span class="detail">(via reference ${escapeHtml(s.viaReference)})</span>` : '';
      const link = kind === 'item' ? entityLink(s) : dbLink(kind, s.entry, s.name);
      return `<li>${link}${via}</li>`;
    })
    .join('\n    ');
  return `${heading}
  <ul>
    ${items}
  </ul>`;
}

// fishing_loot_template's entry is an Area.dbc id, not something this panel
// has a page for - shown by number alone, never as a link to a page that
// does not exist. The area name (fetchAreaNames, server/dbLookups/maps.js)
// is shown beside the id the same way every dbLink label reads, just without
// the link itself.
function renderFishing(sources) {
  if (sources.length === 0) {
    return '<p class="detail">Not obtained from fishing.</p>';
  }
  const items = sources
    .map((s) => {
      const label = s.name ? `${escapeHtml(s.name)} (area #${escapeHtml(s.entry)})` : `area #${escapeHtml(s.entry)}`;
      const via = s.viaReference ? ` <span class="detail">(via reference ${escapeHtml(s.viaReference)})</span>` : '';
      return `<li>${label}${via}</li>`;
    })
    .join('\n    ');
  return `<ul>
    ${items}
  </ul>`;
}

function renderVendor(vendor) {
  if (vendor.length === 0) {
    return '<p class="detail">Not sold by any vendor.</p>';
  }
  const rows = vendor
    .map((v) => `      <tr><td>${dbLink('creature', v.entry, v.name)}</td><td>${escapeHtml(v.source)}</td></tr>`)
    .join('\n');
  return `<table>
    <thead><tr><th>vendor</th><th>source</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
}

// item_template's stat array: stat_type1..10 paired with stat_value1..10
// (ItemPrototype.h). A slot with stat_value 0 carries no stat regardless of
// what stat_type happens to default to (0, Mana) - skipped, or a plain item
// with no stats at all would print ten "Mana: 0" rows.
function renderStats(row) {
  const items = [];
  for (let i = 1; i <= 10; i++) {
    const value = Number(row[`stat_value${i}`]);
    if (!value) continue;
    const name = itemStatName(row[`stat_type${i}`]);
    items.push(`<li>${escapeHtml(name)}: ${escapeHtml(value)}</li>`);
  }
  if (items.length === 0) return '<p class="detail">No stats.</p>';
  return `<ul>
    ${items.join('\n    ')}
  </ul>`;
}

// dmg_min1..5 / dmg_max1..5 / dmg_type1..5 - a weapon's damage roll(s) and
// the school each is dealt in. A slot with both min and max at 0 is empty.
function renderDamage(row) {
  const items = [];
  for (let i = 1; i <= 5; i++) {
    const min = Number(row[`dmg_min${i}`]);
    const max = Number(row[`dmg_max${i}`]);
    if (!min && !max) continue;
    const school = spellSchoolName(row[`dmg_type${i}`]);
    items.push(`<li>${escapeHtml(min)}–${escapeHtml(max)} ${escapeHtml(school)}</li>`);
  }
  if (items.length === 0) return '<p class="detail">No damage.</p>';
  return `<ul>
    ${items.join('\n    ')}
  </ul>`;
}

// RESISTANCE_COLUMNS is fields.js's (shared with tooltip.js, which renders
// the same six columns as bare <div> lines for the hover card rather than
// this <li> list). Armor is shown separately in `facts`, not here, since it
// is not one of the magic-school resistances. A zero value means the item
// grants nothing in that school, which is true of most items, so it is
// skipped rather than listed as "Holy: 0" six times over.
function renderResistances(row) {
  const items = RESISTANCE_COLUMNS
    .map(([col, label]) => [label, Number(row[col])])
    .filter(([, value]) => value)
    .map(([label, value]) => `<li>${escapeHtml(label)}: ${escapeHtml(value)}</li>`);
  if (items.length === 0) return '<p class="detail">No resistances.</p>';
  return `<ul>
    ${items.join('\n    ')}
  </ul>`;
}

// spellid_1..5 / spelltrigger_1..5 - up to five spells an item can cast, each
// with when it triggers (ItemSpelltriggerType). Each links to its own page
// and carries its hover card, the same way quest.js's spellLabel and
// creature.js's renderTrainer now link a spell - entityLink's own "#<id>"
// fallback covers a name lookup miss. A slot with spellid 0 is empty.
function renderItemSpells(row, names) {
  const items = [];
  for (let i = 1; i <= 5; i++) {
    const spellId = Number(row[`spellid_${i}`]);
    if (!spellId) continue;
    const trigger = itemSpellTriggerName(row[`spelltrigger_${i}`]);
    const link = entityLink({ kind: 'spell', entry: spellId, name: names.spell?.get(spellId) });
    items.push(`<li>${link} <span class="detail">(${escapeHtml(trigger)})</span></li>`);
  }
  if (items.length === 0) return '<p class="detail">No spells.</p>';
  return `<ul>
    ${items.join('\n    ')}
  </ul>`;
}

// The read-only item page: a decoded summary, every reverse source list, then
// - at the bottom, always - the raw row and the patch it was read at.
//
// `data` is loadItem's return value with one addition: `wowPatch`, the
// configured patch the page was rendered against, which the route attaches
// before calling this (loadItem itself has no reason to carry the server's
// own configuration back out through its return value) - the same
// convention Task 9's creature page established.
export function renderItemPage(data) {
  const {
    row, droppedBy, containedIn, objectLoot, gatheredFrom, soldBy,
    questsRequiring, questsRewarding, names, patch, patches, wowPatch,
    inventoryIcon, setName
  } = data;

  const facts = `<table class="facts">
  <tr><th>entry</th><td>${escapeHtml(data.entry)}</td></tr>
  <tr><th>quality</th><td>${escapeHtml(itemQualityName(row.quality))}</td></tr>
  <tr><th>class</th><td>${escapeHtml(itemClassName(row.class))} — ${escapeHtml(itemSubclassName(row.class, row.subclass))}</td></tr>
  <tr><th>item level</th><td>${escapeHtml(row.item_level)}</td></tr>
  <tr><th>required level</th><td>${escapeHtml(row.required_level)}</td></tr>
  <tr><th>inventory type</th><td>${escapeHtml(inventoryTypeName(row.inventory_type))}</td></tr>
  <tr><th>bonding</th><td>${escapeHtml(bondingName(row.bonding))}</td></tr>
  <tr><th>set</th><td>${row.set_id ? dbLink('itemset', row.set_id, setName) : '—'}</td></tr>
  <tr><th>starts quest</th><td>${row.start_quest ? dbLink('quest', row.start_quest, null) : '—'}</td></tr>
</table>`;

  return `<h1>${renderIcon(inventoryIcon, row.name)}<span class="${qualityClass(row.quality)}">${escapeHtml(row.name)}</span></h1>
<p><a href="/db">back to search</a></p>
${row.description ? `<p class="detail">${escapeHtml(row.description)}</p>` : ''}
${facts}

<h3>Stats</h3>
${renderStats(row)}
<h3>Damage</h3>
${renderDamage(row)}
<h3>Resistances</h3>
${renderResistances(row)}
<h3>Spells</h3>
${renderItemSpells(row, names)}

<h2>Dropped by</h2>
${renderSourceList('Creatures', droppedBy, 'creature', 'Not a known creature drop.')}

<h2>Contained in</h2>
${renderSourceList('Containers', containedIn, 'item', 'Not found inside another item.')}

<h2>Found in</h2>
${renderSourceList('Objects', objectLoot, 'gameobject', 'Not a known object drop.')}

<h2>Gathered</h2>
${renderSourceList('Skinned', gatheredFrom.skinning, 'creature', 'Not obtained from skinning.')}
${renderSourceList('Pickpocketed', gatheredFrom.pickpocketing, 'creature', 'Not obtained from pickpocketing.')}
<h3>Fished</h3>
${renderFishing(gatheredFrom.fishing)}

<h2>Sold by</h2>
${renderVendor(soldBy)}

<h2>Quests requiring this item</h2>
${renderQuestList(questsRequiring, names.quest, 'Not required by any quest.')}

<h2>Quests rewarding this item</h2>
${renderQuestList(questsRewarding, names.quest, 'Not a reward from any quest.')}

${renderPatchLine({ patch, patches, wowPatch })}
${renderRawRow(row)}`;
}
