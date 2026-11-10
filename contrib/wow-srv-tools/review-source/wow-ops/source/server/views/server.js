import { escapeHtml, formatEpochSeconds, renderResult, renderError } from './layout.js';
import { SHUTDOWN_KINDS, PLIMIT_LEVELS } from '../commands/server.js';
import {
  REALM_TYPES, REALM_ZONES, REALM_FLAGS, realmTypeName, realmZoneName,
  realmCategoryForClassic, HIDDEN_FLAG_BIT, ALLOWED_FLAG_MASK
} from '../realmTypes.js';
import { GM_LEVELS } from '../gmLevels.js';


// Shared with the Accounts section; see server/views/layout.js.
export { renderResult, renderError };

function actionButton(label, reachable) {
  if (reachable) return `<button type="submit">${label}</button>`;
  return `<button type="submit" disabled>${label}</button>`;
}

function formatUptimeSeconds(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) return '—';
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function renderHistory(rows) {
  if (rows.length === 0) {
    return '<p class="detail">No runs recorded yet. mangosd writes a row to realmd.uptime when it starts.</p>';
  }
  const body = rows.map((r) => `    <tr>
      <td>${escapeHtml(formatEpochSeconds(r.starttime))}</td>
      <td>${escapeHtml(formatUptimeSeconds(r.uptime))}</td>
      <td>${escapeHtml(r.onlineplayers)}</td>
      <td>${escapeHtml(r.maxplayers)}</td>
      <td><code>${escapeHtml(r.revision)}</code></td>
    </tr>`).join('\n');
  return `<table>
  <thead><tr><th>started</th><th>ran for</th><th>players at exit</th><th>peak players</th><th>revision</th></tr></thead>
  <tbody>
${body}
  </tbody>
</table>
<p class="detail">Player counts here come from mangosd's own session count, so bot characters — which have no network session — are not included.</p>`;
}

function renderShutdownForm(kind, reachable) {
  const label = {
    shutdown: 'Shut down',
    restart: 'Restart',
    idleshutdown: 'Shut down when idle',
    idlerestart: 'Restart when idle'
  }[kind];
  const note = kind === 'restart' || kind === 'idlerestart'
    ? '<p class="detail">Exits with the restart code. Nothing in this panel relaunches mangosd — on this machine a restart is a shutdown unless a wrapper script is watching the exit code.</p>'
    : '';
  const idle = kind.startsWith('idle')
    ? '<p class="detail">Waits for the server to be empty before the countdown starts.</p>'
    : '';
  return `<form class="action" hx-post="/server/${kind}" hx-target="#result" hx-swap="outerHTML">
  <label>delay in seconds<input name="delay" value="300" required></label>
  <label>type ${kind} to confirm<input name="confirm" required></label>
  ${actionButton(label, reachable)}
</form>${idle}${note}`;
}

function typeOptions(selected) {
  return REALM_TYPES.map((t) =>
    `<option value="${t.icon}"${Number(selected) === t.icon ? ' selected' : ''}>${t.icon} ${escapeHtml(t.label)}</option>`
  ).join('\n      ');
}

function zoneOptions(selected) {
  return REALM_ZONES.map((z) =>
    `<option value="${z.id}"${Number(selected) === z.id ? ' selected' : ''}>${z.id} ${escapeHtml(z.name)}</option>`
  ).join('\n      ');
}

function securityOptions(selected) {
  return GM_LEVELS.map((l) =>
    `<option value="${l.level}"${Number(selected) === l.level ? ' selected' : ''}>${l.level} ${escapeHtml(l.name)}</option>`
  ).join('\n      ');
}

function flagBoxes(mask) {
  const value = Number(mask) || 0;
  const boxes = REALM_FLAGS.map((f) =>
    `<label class="check"><input type="checkbox" name="flags" value="${f.bit}"${(value & f.bit) ? ' checked' : ''}> ${escapeHtml(f.name)} <span class="detail">${escapeHtml(f.note)}</span></label>`
  ).join('\n      ');
  const hidden = `<label class="check"><input type="checkbox" name="hidden"${(value & HIDDEN_FLAG_BIT) ? ' checked' : ''}> hidden <span class="detail">realmd skips the row entirely, so the realm disappears from the client's list</span></label>`;
  return `<fieldset>\n      ${boxes}\n      ${hidden}\n    </fieldset>`;
}

