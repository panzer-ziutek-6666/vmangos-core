import { escapeHtml, pad2, formatEpochSeconds, renderResult, renderError } from './layout.js';
import { GM_LEVELS, gmLevelName } from '../gmLevels.js';


// Re-exported so server/sections/accounts.js keeps importing its view
// helpers from one place; the implementations are shared with the Server
// section and live in layout.js.
export { renderResult, renderError };

// Local wall-clock time, to the minute: "YYYY-MM-DD HH:MM". Good enough for
// an operator reading the panel on the same machine the times were recorded
// on; anything more precise (seconds, timezone offset) is noise here.
function formatDateTime(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

// account.last_login comes back from mysql2 as a JS Date, or null/undefined
// for an account that has never logged in.
function formatLastLogin(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return formatDateTime(date);
}

function banCell(row) {
  // ban_permanent is `false`, not null, even for an account with no ban at
  // all (see server/queries/accounts.js) - so this ban_active check is what
  // stops an unbanned account from reading as "not permanently banned"
  // below instead of "—".
  if (row.ban_active !== 1) return '—';
  const when = row.ban_permanent ? 'permanent' : `until ${escapeHtml(formatEpochSeconds(row.ban_unbandate))}`;
  return `${when}: ${escapeHtml(row.ban_reason)}`;
}

function actionButton(label, reachable) {
  if (reachable) return `<button type="submit">${label}</button>`;
  return `<button type="submit" disabled>${label}</button>\n  <p class="detail">mangosd is not reachable; commands are disabled.</p>`;
}

export function renderAccountsBody({ rows, includeBots, soapUser, result, reachable = true }) {
  const toggle = includeBots
    ? `<a href="/accounts">hide bot accounts</a>`
    : `<a href="/accounts?bots=1">show bot accounts</a>`;

  const list = rows.map((r) => {
    const isSelf = r.username.toUpperCase() === String(soapUser).toUpperCase();
    return `    <tr class="${r.ban_active === 1 ? 'banned' : ''}">
      <td>${escapeHtml(r.username)}</td>
      <td>${escapeHtml(r.gmlevel)} ${escapeHtml(gmLevelName(r.gmlevel))}${isSelf ? ' <span class="detail">(panel account)</span>' : ''}</td>
      <td>${r.online ? 'yes' : 'no'}</td>
      <td>${escapeHtml(formatLastLogin(r.last_login))}</td>
      <td>${escapeHtml(r.last_ip)}</td>
      <td>${r.locked ? 'yes' : 'no'}</td>
      <td>${Number(r.mutetime) > 0 ? 'yes' : 'no'}</td>
      <td>${banCell(r)}</td>
    </tr>`;
  }).join('\n');

  return `<h1>Accounts</h1>
<p>${toggle}</p>

${renderResult(result)}

<h2>Create</h2>
<form class="action" hx-post="/accounts/create" hx-target="#result" hx-swap="outerHTML">
  <label>account<input name="name" maxlength="16" required></label>
  <label>password<input name="pass" maxlength="16" required></label>
  ${actionButton('Create', reachable)}
</form>

<h2>GM level</h2>
<form class="action" hx-post="/accounts/gmlevel" hx-target="#result" hx-swap="outerHTML">
  <label>account<input name="name" maxlength="16" required></label>
  <label>level<select name="level">
    ${GM_LEVELS.map((l) => `<option value="${l.level}">${l.level} ${escapeHtml(l.name)}</option>`).join('\n    ')}
  </select></label>
  ${actionButton('Set', reachable)}
</form>
<p class="detail">The panel cannot change the GM level of its own account (${escapeHtml(soapUser)}) — the server refuses it.</p>

<h2>Password</h2>
<form class="action" hx-post="/accounts/password" hx-target="#result" hx-swap="outerHTML">
  <label>account<input name="name" maxlength="16" required></label>
  <label>new password<input name="pass" maxlength="16" required></label>
  ${actionButton('Set', reachable)}
</form>

<h2>Ban</h2>
<form class="action" hx-post="/accounts/ban" hx-target="#result" hx-swap="outerHTML">
  <label>account<input name="name" maxlength="16" required></label>
  <label>duration<input name="duration" placeholder="30d, 12h, 1d12h, permanent" required></label>
  <label>reason<input name="reason" required></label>
  ${actionButton('Ban', reachable)}
</form>

<h2>Unban</h2>
<form class="action" hx-post="/accounts/unban" hx-target="#result" hx-swap="outerHTML">
  <label>account<input name="name" maxlength="16" required></label>
  <label>reason<input name="reason" required></label>
  ${actionButton('Unban', reachable)}
</form>

<h2>Delete</h2>
<form class="action" hx-post="/accounts/delete" hx-target="#result" hx-swap="outerHTML">
  <label>account<input name="name" maxlength="16" required></label>
  <label>type the account name to confirm<input name="confirm" maxlength="16" required></label>
  ${actionButton('Delete permanently', reachable)}
</form>

<h2>All accounts</h2>
<table>
  <thead><tr><th>account</th><th>gm</th><th>online</th><th>last login</th><th>last ip</th><th>ip locked</th><th>muted</th><th>ban</th></tr></thead>
  <tbody>
${list}
  </tbody>
</table>`;
}
