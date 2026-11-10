import { escapeHtml } from '../layout.js';
import { renderListview } from './listview.js';
import { renderIcon } from './icon.js';
import { qualityClass, entityLink } from './fields.js';
import { itemQualityName, itemClassName, itemSubclassName, inventoryTypeName } from '../../dbLookups/itemClasses.js';
import { textFilter, numberRangeFilter, selectFilter, filterForm } from './filterControls.js';

const COLUMNS = [
  { key: 'name', label: 'Name', sortable: true, cell: (r) => `${renderIcon(r.inventory_icon, r.name)}${entityLink(r)}` },
  { key: 'ilvl', label: 'Item level', sortable: true, cell: (r) => escapeHtml(r.item_level) },
  { key: 'level', label: 'Required level', sortable: true, cell: (r) => escapeHtml(r.required_level) },
  { key: 'slot', label: 'Slot', sortable: true, cell: (r) => escapeHtml(inventoryTypeName(r.inventory_type)) },
  { key: 'type', label: 'Type', sortable: false, cell: (r) => escapeHtml(itemSubclassName(r.class, r.subclass)) },
  { key: 'quality', label: 'Quality', sortable: true, cell: (r) => `<span class="${qualityClass(r.quality)}">${escapeHtml(itemQualityName(r.quality))}</span>` }
];

function href(applied) {
  return (overrides) => `/db/items?${new URLSearchParams({ ...applied, ...overrides })}`;
}

export function renderItemListFragment({ rows, total, filters }) {
  return renderListview({
    columns: COLUMNS, rows, total,
    page: filters.page, pageSize: filters.pageSize,
    sort: filters.sort, dir: filters.dir,
    href: href(filters.applied)
  });
}

// ItemClass ids 0-15, ItemPrototype.h:135-153 (server/dbLookups/itemClasses.js).
const CLASS_IDS = Array.from({ length: 16 }, (_, i) => i);

// Subclass ids run 0-20 (the widest range any class uses, ItemSubclassWeapon,
// ItemPrototype.h:190-215; also the max server/queries/db/itemFilters.js
// accepts). Rather than a second class->subclass map, this just asks
// itemSubclassName for every id and keeps the ones it actually recognises for
// the chosen class - the lookup table already knows which combinations are
// real.
function subclassOptions(cls) {
  return Array.from({ length: 21 }, (_, sub) => sub)
    .map((sub) => ({ value: sub, label: itemSubclassName(cls, sub) }))
    .filter(({ label }) => !label.startsWith('Unknown ('));
}

// The subclass select depends on which class is chosen (subclass ids are
// only meaningful within a class - subclass 2 is Bow under Weapon and Cloth
// under Armor), so it is rendered only once a class is applied: picking a
// class and submitting is one extra round trip, not a missing feature. It
// sits in a stable wrapper because the form swaps only #listview in place -
// the form itself is never re-rendered, so the htmx response carries this
// wrapper again out of band (renderItemListSwap). Without that the control
// only ever appeared on a full page load (walk finding, 2026-09-23).
function subclassControl(a, oob = false) {
  const control = a.class !== undefined
    ? selectFilter({ name: 'subclass', label: 'subtype', options: subclassOptions(a.class), value: a.subclass })
    : '';
  return `<span id="subclass-control"${oob ? ' hx-swap-oob="true"' : ''}>${control}</span>`;
}

// The htmx response: the listview for its target, plus the subclass control
// for the class just applied.
export function renderItemListSwap({ rows, total, filters }) {
  return `${renderItemListFragment({ rows, total, filters })}
${subclassControl(filters.applied, true)}`;
}

// A subtype id means something else under another class, so changing the
// class drops the old one rather than submitting Bow's id as Cloth.
const CLEAR_SUBCLASS = "const s = this.form.elements.subclass; if (s) s.value = '';";

export function renderItemListBody({ rows, total, filters }) {
  const a = filters.applied;

  const controls = `${textFilter({ name: 'q', label: 'name', value: a.q, placeholder: 'name' })}
  ${selectFilter({ name: 'quality', label: 'quality', options: [0, 1, 2, 3, 4, 5, 6].map((q) => ({ value: q, label: itemQualityName(q) })), value: a.quality })}
  ${selectFilter({ name: 'class', label: 'class', options: CLASS_IDS.map((c) => ({ value: c, label: itemClassName(c) })), value: a.class, onchange: CLEAR_SUBCLASS })}
  ${subclassControl(a)}
  ${selectFilter({ name: 'slot', label: 'slot', options: Array.from({ length: 29 }, (_, i) => i).map((i) => ({ value: i, label: inventoryTypeName(i) })), value: a.slot })}
  ${numberRangeFilter({ minName: 'minlevel', maxName: 'maxlevel', label: 'level', min: 0, max: 255, applied: a })}
  ${numberRangeFilter({ minName: 'minilvl', maxName: 'maxilvl', label: 'item level', min: 0, max: 255, applied: a })}
  <input type="hidden" name="sort" value="${escapeHtml(a.sort)}">
  <input type="hidden" name="dir" value="${escapeHtml(a.dir)}">`;

  return `<h1>Items</h1>
${filterForm({ action: '/db/items', target: '#listview', controls })}
${renderItemListFragment({ rows, total, filters })}`;
}
