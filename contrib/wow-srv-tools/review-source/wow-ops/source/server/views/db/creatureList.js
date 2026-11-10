import { escapeHtml } from '../layout.js';
import { renderListview } from './listview.js';
import { entityLink } from './fields.js';
import { creatureTypeName, creatureRankName } from '../../dbLookups/creatureTypes.js';
import { textFilter, numberRangeFilter, selectFilter, filterForm } from './filterControls.js';

// level_min === level_max is the common case (a fixed-level NPC); showing
// "60 - 60" would read as a range that does not exist. creature_template
// itself never guarantees the order, so this does not assume level_min is
// the smaller value beyond what the column names promise.
function levelCell(r) {
  return r.level_min === r.level_max ? escapeHtml(r.level_min) : `${escapeHtml(r.level_min)} - ${escapeHtml(r.level_max)}`;
}

// faction_name is only ever present when the reference schema resolved
// (creatures.js's factionJoin) - decision 2: a bare id is still useful, a
// blank cell is not.
function factionCell(r) {
  return r.faction_name ? escapeHtml(r.faction_name) : `faction #${escapeHtml(r.faction)}`;
}

// map_id and spawn_count both come from the spawn tables, not the template
// (creatures.js's fetchSpawnSummary) - a template with no spawn rows has
// neither, and decision 3 says that gets a sentence, not a blank cell.
function mapCell(r, mapNames) {
  if (!r.spawn_count) return '<span class="detail">not spawned</span>';
  const name = r.map_id === null ? null : mapNames.get(Number(r.map_id));
  return name ? escapeHtml(name) : `map #${escapeHtml(r.map_id)}`;
}

const COLUMNS = (mapNames) => [
  { key: 'name', label: 'Name', sortable: true, cell: (r) => entityLink({ kind: 'creature', entry: r.entry, name: r.name }) },
  { key: 'level', label: 'Level', sortable: true, cell: levelCell },
  { key: 'rank', label: 'Rank', sortable: true, cell: (r) => escapeHtml(creatureRankName(r.rank)) },
  { key: 'type', label: 'Type', sortable: true, cell: (r) => escapeHtml(creatureTypeName(r.type)) },
  { key: 'faction', label: 'Faction', sortable: false, cell: factionCell },
  { key: 'map', label: 'Map', sortable: false, cell: (r) => mapCell(r, mapNames) },
  { key: 'spawns', label: 'Spawns', sortable: false, cell: (r) => escapeHtml(r.spawn_count) }
];

function href(applied) {
  return (overrides) => `/db/npcs?${new URLSearchParams({ ...applied, ...overrides })}`;
}

export function renderCreatureListFragment({ rows, total, filters, mapNames }) {
  return renderListview({
    columns: COLUMNS(mapNames), rows, total,
    page: filters.page, pageSize: filters.pageSize,
    sort: filters.sort, dir: filters.dir,
    href: href(filters.applied)
  });
}

export function renderCreatureListBody({ rows, total, filters, mapNames }) {
  const a = filters.applied;

  const controls = `${textFilter({ name: 'q', label: 'name', value: a.q, placeholder: 'name' })}
  ${textFilter({ name: 'faction', label: 'faction', value: a.faction, placeholder: 'faction' })}
  ${selectFilter({ name: 'rank', label: 'rank', options: [0, 1, 2, 3, 4].map((r) => ({ value: r, label: creatureRankName(r) })), value: a.rank })}
  ${selectFilter({ name: 'type', label: 'type', options: Array.from({ length: 12 }, (_, i) => i).map((t) => ({ value: t, label: creatureTypeName(t) })), value: a.type })}
  ${numberRangeFilter({ minName: 'minlevel', maxName: 'maxlevel', label: 'level', min: 0, max: 255, applied: a })}
  <input type="hidden" name="sort" value="${escapeHtml(a.sort)}">
  <input type="hidden" name="dir" value="${escapeHtml(a.dir)}">`;

  return `<h1>NPCs</h1>
${filterForm({ action: '/db/npcs', target: '#listview', controls })}
${renderCreatureListFragment({ rows, total, filters, mapNames })}`;
}
