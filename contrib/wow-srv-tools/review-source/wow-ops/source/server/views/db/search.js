import { escapeHtml } from '../layout.js';

const KIND_LABELS = {
  creature: 'Creatures', item: 'Items', quest: 'Quests', gameobject: 'Game objects',
  spell: 'Spells', zone: 'Zones and areas', faction: 'Factions'
};

function renderGroup(group) {
  const rows = group.rows
    .map((r) => `      <tr><td>${escapeHtml(r.id)}</td><td><a href="/db/${escapeHtml(group.kind)}/${escapeHtml(r.id)}">${escapeHtml(r.name)}</a></td></tr>`)
    .join('\n');

  const body = group.rows.length
    ? `<table>
    <thead><tr><th>id</th><th>name</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`
    : '<p class="detail">No matches.</p>';

  // The count query and the capped select can disagree on purpose: total
  // says how many rows matched, rows.length says how many are shown.
  const truncated = group.total > group.rows.length
    ? `<p class="detail">${group.total} match${group.total === 1 ? '' : 'es'}; showing ${group.rows.length}.</p>`
    : '';

  return `<section>
  <h2>${escapeHtml(KIND_LABELS[group.kind] ?? group.kind)} <span class="detail">(${group.total})</span></h2>
  ${body}
  ${truncated}
</section>`;
}

// The fragment htmx swaps into #db-results. Also called by the full-page
// route to seed that div's initial contents (empty on a fresh page load,
// since no search has run yet).
export function renderSearchResults(result) {
  if (!result || result.groups.length === 0) return '';

  const note = result.numeric
    ? '<p class="detail">The term is all digits, so it was looked up as an id in every type below.</p>'
    : '';

  return `${note}
${result.groups.map(renderGroup).join('\n')}`;
}

// worldConfigured mirrors the pattern the other sections use when the world
// pool is absent: an explanatory note in place of the form, never a 500.
export function renderSearchBody({ q, result, worldConfigured }) {
  if (!worldConfigured) {
    return `<h1>Database</h1>
<p class="error">Database search is not available: the world database is not configured in config.json.</p>`;
  }

  // #db-results must exist here, on the freshly rendered page, not only in
  // the fragment /db/search returns. htmx resolves hx-target before it issues
  // the request; a page missing this element aborts every submit with a
  // targetError and no request is ever sent - invisible to curl, which never
  // runs htmx at all.
  return `<h1>Database</h1>
<form hx-get="/db/search" hx-target="#db-results" hx-trigger="submit">
  <input type="search" name="q" value="${escapeHtml(q ?? '')}" placeholder="name or id" autofocus>
  <button type="submit">Search</button>
</form>
<div id="db-results">${renderSearchResults(result)}</div>`;
}