function realmFormFields(row) {
  return `<label>name<input name="name" maxlength="32" value="${escapeHtml(row.name ?? '')}" required></label>
    <label>address<input name="address" maxlength="32" value="${escapeHtml(row.address ?? '127.0.0.1')}" required></label>
    <label>local address<input name="localAddress" maxlength="255" value="${escapeHtml(row.localAddress ?? '127.0.0.1')}" required></label>
    <label>local subnet mask<input name="localSubnetMask" maxlength="15" value="${escapeHtml(row.localSubnetMask ?? '255.255.255.0')}" required></label>
    <label>port<input name="port" value="${escapeHtml(row.port ?? 8085)}" required></label>
    <label>type<select name="icon">
      ${typeOptions(row.icon ?? 0)}
    </select></label>
    <label>zone<select name="timezone">
      ${zoneOptions(row.timezone ?? 8)}
    </select></label>
    <label>minimum security level<select name="allowedSecurityLevel">
      ${securityOptions(row.allowedSecurityLevel ?? 0)}
    </select></label>
    <label>realmbuilds<input name="realmbuilds" maxlength="64" value="${escapeHtml(row.realmbuilds ?? '')}"></label>
    ${flagBoxes(row.realmflags ?? 0)}`;
}

function realmRow(row, realmId) {
  const isPanelRealm = Number(row.id) === Number(realmId);
  const warning = isPanelRealm
    ? '<p class="detail">This is the realm this panel is configured for (realm.id in config.json).</p>'
    : '';
  // A row can carry flag bits the panel does not offer, because realmd keeps
  // only four of them and strips the rest on its next poll. The form has no
  // checkbox for those, so saving this realm clears them - which is what
  // realmd would do anyway, but it should not happen without saying so.
  const unknownFlags = (Number(row.realmflags) || 0) & ~(ALLOWED_FLAG_MASK | HIDDEN_FLAG_BIT);
  const flagNote = unknownFlags
    ? `<p class="detail">This row also carries flag bits 0x${unknownFlags.toString(16)}, which realmd does not keep and this form cannot set. Saving the realm clears them.</p>`
    : '';
  return `<details class="realm">
  <summary>${escapeHtml(row.id)} — ${escapeHtml(row.name)} — ${escapeHtml(row.address)}:${escapeHtml(row.port)} — ${escapeHtml(realmTypeName(row.icon))} — ${escapeHtml(realmZoneName(row.timezone))} (tab ${escapeHtml(realmCategoryForClassic(row.timezone))})</summary>
  ${warning}${flagNote}
  <form class="action" hx-post="/realms/${escapeHtml(row.id)}/update" hx-target="#realms" hx-swap="outerHTML">
    ${realmFormFields(row)}
    <button type="submit">Save</button>
  </form>
  <form class="action" hx-post="/realms/${escapeHtml(row.id)}/delete" hx-target="#realms" hx-swap="outerHTML">
    <label>type the realm name to confirm<input name="confirm" maxlength="32" required></label>
    <button type="submit">Delete this realm</button>
  </form>
</details>`;
}

export function renderRealmsPanel({ realms = [], realmId = 1, result = null } = {}) {
  const banner = result
    ? (result.ok
      ? `<p class="output">${escapeHtml(result.message)}</p>`
      : `<p class="error">${escapeHtml(result.message)}</p>`)
    : '';
  const list = realms.length > 0
    ? realms.map((r) => realmRow(r, realmId)).join('\n')
    : '<p class="detail">No realms are registered. The client cannot see this server until a row exists here.</p>';

  return `<div id="realms">
${banner}
<p class="detail">realmd re-reads this table on its own timer, so a change here takes effect without restarting anything. Adding a row only advertises a realm — it does not start a server, and a row pointing at an address where no mangosd is listening will simply fail to connect.</p>
${list}

<h3>Add a realm</h3>
<form class="action" hx-post="/realms/create" hx-target="#realms" hx-swap="outerHTML">
  ${realmFormFields({})}
  <button type="submit">Add</button>
</form>
</div>`;
}

