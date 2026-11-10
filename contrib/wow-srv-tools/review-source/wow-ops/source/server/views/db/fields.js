import { escapeHtml } from '../layout.js';

// Every related id on every entity page is a link built the same way - the
// four entity types this section knows about (creature, item, quest,
// gameobject - server/sections/db.js) are never a dead number the operator
// has to paste into the search box themselves. Was duplicated verbatim in
// creature.js, item.js, quest.js and gameobject.js; hoisted here so the rule
// exists in one place.
export function dbLink(kind, id, name) {
  const label = name ? escapeHtml(name) : `#${escapeHtml(id)}`;
  return `<a href="/db/${kind}/${escapeHtml(id)}">${label}</a>`;
}

// A skill line link, the same shape as dbLink but kept under its own name:
// /db/skill/:id is not one of dbLink's four entity kinds (no hover route to
// fetch). skill.js, spell.js and spellList.js each wrote this by hand, with
// two different fallback labels ("#id" in one, "skill #id" in the others) -
// one implementation now, with dbLink's fallback.
export function skillLink(id, name) {
  return dbLink('skill', id, name);
}

// A plain list of quest ids, each linked through entityLink so it carries the
// quest hover card - the shape creature.js's "quests given"/"quests ended",
// item.js's "quests requiring"/"quests rewarding" and gameobject.js's "quests
// given"/"quests ended" all render identically. Was duplicated verbatim in
// those three files; hoisted here for the same reason as dbLink above.
// entityLink is declared later in this module; function declarations are
// hoisted, so the order does not matter.
export function renderQuestList(ids, questNames, emptyLabel) {
  if (ids.length === 0) {
    return `<p class="detail">${escapeHtml(emptyLabel)}</p>`;
  }
  const items = ids.map((id) => `<li>${entityLink({ kind: 'quest', entry: id, name: questNames.get(id) })}</li>`).join('\n    ');
  return `<ul>
    ${items}
  </ul>`;
}

// The bottom-of-page fallback every entity page (Tasks 9-12) shares: whatever
// the decoded summary above it does not cover is still here, verbatim, so a
// column this panel has not learned to explain yet is never simply invisible.
// Collapsed behind <details> because a template row can carry seventy-plus
// columns and most of them are display/scaling fields nobody is here to read.
export function renderRawRow(row) {
  const entries = Object.entries(row);
  const rows = entries
    .map(([key, value]) => {
      // Only a genuine SQL NULL renders as the dash. escapeHtml alone would
      // turn null into an empty cell indistinguishable from an empty string
      // already in the data, which is a different fact about the row.
      const display = value === null || value === undefined ? '—' : escapeHtml(value);
      return `      <tr><th>${escapeHtml(key)}</th><td>${display}</td></tr>`;
    })
    .join('\n');

  return `<details>
  <summary>all ${entries.length} columns</summary>
  <table class="facts">
${rows}
  </table>
</details>`;
}

// Every progressive table (creature_template, item_template, quest_template,
// gameobject_template, ...) can carry more than one row per entry - see
// progressive.js. This says, in one line, which row the page is actually
// showing and whether that was a choice at all.
export function renderPatchLine({ patch, patches, wowPatch }) {
  const variants = patches.length > 1
    ? ` This entry has variant rows at patch ${patches.join(', ')}; the one shown is the highest not above the configured patch.`
    : '';
  return `<p class="detail">Shown at patch ${escapeHtml(patch)} (the highest not above the configured patch ${escapeHtml(wowPatch)}).${variants}</p>`;
}

// The loot chance cell, shared by the creature and gameobject pages. A quest
// drop is stored as a negative ChanceOrQuestChance and read apart in
// server/queries/db/loot.js; the flag is named here rather than left to the
// reader, who would otherwise see a 100% drop that never falls.
export function lootChanceCell(loot) {
  const quest = loot.needsQuest ? ' <span class="detail">(quest drop)</span>' : '';
  return `${escapeHtml(loot.chance)}%${quest}`;
}

// The six SpellSchools resistances item_template carries (holy_res through
// arcane_res) - armor is not one of them and is shown separately wherever it
// appears. A zero value means the item grants nothing in that school, true
// of most items. Shared between item.js's full <li> list and tooltip.js's
// bare <div> lines - the array was duplicated byte for byte between them;
// the line builders around it legitimately differ in markup and stay apart.
export const RESISTANCE_COLUMNS = [
  ['holy_res', 'Holy'], ['fire_res', 'Fire'], ['nature_res', 'Nature'],
  ['frost_res', 'Frost'], ['shadow_res', 'Shadow'], ['arcane_res', 'Arcane']
];

// Quality colours are the client's own, read from the core rather than from a
// screenshot: vmangos-core/src/game/SharedDefines.h:205 (ItemQualityColors).
// The seven classes q0..q6 in public/app.css carry the values. Shared here
// because item listview, item sets and any later item-linking view all need
// the same colour for the same quality.
export function qualityClass(quality) {
  const q = Number(quality);
  return Number.isInteger(q) && q >= 0 && q <= 6 ? `q${q}` : 'q1';
}

