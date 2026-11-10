import { escapeHtml, formatEpochSeconds, renderResult, renderError } from './layout.js';
import { ticketCategoryName, escalationName, describeClosedBy, TICKET_CATEGORY_FILTERS } from '../ticketTypes.js';

export { renderResult, renderError };

function actionButton(label, reachable, enabled = true) {
  if (reachable && enabled) return `<button type="submit">${escapeHtml(label)}</button>`;
  return `<button type="submit" disabled>${escapeHtml(label)}</button>`;
}

function form(action, inner) {
  return `<form class="action" hx-post="/tickets/${action}" hx-target="#result" hx-swap="outerHTML">
  ${inner}
</form>`;
}

function hiddenId(id) {
  return `<input type="hidden" name="id" value="${escapeHtml(id)}">`;
}

// A ticket's message is free player text of arbitrary length; the list shows
// enough to recognise it and the detail page shows all of it.
function truncate(text, limit = 80) {
  const value = String(text ?? '');
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

// closed_by is four states in one column (GMTicketMgr.h:167), and two of them -
// a console close and a ticket the player withdrew - would be invisible if the
// guid were printed raw.
function closedText(ticket) {
  const closed = describeClosedBy(ticket.closedBy, ticket.guid);
  switch (closed.state) {
    case 'open': return 'open';
    case 'console': return 'closed from a console';
    case 'abandoned': return 'the player withdrew it';
    default: return `closed by ${escapeHtml(ticket.closerName ?? `guid ${closed.guid}`)}`;
  }
}

function categoryOptions() {
  return ['<option value="">any category</option>']
    .concat(TICKET_CATEGORY_FILTERS.map((c) => `<option value="${c}">${escapeHtml(c)}</option>`))
    .join('\n    ');
}

// The commands that act on the whole system rather than on one ticket. They sit
// on the list page, away from the per-ticket forms, with what they do written
// beside them.
function realmWideBlock(reachable) {
  return `<h2>Lists from the server</h2>
<p class="detail">These ask mangosd for its own view of the tickets, which is useful when the panel and the server might disagree — the list above is read straight from the database.</p>
${form('list', `<label>category<select name="category">
    ${categoryOptions()}
  </select></label>
  ${actionButton('Open tickets', reachable)}`)}
${form('onlinelist', `<label>category<select name="category">
    ${categoryOptions()}
  </select></label>
  ${actionButton('Open tickets from online players', reachable)}`)}
${form('closedlist', `${actionButton('Closed tickets', reachable)}`)}
${form('escalatedlist', `${actionButton('Escalated tickets', reachable)}`)}

<h2>Whole-realm commands</h2>
${form('reset', `<label>type DELETE ALL TICKETS to confirm<input name="confirm" required></label>
  ${actionButton('Delete every ticket', reachable)}`)}
<p class="detail">Deletes every ticket and resets the id counter. The server refuses it while any ticket is still open.</p>
${form('togglesystem', `<label>type toggle to confirm<input name="confirm" required></label>
  ${actionButton('Toggle ticket filing', reachable)}`)}
<p class="detail">Turns ticket filing on or off for the whole realm. It is a toggle, so nothing here can say which way it will go, and it lives in memory only — a restart re-enables filing.</p>`;
}

export function renderTicketsBody({ rows, includeClosed, result, reachable = true }) {
  const toggle = includeClosed
    ? '<a href="/tickets">hide closed tickets</a>'
    : '<a href="/tickets?closed=1">show closed tickets</a>';

  let table;
  if (rows === null) {
    table = '<p class="error">Tickets cannot be listed: the characters or world database is not configured in config.json.</p>';
  } else if (rows.length === 0) {
    table = `<p>${includeClosed ? 'No tickets at all.' : 'No open tickets.'}</p>`;
  } else {
    table = `<table>
  <thead><tr><th>id</th><th>from</th><th>category</th><th>message</th><th>opened</th><th>assigned to</th><th>state</th></tr></thead>
  <tbody>
${rows.map((r) => `    <tr>
      <td><a href="/tickets/${escapeHtml(r.id)}">${escapeHtml(r.id)}</a></td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(ticketCategoryName(r.ticketType))}</td>
      <td>${escapeHtml(truncate(r.message))}</td>
      <td>${escapeHtml(formatEpochSeconds(r.createTime))}</td>
      <td>${escapeHtml(r.assignedToName ?? (r.assignedTo ? `guid ${r.assignedTo}` : '—'))}</td>
      <td>${closedText(r)}${r.completed ? ', completed' : ''}${r.viewed ? ', viewed' : ''}</td>
    </tr>`).join('\n')}
  </tbody>
</table>`;
  }

  return `<h1>Tickets</h1>
<p>${toggle}</p>

${renderResult(result)}

${table}

${realmWideBlock(reachable)}
${reachable ? '' : '<p class="detail">mangosd is not reachable; commands are disabled.</p>'}`;
}

