import { escapeHtml } from '../layout.js';
import { renderListview } from './listview.js';
import { entityLink, skillLink } from './fields.js';
import { renderIcon } from './icon.js';
import { formatDuration } from '../../dbLookups/spellText.js';
import { spellSchoolName, skillCategoryName, SKILL_CATEGORY_ORDER } from '../../dbLookups/spellTypes.js';
import { classNames } from '../../dbLookups/questFlags.js';
import { VALID_CLASSES } from '../../queries/db/spellFilters.js';
import { textFilter, numberRangeFilter, selectFilter, groupedSelectFilter, filterForm } from './filterControls.js';

// A cast time of 0 is instant; a missing label is a dash.
export function castLabel(ms) {
  if (ms === undefined || ms === null) return '—';
  return Number(ms) > 0 ? formatDuration(ms) : 'Instant';
}

// The longer of the spell's own cooldown and its category cooldown.
export function cooldownLabel(row) {
  const ms = Math.max(Number(row.recoveryTime) || 0, Number(row.categoryRecoveryTime) || 0);
  return ms > 0 ? formatDuration(ms) : '—';
}

const COLUMNS = ({ labels, skills, skillNames }) => [
  { key: 'name', label: 'Name', sortable: true, cell: (r) => `${renderIcon(labels.iconName.get(Number(r.entry)), r.name)}${entityLink({ kind: 'spell', entry: r.entry, name: r.name })}${r.nameSubtext ? ` <span class="detail">${escapeHtml(r.nameSubtext)}</span>` : ''}` },
  { key: 'level', label: 'Level', sortable: true, cell: (r) => escapeHtml(r.spellLevel) },
  { key: 'school', label: 'School', sortable: false, cell: (r) => escapeHtml(spellSchoolName(r.school)) },
  { key: 'skill', label: 'Skill', sortable: false, cell: (r) => {
    const id = skills.get(Number(r.entry));
    return id === undefined ? '—' : skillLink(id, skillNames.get(id));
  } },
  { key: 'cast', label: 'Cast', sortable: false, cell: (r) => escapeHtml(castLabel(labels.castMs.get(Number(r.entry)))) },
  { key: 'cooldown', label: 'Cooldown', sortable: false, cell: (r) => escapeHtml(cooldownLabel(r)) }
];

function href(applied) {
  return (overrides) => `/db/spells?${new URLSearchParams({ ...applied, ...overrides })}`;
}

export function renderSpellListFragment({ rows, total, filters, labels, skills, skillNames }) {
  return renderListview({
    columns: COLUMNS({ labels, skills, skillNames }), rows, total,
    page: filters.page, pageSize: filters.pageSize, sort: filters.sort, dir: filters.dir,
    href: href(filters.applied)
  });
}

export function renderSpellListBody({ rows, total, filters, labels, skills, skillNames, skillLines }) {
  const a = filters.applied;
  const groups = SKILL_CATEGORY_ORDER.map((cat) => ({
    label: skillCategoryName(cat),
    options: skillLines.filter((s) => s.category === cat).map((s) => ({ value: s.id, label: s.name }))
  }));
  const classOptions = [...VALID_CLASSES].map((c) => ({ value: c, label: classNames(1 << (c - 1))[0] }));
  const controls = `${textFilter({ name: 'q', label: 'name', value: a.q, placeholder: 'name' })}
  ${selectFilter({ name: 'class', label: 'class', options: classOptions, value: a.class })}
  ${groupedSelectFilter({ name: 'skill', label: 'skill', groups, value: a.skill })}
  ${selectFilter({ name: 'school', label: 'school', options: [0, 1, 2, 3, 4, 5, 6].map((s) => ({ value: s, label: spellSchoolName(s) })), value: a.school })}
  ${numberRangeFilter({ minName: 'minlevel', maxName: 'maxlevel', label: 'level', min: 0, max: 255, applied: a })}
  <label>every spell<input type="checkbox" name="all" value="1"${a.all ? ' checked' : ''}></label>
  <input type="hidden" name="sort" value="${escapeHtml(a.sort)}">
  <input type="hidden" name="dir" value="${escapeHtml(a.dir)}">`;
  return `<h1>Spells</h1>
${filterForm({ action: '/db/spells', target: '#listview', controls })}
<p class="detail">Only spells a skill line teaches are listed unless "every spell" is ticked; most of the rest are creature, item and trigger spells.</p>
${renderSpellListFragment({ rows, total, filters, labels, skills, skillNames })}`;
}
