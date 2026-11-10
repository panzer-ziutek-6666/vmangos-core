export function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll(`'`, '&#39;');
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

// account_banned.bandate and .unbandate (and their equivalents wherever else
// a ban timestamp shows up) are Unix epoch seconds (a MySQL BIGINT), not
// milliseconds. Shared by server/views/accounts.js and server/views/bots.js
// so the same ban renders identically on both pages instead of the two views
// carrying separate copies that could quietly drift apart.
export function formatEpochSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return '—';
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// The action-result block, shared by every section that sends a command.
// Sections render it into the element their forms name in hx-target, and it
// must exist on a freshly loaded page too: htmx resolves that selector
// before it issues the request, so a page missing the element aborts with a
// targetError and every button on it is inert.
export function renderResult(result) {
  if (!result) return '<div id="result"></div>';
  const cls = result.ok ? 'output' : 'output failed';
  const warning = result.auditFailed
    ? '\n  <p class="error">Warning: this action was NOT recorded in the audit log (the write failed). The action itself still happened.</p>'
    : '';
  return `<div id="result">
  <p>Sent: <code class="command">${escapeHtml(result.command)}</code></p>
  <pre class="${cls}">${escapeHtml(result.output || '(no output)')}</pre>${warning}
</div>`;
}

export function renderError(message) {
  return `<div id="result"><p class="error">${escapeHtml(message)}</p></div>`;
}

const SECTIONS = [
  { id: 'accounts', label: 'Accounts', href: '/accounts' },
  { id: 'bots', label: 'Bots', href: '/bots' },
  { id: 'server', label: 'Server', href: '/server' },
  { id: 'characters', label: 'Characters', href: '/characters' },
  { id: 'events', label: 'Game events', href: '/events' },
  { id: 'tickets', label: 'Tickets', href: '/tickets' },
  { id: 'db', label: 'Database', href: '/db' },
  { id: 'audit', label: 'Audit log', href: '/audit' }
];

export function renderStatusStrip(status) {
  if (!status.reachable) {
    return `<div id="status" class="strip strip-offline" hx-get="/status" hx-trigger="every 5s" hx-swap="outerHTML">
  <strong>mangosd is not reachable.</strong>
  <span class="detail">${escapeHtml(status.error)}</span>
  <span class="detail">Read-only views still work; commands are disabled.</span>
</div>`;
  }
  const cell = (label, value) => `<span class="cell"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value ?? '—')}</span></span>`;
  return `<div id="status" class="strip" hx-get="/status" hx-trigger="every 5s" hx-swap="outerHTML">
  ${cell('mangosd', 'online')}
  ${cell('uptime', status.uptime)}
  ${cell('players', status.playersOnline)}
  ${cell('bot characters', status.botsOnline)}
  ${cell('queue', status.queueDepth)}
</div>`;
}

export function renderPage({ title, active, body, status }) {
  const nav = SECTIONS.map((s) =>
    `<a class="nav-item${s.id === active ? ' active' : ''}" href="${s.href}">${escapeHtml(s.label)}</a>`
  ).join('\n    ');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — wow-ops</title>
  <link rel="stylesheet" href="/public/app.css">
  <script src="/public/htmx.min.js"></script>
</head>
<body>
  <header>
    <span class="brand">wow-ops</span>
    ${nav}
  </header>
  ${renderStatusStrip(status)}
  <main>
${body}
  </main>
</body>
</html>`;
}