// Every entity link that offers a hover tooltip (server/views/db/tooltip.js,
// GET /db/tooltip/<kind>/:id) - itemList.js and itemSet.js's member list
// needed this first, and Task 3's creature listview shares it rather than
// writing a second copy, so it takes the entity kind instead of assuming
// 'item'.
//
// The link is wrapped in a positioned host span rather than swapped
// hx-swap="afterend": afterend inserts the fetched tooltip as a sibling that
// nothing ever removes, so hovering N items leaves N tooltips stacked on the
// page (walk finding 1, 2026-09-22). hx-target="closest .tooltip-host" with
// hx-swap="beforeend" puts the fragment inside the host instead, and
// public/app.css hides it until that host is hovered - CSS does the
// appear/disappear, not another request, so "mouseenter once" is still
// correct: fetching once per item was never the bug.
//
// quality only means anything for an item (qualityClass, ItemQualityColors) -
// a creature or gameobject link carries no class at all rather than the
// default q1 white, which would read as a fact about the row.
//
// A missing name falls back to "#<entry>", as dbLink does: the creature and
// gameobject pages' loot and vendor tables name items through a lookup that
// can miss, and an anchor with no text is a link nobody can see or click.
//
// The loot and vendor tables on the creature and gameobject pages, and
// item.js's "contained in" list, all know their item's quality now (read
// through fetchItemNamesWithQuality, or the container row's own `quality`
// for "contained in", passed in as itemEntityLink's `quality` argument):
// only a link whose item row entityLink cannot find carries no class,
// rather than q1, which would call an epic drop Common. The hover card
// still shows the real quality even then.
//
// Named entityLink since cycle 5a: it serves items, creatures, gameobjects
// and quests, and was itemLink while it only served items.
export function entityLink({ kind = 'item', entry, name, quality }) {
  const cls = kind === 'item' && quality != null ? ` class="${qualityClass(quality)}"` : '';
  const label = name ? escapeHtml(name) : `#${escapeHtml(entry)}`;
  return `<span class="tooltip-host"><a${cls} href="/db/${kind}/${escapeHtml(entry)}"
    hx-get="/db/tooltip/${kind}/${escapeHtml(entry)}" hx-target="closest .tooltip-host" hx-trigger="mouseenter once" hx-swap="beforeend">${label}</a></span>`;
}

// An item link from an entity page's `names` object: the name and, when the
// loader read it, the quality. names.itemQuality is optional so a fixture or
// caller without it still renders, uncoloured.
export function itemEntityLink(id, names) {
  return entityLink({ entry: id, name: names.item.get(id), quality: names.itemQuality?.get(id) });
}

// skill_line_ability's two unrelated "skill level" columns, shared by every
// page that lists what an ability needs: the skill page's own table
// (server/views/db/skill.js) and a spell's "taught by skill lines" list
// (server/views/db/spell.js) both read the same row shape
// (server/queries/db/skill.js fetchAbilities, server/queries/db/spell.js
// fetchSkillLines) and used to format it two different, and once one wrong,
// ways - this is the one place the rule lives now.
//
// The skill-up range a player actually trains against - min_value (yellow,
// still gainable) to max_value (grey, no longer gainable)
// (vmangos-core/src/game/Objects/Player.cpp:5419-5421,
// SkillGainChance(skillValue, max_value, midpoint, min_value)) - not
// req_skill_value, which is the unrelated auto-learn threshold
// (autoLearnLabel below). max_value 0 means the row carries no gain range at
// all (most non-recipe abilities), dashed rather than printed as "0-0".
export function skillUpLabel(a) {
  return Number(a.maxValue) === 0 ? '—' : `${escapeHtml(a.minValue)}–${escapeHtml(a.maxValue)}`;
}

// req_skill_value only means something when learn_on_get_skill is set - it
// is the level at which the core auto-learns (and un-learns below) this
// ability on its own, not a prerequisite the player must already have
// (vmangos-core/src/game/Objects/Player.cpp:5941, `if (currVal <
// pAbility->req_skill_value) RemoveSpell(...)`, itself gated two lines above
// by `if (!pAbility->learnOnGetSkill) continue;`). Every other row's
// req_skill_value is unused by the core and would only mislead if shown, so
// this returns null rather than a dash - a caller that wants one for an
// always-present table cell supplies it itself (skill.js); a caller that
// omits the fact entirely when there is none (spell.js's list) does not
// have to invent one.
export function autoLearnLabel(a) {
  return a.learnOnGetSkill ? `auto-learned at ${escapeHtml(a.reqSkillValue)}` : null;
}

// A plain table, headers plus pre-built row markup - zone.js and faction.js
// each defined this verbatim; one copy now.
export function table(headers, rows) {
  if (rows.length === 0) return '<p class="detail">None.</p>';
  return `<table>
  <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
  <tbody>
${rows.join('\n')}
  </tbody>
</table>`;
}

// area_template.team is the core's AreaTeams (AREATEAM_NONE 0, AREATEAM_ALLY 2,
// AREATEAM_HORDE 4; vmangos-core/src/game/Database/DBCEnums.h:46-50). A zone
// with neither is contested ground.
export function teamName(team) {
  const value = Number(team);
  if (value === 0) return 'Contested';
  if (value === 2) return 'Alliance';
  if (value === 4) return 'Horde';
  return `team #${value}`;
}
