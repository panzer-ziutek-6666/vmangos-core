import { escapeHtml, formatEpochSeconds, renderResult, renderError } from './layout.js';
import { raceName, className, genderName, RACE_MASK_NAMES } from '../playerTypes.js';
import { gmLevelName } from '../gmLevels.js';

// Re-exported so server/sections/characters.js keeps importing its view
// helpers from one place, the way server/views/accounts.js does.
export { renderResult, renderError };

// characters.map, .zone and .position_* only move on the PlayerSave.Interval
// timer (900000 ms, mangosd.conf:404), unlike characters.online, which is
// written at login and logout. Every place this panel prints a location says
// so, because a bot or player who moved a minute ago still shows the old one.
const SAVE_CAVEAT = 'Location is as of the character\'s last save (PlayerSave.Interval, 15 minutes), not live. Online is accurate to the second.';

// Vanilla money is copper; 100 copper to a silver, 100 silver to a gold.
function formatMoney(copper) {
  const c = Number(copper);
  if (!Number.isFinite(c)) return '—';
  return `${Math.floor(c / 10000)}g ${Math.floor(c / 100) % 100}s ${c % 100}c`;
}

function formatPlayedTime(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return '—';
  const days = Math.floor(s / 86400);
  const hours = Math.floor(s / 3600) % 24;
  const minutes = Math.floor(s / 60) % 60;
  return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
}

function formatPlace(mapId, mapName, zoneId, zoneName) {
  const zone = zoneName ? escapeHtml(zoneName) : `zone ${escapeHtml(zoneId)}`;
  const map = mapName ? escapeHtml(mapName) : `map ${escapeHtml(mapId)}`;
  return `${zone} <span class="detail">(${map})</span>`;
}

function actionButton(label, reachable) {
  if (reachable) return `<button type="submit">${escapeHtml(label)}</button>`;
  return `<button type="submit" disabled>${escapeHtml(label)}</button>\n  <p class="detail">mangosd is not reachable; commands are disabled.</p>`;
}

// The four commands that resolve their target with the two-argument
// ExtractPlayerTarget - .kick (AccountCommands.cpp:492), .repairitems
// (CharacterCommands.cpp:5701), .send message (MiscCommands.cpp:1180) and
// .character reputation (CharacterCommands.cpp:1958) - find only a player who
// is in the world. Offering them for an offline character would offer an
// action that can only answer "Player not found".
function onlineOnlyButton(label, reachable, online) {
  if (!reachable) return actionButton(label, reachable);
  if (online) return `<button type="submit">${escapeHtml(label)}</button>`;
  return `<button type="submit" disabled>${escapeHtml(label)}</button>\n  <p class="detail">This only works while the character is online.</p>`;
}

function hiddenName(name) {
  return `<input type="hidden" name="name" value="${escapeHtml(name)}">`;
}

function form(action, inner) {
  return `<form class="action" hx-post="/characters/${action}" hx-target="#result" hx-swap="outerHTML">
  ${inner}
</form>`;
}

export function renderCharactersBody({ rows, search, includeBots, result, reachable = true }) {
  const toggle = includeBots
    ? `<a href="/characters${search ? `?search=${encodeURIComponent(search)}` : ''}">hide bot characters</a>`
    : `<a href="/characters?bots=1${search ? `&search=${encodeURIComponent(search)}` : ''}">show bot characters</a>`;

  // The bot state rides along as a hidden field: searching must not silently
  // drop the toggle the operator just set, and vice versa.
  const searchForm = `<form class="search" method="get" action="/characters">
  <label>name starts with<input name="search" value="${escapeHtml(search)}" maxlength="12"></label>
  ${includeBots ? '<input type="hidden" name="bots" value="1">' : ''}
  <button type="submit">Search</button>
</form>`;

  const table = rows === null
    ? `<p class="error">Characters cannot be listed: the characters, logon or world database is not configured in config.json.</p>`
    : `<table>
  <thead><tr><th>name</th><th>level</th><th>race</th><th>class</th><th>gender</th><th>account</th><th>online</th><th>where (last save)</th></tr></thead>
  <tbody>
${rows.map((r) => `    <tr>
      <td><a href="/characters/${encodeURIComponent(r.name)}">${escapeHtml(r.name)}</a></td>
      <td>${escapeHtml(r.level)}</td>
      <td>${escapeHtml(raceName(r.race))}</td>
      <td>${escapeHtml(className(r.cls))}</td>
      <td>${escapeHtml(genderName(r.gender))}</td>
      <td>${escapeHtml(r.accountName)}</td>
      <td>${r.online ? 'yes' : 'no'}</td>
      <td>${formatPlace(r.mapId, r.mapName, r.zoneId, r.zoneName)}</td>
    </tr>`).join('\n')}
  </tbody>
</table>`;

  const count = rows === null ? '' : `<p class="detail">${rows.length} character${rows.length === 1 ? '' : 's'} shown; the list is capped at 100. Narrow it with the search box.</p>`;

  return `<h1>Characters</h1>
${searchForm}
<p>${toggle} · <a href="/characters/deleted">deleted characters</a></p>
<p class="detail">${escapeHtml(SAVE_CAVEAT)}</p>

${renderResult(result)}

${table}
${count}`;
}