export function renderServerBody({ uptimeRows = [], realms = [], realmId = 1, result = null, reachable = true } = {}) {
  // Only the SOAP half is disabled while mangosd is down. The realm
  // registry writes SQL that realmd picks up on its own, so it keeps
  // working - and that is exactly when a realm row usually needs fixing.
  const offline = reachable ? '' : '<p class="detail">mangosd is not reachable, so the commands on this page are disabled. The realm registry below still works: it writes to the database, which realmd reads on its own.</p>';

  return `<h1>Server</h1>

${renderResult(result)}
${offline}

<h2>Message of the day</h2>
<form class="action" hx-post="/server/motd" hx-target="#result" hx-swap="outerHTML">
  ${actionButton('Show current MOTD', reachable)}
</form>
<form class="action" hx-post="/server/setmotd" hx-target="#result" hx-swap="outerHTML">
  <label>new MOTD<input name="text" maxlength="255" required></label>
  ${actionButton('Set', reachable)}
</form>
<p class="detail">A MOTD set here lives in memory only. mangosd rebuilds it from the <code>Motd</code> setting in mangosd.conf at every start, so this change is lost on the next restart.</p>

<h2>Broadcast</h2>
<form class="action" hx-post="/server/announce" hx-target="#result" hx-swap="outerHTML">
  <label>chat announcement<input name="text" maxlength="255" required></label>
  ${actionButton('Announce', reachable)}
</form>
<form class="action" hx-post="/server/notify" hx-target="#result" hx-swap="outerHTML">
  <label>on-screen notification<input name="text" maxlength="255" required></label>
  ${actionButton('Notify', reachable)}
</form>

<h2>Maintenance</h2>
<form class="action" hx-post="/server/saveall" hx-target="#result" hx-swap="outerHTML">
  ${actionButton('Save all players', reachable)}
</form>
<p class="detail">Flushes every online player to the database at once, which is also the way to make the Bots section's location breakdown current instead of up to 15 minutes stale.</p>
<form class="action" hx-post="/server/corpses" hx-target="#result" hx-swap="outerHTML">
  ${actionButton('Expire old corpses', reachable)}
</form>
<form class="action" hx-post="/server/plimit" hx-target="#result" hx-swap="outerHTML">
  <label>player limit<input name="value" value="reset" required></label>
  ${actionButton('Set limit', reachable)}
</form>
<p class="detail">A number caps how many may be online. One of ${PLIMIT_LEVELS.map((l) => `<code>${escapeHtml(l)}</code>`).join(', ')} sets the minimum security level instead — and doing that immediately kicks everyone below it, bot characters included. <code>reset</code> restores the configured limit.</p>
<form class="action" hx-post="/server/resetallraids" hx-target="#result" hx-swap="outerHTML">
  <label>type resetallraids to confirm<input name="confirm" required></label>
  ${actionButton('Reset all raid instances', reachable)}
</form>
<p class="detail">Resets every raid instance on the realm and teleports the players inside them to their homebind.</p>

<h2>Shutdown</h2>
${SHUTDOWN_KINDS.map((kind) => renderShutdownForm(kind, reachable)).join('\n')}
<form class="action" hx-post="/server/cancel" hx-target="#result" hx-swap="outerHTML">
  ${actionButton('Cancel a pending shutdown or restart', reachable)}
</form>
<p class="detail">One cancel covers all four: they share a single handler in the core.</p>

<h2>Realm registry</h2>
${renderRealmsPanel({ realms, realmId })}

<h2>Run history</h2>
${renderHistory(uptimeRows)}`;
}
