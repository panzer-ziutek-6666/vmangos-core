import { escapeHtml } from '../layout.js';
import { entityLink, skillUpLabel, autoLearnLabel, skillLink } from './fields.js';
import { skillCategoryName, SKILL_CATEGORY_ORDER } from '../../dbLookups/spellTypes.js';
import { classNames, raceNames } from '../../dbLookups/questFlags.js';

// Grouped by SKILL_CATEGORY_ORDER, the same order the spell listview's
// skill filter uses (spellList.js) - a category with no lines is omitted
// rather than rendered as an empty heading.
//
// An empty list is never "no skill lines exist" - skill_line lives only in
// the reference schema, so this is the same "not configured or not built"
// case renderItemSetListBody already explains for item sets (itemSet.js);
// this mirrors that wording rather than leaving the page bare.
export function renderSkillIndex(skillLines) {
  if (skillLines.length === 0) {
    return `<h1>Skills</h1>
<p class="error">No skill lines found: the reference schema may not be built. Run <code class="command">npm run import-dbc</code> to populate it.</p>`;
  }

  const groups = SKILL_CATEGORY_ORDER
    .map((cat) => ({ cat, lines: skillLines.filter((s) => s.category === cat) }))
    .filter((g) => g.lines.length > 0);

  const sections = groups.map(({ cat, lines }) => {
    const items = lines.map((s) => `<li>${skillLink(s.id, s.name)}</li>`).join('\n    ');
    return `<h2>${escapeHtml(skillCategoryName(cat))}</h2>
  <ul>
    ${items}
  </ul>`;
  });

  return `<h1>Skills</h1>
${sections.join('\n')}`;
}

// classMask/raceMask 0 means "no restriction" (classNames/raceNames' own
// zero case), but the brief for this table asks for a plain dash instead -
// so the zero case is handled here rather than deferred to those helpers.
function maskCell(mask, names) {
  const value = Number(mask);
  return value ? names(value).map((n) => escapeHtml(n)).join(', ') : '—';
}

// skillUpLabel and autoLearnLabel (server/views/db/fields.js) are shared
// with a spell's own "taught by skill lines" list, which reads the same
// skill_line_ability columns - this table just needs a dash where that list
// can afford to omit the fact entirely.
function abilityRow(a, spellNames) {
  const spell = entityLink({ kind: 'spell', entry: a.spellId, name: spellNames.get(a.spellId) });
  const supersededBy = a.supersededBy
    ? entityLink({ kind: 'spell', entry: a.supersededBy, name: spellNames.get(a.supersededBy) })
    : '—';
  return `      <tr><td>${spell}</td><td>${skillUpLabel(a)}</td><td>${autoLearnLabel(a) ?? '—'}</td><td>${maskCell(a.classMask, classNames)}</td><td>${maskCell(a.raceMask, raceNames)}</td><td>${supersededBy}</td></tr>`;
}

export function renderSkillPage(data) {
  const { name, category, abilities, spellNames } = data;

  const table = abilities.length
    ? `<table>
    <thead><tr><th>spell</th><th>skill-up</th><th>auto-learned</th><th>classes</th><th>races</th><th>replaced by</th></tr></thead>
    <tbody>
${abilities.map((a) => abilityRow(a, spellNames)).join('\n')}
    </tbody>
  </table>`
    : '<p class="detail">This skill line teaches nothing at this build.</p>';

  return `<h1>${escapeHtml(name)}</h1>
<p class="detail">${escapeHtml(skillCategoryName(category))}</p>
<p><a href="/db/skills">back to skills</a></p>

<h2>Teaches</h2>
${table}`;
}