export function renderTicketBody({ ticket, result, reachable = true }) {
  const t = ticket;
  const isClosed = describeClosedBy(t.closedBy, t.guid).state !== 'open';

  const facts = `<table class="facts">
  <tr><th>from</th><td><a href="/characters/${encodeURIComponent(t.name)}">${escapeHtml(t.name)}</a> <span class="detail">(guid ${escapeHtml(t.guid)})</span></td></tr>
  <tr><th>category</th><td>${escapeHtml(ticketCategoryName(t.ticketType))}</td></tr>
  <tr><th>opened</th><td>${escapeHtml(formatEpochSeconds(t.createTime))}</td></tr>
  <tr><th>last change</th><td>${escapeHtml(formatEpochSeconds(t.lastModifiedTime))}</td></tr>
  <tr><th>filed at</th><td>${escapeHtml(t.mapName ?? `map ${t.map}`)} <span class="detail">${t.positionX.toFixed(1)}, ${t.positionY.toFixed(1)}, ${t.positionZ.toFixed(1)}</span></td></tr>
  <tr><th>assigned to</th><td>${escapeHtml(t.assignedToName ?? (t.assignedTo ? `guid ${t.assignedTo}` : '—'))}</td></tr>
  <tr><th>escalation</th><td>${escapeHtml(escalationName(t.escalated))}</td></tr>
  <tr><th>seen by a GM</th><td>${t.viewed ? 'yes' : 'no'}</td></tr>
  <tr><th>completed</th><td>${t.completed ? 'yes' : 'no'}</td></tr>
  <tr><th>state</th><td>${closedText(t)}</td></tr>
</table>

<h2>Message</h2>
<pre class="output">${escapeHtml(t.message)}</pre>
<h2>GM comment</h2>
<pre class="output">${escapeHtml(t.comment || '(none)')}</pre>
<h2>Response to the player</h2>
<pre class="output">${escapeHtml(t.response || '(none)')}</pre>`;

  return `<h1>Ticket ${escapeHtml(t.id)}</h1>
<p><a href="/tickets">back to the ticket list</a></p>
${facts}

${renderResult(result)}

<h2>Server's own view</h2>
${form('view', `${hiddenId(t.id)}
  ${actionButton('Show this ticket as mangosd sees it', reachable)}`)}
${form('reload', `${hiddenId(t.id)}
  ${actionButton('Reload it from the database', reachable)}`)}
<p class="detail">Reload works once per ticket per server run. The core remembers which ids it has been asked to reload and never forgets them, so a second reload of the same ticket answers "added to reload list" and does nothing.</p>

<h2>Assign</h2>
${form('assign', `${hiddenId(t.id)}
  <label>GM character<input name="name" maxlength="12" required></label>
  ${actionButton('Assign', reachable)}`)}
<p class="detail">A character name is required: the command normally defaults to the GM who typed it, and the panel is not a character.</p>
${form('unassign', `${hiddenId(t.id)}
  ${actionButton('Unassign', reachable)}`)}

<h2>Comment</h2>
<p class="detail">A note for other GMs. The player never sees it.</p>
${form('comment', `${hiddenId(t.id)}
  <label>comment<input name="text" maxlength="255" required></label>
  ${actionButton('Set comment', reachable)}`)}

<h2>Response to the player</h2>
${form('append', `${hiddenId(t.id)}
  <label>text<input name="text" maxlength="255" required></label>
  ${actionButton('Append', reachable)}`)}
${form('appendln', `${hiddenId(t.id)}
  <label>text<input name="text" maxlength="255" required></label>
  ${actionButton('Append and end the line', reachable)}`)}
<p class="detail">Append adds the text where the response left off, with no separator. Append-and-end-the-line adds the text and then a line break, so it is the one to use for all but the last line of a multi-line reply.</p>
${form('responsereset', `${hiddenId(t.id)}
  ${actionButton('Clear the response', reachable)}`)}

<h2>Complete</h2>
${form('complete', `${hiddenId(t.id)}
  <label>closing response (optional)<input name="text" maxlength="255"></label>
  ${actionButton('Mark completed', reachable)}`)}
<p class="detail"><strong>Completing is a one-way door.</strong> It sends the response to the player and marks the ticket done — but a completed ticket can no longer be closed (the server calls it archived) and cannot be deleted either, because deleting requires it to be closed. It leaves the panel only when the player acknowledges the response in their client. Close it instead if you want it gone.</p>

<h2>Close</h2>
${form('close', `${hiddenId(t.id)}
  ${actionButton('Close', reachable)}`)}
<p class="detail">Closing from the panel is recorded as a console close rather than against a GM character, because a SOAP session has no character behind it.</p>

<h2>Delete</h2>
${form('delete', `${hiddenId(t.id)}
  <label>type the ticket id to confirm<input name="confirm" required></label>
  ${actionButton('Delete permanently', reachable, isClosed)}`)}
<p class="detail">${isClosed
    ? 'Removes the ticket row for good.'
    : t.completed
      ? 'This ticket is completed but not closed, and the server will not delete it: deleting needs a closed ticket, and closing a completed one is refused. Only the player acknowledging the response can close it now.'
      : 'The server refuses to delete an open ticket — close it first.'}</p>`;
}