export function renderCharacterBody({ character, result, reachable = true }) {
  const c = character;
  const online = c.online;

  const facts = `<table class="facts">
  <tr><th>guid</th><td>${escapeHtml(c.guid)}</td></tr>
  <tr><th>account</th><td><a href="/accounts">${escapeHtml(c.accountName)}</a> (${escapeHtml(c.accountGmLevel)} ${escapeHtml(gmLevelName(c.accountGmLevel))})</td></tr>
  <tr><th>level</th><td>${escapeHtml(c.level)}</td></tr>
  <tr><th>race, class, gender</th><td>${escapeHtml(raceName(c.race))} ${escapeHtml(className(c.cls))}, ${escapeHtml(genderName(c.gender))}</td></tr>
  <tr><th>money</th><td>${escapeHtml(formatMoney(c.money))}</td></tr>
  <tr><th>played</th><td>${escapeHtml(formatPlayedTime(c.playedTimeTotal))}</td></tr>
  <tr><th>created</th><td>${escapeHtml(formatEpochSeconds(c.createTime))}</td></tr>
  <tr><th>online</th><td>${online ? 'yes' : `no, last logout ${escapeHtml(formatEpochSeconds(c.logoutTime))}`}</td></tr>
  <tr><th>where (last save)</th><td>${formatPlace(c.mapId, c.mapName, c.zoneId, c.zoneName)} <span class="detail">${c.positionX.toFixed(1)}, ${c.positionY.toFixed(1)}, ${c.positionZ.toFixed(1)}</span></td></tr>
  <tr><th>rename pending</th><td>${c.renameFlagged ? 'yes, at next login' : 'no'}</td></tr>
  <tr><th>account muted</th><td>${c.accountMuteTime > 0 ? `until ${escapeHtml(formatEpochSeconds(c.accountMuteTime))}` : 'no'}</td></tr>
  <tr><th>account ban</th><td>${c.banActive ? `${c.banPermanent ? 'permanent' : `until ${escapeHtml(formatEpochSeconds(c.banUnbandate))}`}: ${escapeHtml(c.banReason)}` : '—'}</td></tr>
</table>`;

  const name = c.name;

  return `<h1>${escapeHtml(name)}</h1>
<p><a href="/characters">back to the character list</a></p>
${facts}
<p class="detail">${escapeHtml(SAVE_CAVEAT)}</p>

${renderResult(result)}

<h2>Flag for rename</h2>
${form('rename', `${hiddenName(name)}
  ${actionButton('Flag for rename', reachable)}`)}
<p class="detail">This does not rename the character. It sets the rename flag, and the player chooses a new name at their next login.</p>

<h2>Level</h2>
${form('level', `${hiddenName(name)}
  <label>level<input name="level" type="number" min="1" max="60" value="${escapeHtml(c.level)}" required></label>
  ${actionButton('Set level', reachable)}`)}

<h2>Revive</h2>
${form('revive', `${hiddenName(name)}
  ${actionButton('Revive', reachable)}`)}
<p class="detail">An offline character is resurrected at their next login instead.</p>

<h2>Repair items</h2>
${form('repairitems', `${hiddenName(name)}
  ${onlineOnlyButton('Repair all items', reachable, online)}`)}

<h2>Kick</h2>
${form('kick', `${hiddenName(name)}
  ${onlineOnlyButton('Kick from the world', reachable, online)}`)}

<h2>Message</h2>
${form('message', `${hiddenName(name)}
  <label>text<input name="text" maxlength="255" required></label>
  ${onlineOnlyButton('Send message', reachable, online)}`)}
<p class="detail">Appears on screen as a message from an administrator. It is not mail and is not saved.</p>

<h2>Reputation</h2>
${form('reputation', `${hiddenName(name)}
  ${onlineOnlyButton('Show reputation', reachable, online)}`)}

<h2>Has item</h2>
${form('hasitem', `${hiddenName(name)}
  <label>item id<input name="itemId" type="number" min="1" required></label>
  ${actionButton('Count item', reachable)}`)}

<h2>Mute</h2>
${form('mute', `${hiddenName(name)}
  <label>minutes<input name="minutes" type="number" min="1" value="30" required></label>
  <label>reason<input name="reason" required></label>
  ${actionButton('Mute', reachable)}`)}
<p class="detail">Mute is measured in whole minutes, and it mutes the owning account. The ban below takes a different format.</p>

<h2>Unmute</h2>
${form('unmute', `${hiddenName(name)}
  ${actionButton('Unmute', reachable)}`)}

<h2>Ban</h2>
${form('ban', `${hiddenName(name)}
  <label>duration<input name="duration" placeholder="30d, 12h, 1d12h, permanent" required></label>
  <label>reason<input name="reason" required></label>
  ${actionButton('Ban', reachable)}`)}
<p class="detail">This bans the owning account (${escapeHtml(c.accountName)}), found through this character. The server applies it in the background and returns no output, so an empty result here means it was accepted, not that it failed.</p>

<h2>Unban</h2>
${form('unban', `${hiddenName(name)}
  <label>reason<input name="reason" required></label>
  ${actionButton('Unban', reachable)}`)}

<h2>Send mail</h2>
${form('mail', `${hiddenName(name)}
  <label>subject<input name="subject" maxlength="255" required></label>
  <label>body<input name="body" maxlength="255" required></label>
  ${actionButton('Send mail', reachable)}`)}

<h2>Send an item</h2>
${form('items', `${hiddenName(name)}
  <label>subject<input name="subject" maxlength="255" required></label>
  <label>body<input name="body" maxlength="255" required></label>
  <label>item id<input name="itemId" type="number" min="1" required></label>
  <label>count<input name="count" type="number" min="1" value="1" required></label>
  ${actionButton('Send item', reachable)}`)}
<p class="detail">One item stack per mail, and a count above the item's own stack size is refused by the server.</p>

<h2>Send money</h2>
${form('money', `${hiddenName(name)}
  <label>subject<input name="subject" maxlength="255" required></label>
  <label>body<input name="body" maxlength="255" required></label>
  <label>copper<input name="copper" type="number" min="1" required></label>
  ${actionButton('Send money', reachable)}`)}
<p class="detail">In copper: 10000 copper is 1 gold.</p>

<h2>Send to every character of a race</h2>
${form('massmail', `<label>race<select name="raceMask">
    ${RACE_MASK_NAMES.map((n) => `<option value="${n}">${escapeHtml(n)}</option>`).join('\n    ')}
  </select></label>
  <label>subject<input name="subject" maxlength="255" required></label>
  <label>body<input name="body" maxlength="255" required></label>
  <label>type the race back to confirm<input name="confirm" required></label>
  ${actionButton('Send mail to all', reachable)}`)}
<p class="detail">This reaches every character of that race on the realm, bots included.</p>

<h2>Erase permanently</h2>
${form('erase', `${hiddenName(name)}
  <label>type the character name to confirm<input name="confirm" maxlength="12" required></label>
  ${actionButton('Erase permanently', reachable)}`)}
<p class="detail">The character and everything it owns are deleted outright, whatever CharDelete.Method says. This cannot be undone.</p>`;
}

