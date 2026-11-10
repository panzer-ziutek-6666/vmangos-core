import { escapeHtml, pad2, renderResult, renderError } from './layout.js';

// Re-exported so server/sections/events.js takes its view helpers from one
// place, the way the other sections do.
export { renderResult, renderError };

// game_event.occurence and .length are minutes, not seconds: the core renders
// them with secsToTimeString(value * MINUTE) (vmangos-core/src/game/Commands/
// ServerCommands.cpp:713-714). Printing the raw number would read as seconds
// to anyone who has seen the rest of this panel.
function formatMinutes(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m < 0) return '—';
  if (m === 0) return '0m';

  const days = Math.floor(m / 1440);
  const hours = Math.floor(m / 60) % 24;
  const mins = m % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins) parts.push(`${mins}m`);
  return parts.join(' ');
}

// start_time and end_time are TIMESTAMP columns, and many rows hold
// '0000-00-00 00:00:00', which mysql2 returns as null - a hardcoded event has
// no scheduled window at all.
function formatTimestamp(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function actionButton(label, reachable) {
  if (reachable) return `<button type="submit">${escapeHtml(label)}</button>`;
  return `<button type="submit" disabled>${escapeHtml(label)}</button>`;
}

// A row's state has three values, not two. "inactive" is a fact about the
// event; "unknown" is a fact about the panel - the live list could not be read,
// so nothing is known about what is running. Collapsing them would let an
// unreachable mangosd render every event as inactive, which an operator could
// act on.
function stateCell(row) {
  if (!row.live) return '<span class="detail">unknown</span>';
  return row.active ? 'active' : 'inactive';
}

// A flag here says what the scheduler will do with the event, never whether it
// is running: GameEventMgr::StartEvent checks only IsValidEvent and ignores the
// disabled flag entirely (GameEventMgr.cpp:72-79), and the hardcoded driver
// events call it directly (HardcodedEvents.cpp:341-353 and its neighbours). On
// this realm, event 22 is both excluded by patch and active for exactly that
// reason. The state column is the authority; these are the reasons behind it.
function flagsCell(row, wowPatch) {
  const flags = [];
  if (row.disabled) flags.push('disabled');
  // Force-disabled in memory at load, with game_event.disabled left untouched
  // (GameEventMgr.cpp:239-240) - so this is invisible in the table's own data
  // and has to be derived from the configured running patch.
  if (row.excludedByPatch) flags.push(`excluded by patch ${escapeHtml(wowPatch)} (needs ${escapeHtml(row.patchMin)}-${escapeHtml(row.patchMax)})`);
  if (row.hardcoded) flags.push('hardcoded');
  return flags.length ? escapeHtml(flags.join(', ')) : '—';
}

function rowActions(row, reachable) {
  const hidden = `<input type="hidden" name="id" value="${escapeHtml(row.id)}">`;
  return ['info', 'start', 'stop'].map((action) => `<form class="inline" hx-post="/events/${action}" hx-target="#result" hx-swap="outerHTML">${hidden}${actionButton(action, reachable)}</form>`).join('\n      ');
}

export function renderEventsBody({ rows, liveError, result, reachable = true, wowPatch }) {
  const liveNote = liveError
    ? `<p class="error">The live event list could not be read, so no event's state is known: ${escapeHtml(liveError)}</p>`
    : '';

  const table = rows === null
    ? `<p class="error">Game events cannot be listed: the world database is not configured in config.json.</p>`
    : `<table>
  <thead><tr><th>id</th><th>event</th><th>state</th><th>flags</th><th>start</th><th>end</th><th>every</th><th>lasts</th><th>actions</th></tr></thead>
  <tbody>
${rows.map((r) => `    <tr>
      <td>${escapeHtml(r.id)}</td>
      <td>${escapeHtml(r.description)}</td>
      <td>${stateCell(r)}</td>
      <td>${flagsCell(r, wowPatch)}</td>
      <td>${escapeHtml(formatTimestamp(r.startTime))}</td>
      <td>${escapeHtml(formatTimestamp(r.endTime))}</td>
      <td>${escapeHtml(formatMinutes(r.occurrenceMinutes))}</td>
      <td>${escapeHtml(formatMinutes(r.lengthMinutes))}</td>
      <td>
      ${rowActions(r, reachable)}
      </td>
    </tr>`).join('\n')}
  </tbody>
</table>`;

  const count = rows === null ? '' : `<p class="detail">${rows.length} event${rows.length === 1 ? '' : 's'} in <code>game_event</code>. State comes from the running server; everything else comes from the world database.</p>
<p class="detail">A flag says what the scheduler will do with an event, not whether it is running. An event marked disabled or excluded by patch can still be active, because a hardcoded event can start another event directly without consulting either — that is why the state column, and not the flags, is the answer to "is this happening right now".</p>`;

  return `<h1>Game events</h1>
<p class="detail">Start and stop are temporary: they change only the running server's memory, a restart undoes them, and a started event ends by itself once its <em>lasts</em> duration has passed. Enable and disable are not — they persist.</p>
${liveNote}

${renderResult(result)}

${table}
${count}

<h2>Enable or disable permanently</h2>
<p class="detail">These write <code>game_event.disabled</code> in the world database through mangosd, so they survive a restart. Disabling an event also stops it if it is running, and a disabled event is never started by the scheduler.</p>
<form class="action" hx-post="/events/enable" hx-target="#result" hx-swap="outerHTML">
  <label>event id<input name="id" type="number" min="1" max="65535" required></label>
  <label>type the id again to confirm<input name="confirm" required></label>
  ${actionButton('Enable', reachable)}
</form>
<form class="action" hx-post="/events/disable" hx-target="#result" hx-swap="outerHTML">
  <label>event id<input name="id" type="number" min="1" max="65535" required></label>
  <label>type the id again to confirm<input name="confirm" required></label>
  ${actionButton('Disable', reachable)}
</form>
${reachable ? '' : '<p class="detail">mangosd is not reachable; commands are disabled.</p>'}`;
}
