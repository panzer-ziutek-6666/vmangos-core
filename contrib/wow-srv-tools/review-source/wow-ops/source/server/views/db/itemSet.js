import { escapeHtml } from '../layout.js';
import { dbLink, entityLink } from './fields.js';
import { renderIcon } from './icon.js';
import { renderListview } from './listview.js';
import { substituteSpellText } from '../../dbLookups/spellText.js';
import { spellContext } from '../../dbLookups/spellLabels.js';
import { referencedContexts } from './spellTooltip.js';

// The eight spell_id_N / items_to_trigger_spell_N pairs item_set.dbc carries
// (tools/dbc/layouts - 172 rows on this realm), written as the client writes
// them: "(N) Set: <what the bonus spell does>", fewest pieces first. The text
// is the bonus spell's description, substituted as every spell's is
// (server/dbLookups/spellText.js), linked to the spell with its hover card; a
// spell the read did not find still links by id.
function bonusText(row, labels, referenced) {
  if (!row) return null;
  const ctx = spellContext(row, labels, referencedContexts(referenced, labels));
  return substituteSpellText(row.description, ctx).trim() || row.name || null;
}

const EMPTY_LABELS = { castMs: new Map(), durationMs: new Map(), range: new Map(), radius: new Map(), iconName: new Map() };

function renderBonuses(set, bonusSpells = new Map(), labels = EMPTY_LABELS, referenced = new Map()) {
  const bonuses = [];
  for (let i = 1; i <= 8; i++) {
    const spellId = Number(set[`spell_id_${i}`]);
    const pieces = Number(set[`items_to_trigger_spell_${i}`]);
    if (spellId && pieces) bonuses.push({ spellId, pieces });
  }
  if (bonuses.length === 0) return '<p class="detail">No set bonuses.</p>';
  const items = bonuses
    .sort((x, y) => x.pieces - y.pieces)
    .map(({ spellId, pieces }) => {
      const text = bonusText(bonusSpells.get(spellId), labels, referenced);
      return `<li>(${escapeHtml(pieces)}) Set: ${entityLink({ kind: 'spell', entry: spellId, name: text })}</li>`;
    });
  return `<ul>
    ${items.join('\n    ')}
  </ul>`;
}

function renderMembers(members) {
  if (members.length === 0) {
    return '<p class="detail">No known members.</p>';
  }
  const items = members
    .map((m) => `<li>${renderIcon(m.inventory_icon, m.name)}${entityLink(m)}</li>`)
    .join('\n    ');
  return `<ul>
    ${items}
  </ul>`;
}

// required_skill_id 0 means "no skill required" (item_set.dbc), not skill id
// 0 - skipped entirely rather than shown as "skill #0".
function renderRequiredSkill(set, skillName) {
  if (!Number(set.required_skill_id)) return '';
  const label = skillName ?? `skill #${escapeHtml(set.required_skill_id)}`;
  return `<tr><th>required skill</th><td>${escapeHtml(label)} (${escapeHtml(set.required_skill_value)})</td></tr>`;
}

export function renderItemSetPage({ set, members, skillName, bonusSpells, labels, referenced }) {
  return `<h1>${escapeHtml(set.name)}</h1>
<p><a href="/db/itemsets">back to item sets</a></p>
<table class="facts">
  <tr><th>id</th><td>${escapeHtml(set.id)}</td></tr>
  ${renderRequiredSkill(set, skillName)}
</table>

<h2>Members</h2>
${renderMembers(members)}

<h2>Set bonuses</h2>
${renderBonuses(set, bonusSpells, labels, referenced)}`;
}

const COLUMNS = [
  { key: 'name', label: 'Name', sortable: false, cell: (r) => dbLink('itemset', r.id, r.name) },
  {
    key: 'skill', label: 'Required skill', sortable: false,
    cell: (r) => (Number(r.required_skill_id) ? escapeHtml(r.skill_name ?? `skill #${r.required_skill_id}`) : '<span class="detail">none</span>')
  }
];

function href() {
  return () => '/db/itemsets';
}

// No filters or paging: 172 rows on this realm is small enough for one page,
// and there is nothing yet worth filtering item sets by. renderListview
// still needs paging fields, so the whole result is presented as a single
// page.
export function renderItemSetListBody({ rows, total }) {
  if (rows.length === 0 && total === 0) {
    return `<h1>Item sets</h1>
<p class="error">No item sets found: the reference schema may not be built. Run <code class="command">npm run import-dbc</code> to populate it.</p>`;
  }

  return `<h1>Item sets</h1>
${renderListview({
    columns: COLUMNS, rows, total,
    page: 1, pageSize: Math.max(rows.length, 1),
    sort: 'name', dir: 'asc',
    href: href()
  })}`;
}
