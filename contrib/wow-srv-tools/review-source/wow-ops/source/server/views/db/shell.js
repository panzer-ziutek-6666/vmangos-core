import { escapeHtml } from '../layout.js';

// A second layout, deliberately not a parameterisation of views/layout.js.
// The operator sections and the reference browser want different chrome, and
// the only piece they genuinely share - escapeHtml - is already exported.
// If a third layout ever appears, that is the moment to extract; not now.
const NAV = [
  { id: 'home', label: 'Database', href: '/db' },
  { id: 'items', label: 'Items', href: '/db/items' },
  { id: 'itemsets', label: 'Item sets', href: '/db/itemsets' },
  { id: 'npcs', label: 'NPCs', href: '/db/npcs' },
  { id: 'objects', label: 'Objects', href: '/db/objects' },
  { id: 'quests', label: 'Quests', href: '/db/quests' },
  { id: 'spells', label: 'Spells', href: '/db/spells' },
  { id: 'skills', label: 'Skills', href: '/db/skills' },
  { id: 'zones', label: 'Zones', href: '/db/zones' },
  { id: 'factions', label: 'Factions', href: '/db/factions' },
  { id: 'talents', label: 'Talents', href: '/db/talents' }
];

function renderNav(active) {
  return NAV
    .map((n) => `<a class="nav-item${n.id === active ? ' active' : ''}" href="${n.href}">${escapeHtml(n.label)}</a>`)
    .join('\n    ');
}

// A plain GET form, not htmx: it has to work from any browser page, and most
// of them (an item page, the items listview) never render #db-results, the
// only element the htmx search form in renderSearchBody can target. Carried
// in the shell so every page gets it, not just /db itself - going home to
// search again was the most-used control on a reference browser being one
// click too many (final review, 2026-09-22). /db's own route reads
// req.query.q and runs the same search /db/search does, so this still works
// with htmx unavailable.
function renderHeaderSearch() {
  return `<form class="db-search" method="get" action="/db">
      <input type="search" name="q" placeholder="name or id" aria-label="search">
      <button type="submit">Search</button>
    </form>`;
}

export function renderBrowserPage({ title, active, body, wowPatch, clientBuild, artAvailable }) {
  // The art note is a fact about this checkout, not an error: the extractor
  // is offline tooling and a fresh clone has never run it.
  const artNote = artAvailable
    ? ''
    : '\n    <p class="detail">No extracted art found: run <code class="command">npm run extract-art</code> to show icons.</p>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — wow-ops database</title>
  <link rel="stylesheet" href="/public/app.css">
  <script src="/public/htmx.min.js" defer></script>
</head>
<body class="db-browser">
  <header>
    <a class="brand" href="/db">wow-ops db</a>
    ${renderNav(active)}
    ${renderHeaderSearch()}
    <a class="nav-item nav-back" href="/accounts">back to the panel</a>
  </header>
  <div class="strip">
    <span class="detail">Read-only. Rows are read as patch ${escapeHtml(wowPatch)}, client build ${escapeHtml(clientBuild)} — the configuration the running server loaded with.</span>
  </div>
  <main>${artNote}
    ${body}
  </main>
</body>
</html>`;
}
