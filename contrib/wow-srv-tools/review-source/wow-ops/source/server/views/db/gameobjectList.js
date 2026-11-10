import { escapeHtml } from '../layout.js';
import { renderListview } from './listview.js';
import { entityLink } from './fields.js';
import { gameObjectTypeName } from '../../dbLookups/gameObjectTypes.js';
import { textFilter, selectFilter, filterForm } from './filterControls.js';

// map_id and spawn_count both come from the spawn table (the subqueries in
// gameobjects.js), not the template - a template with no spawn rows has
// neither, the same convention creatureList.js's mapCell follows.
function mapCell(r, mapNames) {
  if (!r.spawn_count) return '<span class="detail">not spawned</span>';
  const name = r.map_id === null ? null : mapNames.get(Number(r.map_id));
  return name ? escapeHtml(name) : `map #${escapeHtml(r.map_id)}`;
}

// lock_id, loot_id and quest_id are already read from each type's own slot
// (server/queries/db/gameobjectFilters.js's LOCK_ID_SQL and friends), so
// these cells only decide how to show them. A quest id counts only when
// positive: a goober's -1 is a marker, not a quest (ObjectMgr.cpp:9818).
function lockedCell(r) {
  return Number(r.lock_id) ? escapeHtml(r.lock_id) : '—';
}

const COLUMNS = (mapNames) => [
  { key: 'name', label: 'Name', sortable: true, cell: (r) => entityLink({ kind: 'gameobject', entry: r.entry, name: r.name }) },
  { key: 'type', label: 'Type', sortable: true, cell: (r) => escapeHtml(gameObjectTypeName(r.type)) },
  { key: 'locked', label: 'Locked', sortable: false, cell: lockedCell },
  { key: 'loot', label: 'Loot', sortable: false, cell: (r) => (Number(r.loot_id) ? 'yes' : 'no') },
  { key: 'quest', label: 'Quest', sortable: false, cell: (r) => (Number(r.quest_id) > 0 ? 'yes' : 'no') },
  { key: 'map', label: 'Map', sortable: false, cell: (r) => mapCell(r, mapNames) },
  { key: 'spawns', label: 'Spawns', sortable: false, cell: (r) => escapeHtml(r.spawn_count) }
];

function href(applied) {
  return (overrides) => `/db/objects?${new URLSearchParams({ ...applied, ...overrides })}`;
}

export function renderGameObjectListFragment({ rows, total, filters, mapNames }) {
  return renderListview({
    columns: COLUMNS(mapNames), rows, total,
    page: filters.page, pageSize: filters.pageSize,
    sort: filters.sort, dir: filters.dir,
    href: href(filters.applied)
  });
}

export function renderGameObjectListBody({ rows, total, filters, mapNames }) {
  const a = filters.applied;

  const controls = `${textFilter({ name: 'q', label: 'name', value: a.q, placeholder: 'name' })}
  ${selectFilter({ name: 'type', label: 'type', options: Array.from({ length: 31 }, (_, i) => i).map((t) => ({ value: t, label: gameObjectTypeName(t) })), value: a.type })}
  <label>locked<input type="checkbox" name="locked" value="1"${a.locked ? ' checked' : ''}></label>
  <label>loot<input type="checkbox" name="loot" value="1"${a.loot ? ' checked' : ''}></label>
  <input type="hidden" name="sort" value="${escapeHtml(a.sort)}">
  <input type="hidden" name="dir" value="${escapeHtml(a.dir)}">`;

  return `<h1>Objects</h1>
${filterForm({ action: '/db/objects', target: '#listview', controls })}
${renderGameObjectListFragment({ rows, total, filters, mapNames })}`;
}