export function renderDeletedBody({ rows, search, result, reachable = true, charDeleteMethod }) {
  // CharDelete.Method = 0 destroys the character row outright, so deleted_name
  // is never written and this page has nothing to list on this realm
  // (mangosd.conf:3134). Saying so is the difference between a page that
  // looks broken and a page that reports a configuration fact.
  const methodNote = charDeleteMethod === 0
    ? `<p class="detail">This realm runs <code>CharDelete.Method = 0</code>: a deleted character is completely removed from the database, so nothing is ever recorded here. Set it to 1 in mangosd.conf, and record that in <code>characters.charDeleteMethod</code>, to keep deleted characters recoverable.</p>`
    : '';

  const table = rows === null
    ? `<p class="error">Deleted characters cannot be listed: the characters database is not configured in config.json.</p>`
    : `<table>
  <thead><tr><th>guid</th><th>name</th><th>account id</th><th>deleted</th></tr></thead>
  <tbody>
${rows.map((r) => `    <tr>
      <td>${escapeHtml(r.guid)}</td>
      <td>${escapeHtml(r.deletedName)}</td>
      <td>${escapeHtml(r.deletedAccount)}</td>
      <td>${escapeHtml(formatEpochSeconds(r.deletedTime))}</td>
    </tr>`).join('\n')}
  </tbody>
</table>`;

  return `<h1>Deleted characters</h1>
<p><a href="/characters">back to the character list</a></p>
${methodNote}

<form class="search" method="get" action="/characters/deleted">
  <label>name starts with<input name="search" value="${escapeHtml(search)}" maxlength="12"></label>
  <button type="submit">Search</button>
</form>

${renderResult(result)}

${table}
<p class="detail">The list shows at most fifty rows, the same limit the server applies to its own search.</p>

<h2>Restore</h2>
${form('deletedrestore', `<label>name starts with<input name="search" value="${escapeHtml(search)}" maxlength="12" required></label>
  <label>type the search text back to confirm<input name="confirm" maxlength="12" required></label>
  ${actionButton('Restore every match', reachable)}`)}

<h2>Delete permanently</h2>
${form('deleteddelete', `<label>name starts with<input name="search" value="${escapeHtml(search)}" maxlength="12" required></label>
  <label>type the search text back to confirm<input name="confirm" maxlength="12" required></label>
  ${actionButton('Delete every match', reachable)}`)}
<p class="detail">Restore and delete both act on every match of the prefix search above, not on one character - the list is the exact set they will touch.</p>

<h2>Purge by age</h2>
${form('deletedold', `<label>keep days<input name="keepDays" type="number" min="0" value="30" required></label>
  <label>confirm (only needed for 0 days)<input name="confirm" maxlength="3"></label>
  ${actionButton('Delete everything older', reachable)}`)}
<p class="detail">Permanently deletes every deleted character older than that many days. Zero deletes all of them, so zero has to be typed into the confirm box as well.</p>`;
}
