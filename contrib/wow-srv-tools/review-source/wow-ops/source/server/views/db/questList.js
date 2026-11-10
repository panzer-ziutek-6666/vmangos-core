import { escapeHtml } from '../layout.js';
import { renderListview } from './listview.js';
import { entityLink } from './fields.js';
import { renderIcon } from './icon.js';
import { questTypeName, questSide, questLevelLabel, categoryLabel, QUEST_TYPES, CATEGORY_GROUPS } from '../../dbLookups/questCategories.js';
import { textFilter, numberRangeFilter, selectFilter, groupedSelectFilter, filterForm } from './filterControls.js';

// Copper as the client writes it: 12345 -> "1g 23s 45c", leading zero units dropped.
function formatMoney(copper) {
  const g = Math.floor(copper / 10000);
  const s = Math.floor((copper % 10000) / 100);
  const c = copper % 100;
  return [g ? `${g}g` : '', s ? `${s}s` : '', c ? `${c}c` : ''].filter(Boolean).join(' ');
}

function rewardItem(id, count, items) {
  const item = items.get(id);
  const qty = count > 1 ? ` ×${escapeHtml(count)}` : '';
  return `<span class="reward">${renderIcon(item?.icon, item?.name)}${entityLink({ entry: id, name: item?.name, quality: item?.quality })}${qty}</span>`;
}

// Fixed rewards, then the choice ("choose one") rewards, then XP and money.
// RewXP is the full award up to five levels above the quest (Quest::XPValue,
// vmangos-core/src/game/QuestDef.cpp:180-200), scaled by the server's own
// quest XP rate and given only below the level cap - a character already at
// the cap is paid money instead (vmangos-core/src/game/Objects/
// Player.cpp:13370-13376); a positive RewOrReqMoney is scaled by the
// server's money rate at hand-in (QuestDef.cpp:204-209) and a negative one
// is a cost, not a reward - both are shown as stored, which the page says
// above the table.
function rewardsCell(r, items) {
  const fixed = [1, 2, 3, 4]
    .map((i) => [Number(r[`RewItemId${i}`]), Number(r[`RewItemCount${i}`])])
    .filter(([id]) => id)
    .map(([id, count]) => rewardItem(id, count, items));
  const choice = [1, 2, 3, 4, 5, 6]
    .map((i) => [Number(r[`RewChoiceItemId${i}`]), Number(r[`RewChoiceItemCount${i}`])])
    .filter(([id]) => id)
    .map(([id, count]) => rewardItem(id, count, items));
  const parts = [...fixed];
  if (choice.length > 0) parts.push('<span class="detail">choose:</span>', ...choice);
  const xp = Number(r.RewXP);
  if (xp > 0) parts.push(`<span class="detail">${escapeHtml(xp)} xp</span>`);
  const money = Number(r.RewOrReqMoney);
  if (money > 0) parts.push(`<span class="detail">${escapeHtml(formatMoney(money))}</span>`);
  return parts.length > 0 ? parts.join(' ') : '—';
}

const COLUMNS = (items) => [
  { key: 'name', label: 'Name', sortable: true, cell: (r) => entityLink({ kind: 'quest', entry: r.entry, name: r.Title }) },
  { key: 'level', label: 'Level', sortable: true, cell: (r) => escapeHtml(questLevelLabel(r.QuestLevel)) },
  { key: 'minlevel', label: 'Req. level', sortable: true, cell: (r) => escapeHtml(r.MinLevel) },
  { key: 'side', label: 'Races', sortable: false, cell: (r) => escapeHtml(questSide(r.RequiredRaces)) },
  { key: 'category', label: 'Category', sortable: false, cell: (r) => escapeHtml(categoryLabel(r.ZoneOrSort, r.zone_name) ?? '—') },
  { key: 'type', label: 'Type', sortable: false, cell: (r) => escapeHtml(questTypeName(r.Type)) },
  { key: 'rewards', label: 'Rewards', sortable: false, cell: (r) => rewardsCell(r, items) }
];

function href(applied) {
  return (overrides) => `/db/quests?${new URLSearchParams({ ...applied, ...overrides })}`;
}

export function renderQuestListFragment({ rows, total, filters, items }) {
  return renderListview({
    columns: COLUMNS(items), rows, total,
    page: filters.page, pageSize: filters.pageSize,
    sort: filters.sort, dir: filters.dir,
    href: href(filters.applied)
  });
}

export function renderQuestListBody({ rows, total, filters, items, categories }) {
  const a = filters.applied;
  const groups = CATEGORY_GROUPS.map((label) => ({
    label,
    options: categories.filter((c) => c.group === label).map((c) => ({ value: c.id, label: c.label }))
  }));

  const controls = `${textFilter({ name: 'q', label: 'name', value: a.q, placeholder: 'name' })}
  ${selectFilter({ name: 'side', label: 'races', options: [{ value: 'alliance', label: 'open to Alliance races' }, { value: 'horde', label: 'open to Horde races' }], value: a.side })}
  ${selectFilter({ name: 'type', label: 'type', options: [...QUEST_TYPES].map(([value, label]) => ({ value, label })), value: a.type })}
  ${groupedSelectFilter({ name: 'category', label: 'category', groups, value: a.category })}
  ${numberRangeFilter({ minName: 'minlevel', maxName: 'maxlevel', label: 'level', min: 0, max: 255, applied: a })}
  ${numberRangeFilter({ minName: 'minreq', maxName: 'maxreq', label: 'req. level', min: 0, max: 255, applied: a })}
  <input type="hidden" name="sort" value="${escapeHtml(a.sort)}">
  <input type="hidden" name="dir" value="${escapeHtml(a.dir)}">`;

  return `<h1>Quests</h1>
${filterForm({ action: '/db/quests', target: '#listview', controls })}
<p class="detail">XP and money are base values: XP is scaled by the server's quest XP rate and paid in full up to five levels above the quest; a character at the level cap gets money instead of XP, and money is otherwise scaled by the server's rate at hand-in.</p>
${renderQuestListFragment({ rows, total, filters, items })}`;
}
