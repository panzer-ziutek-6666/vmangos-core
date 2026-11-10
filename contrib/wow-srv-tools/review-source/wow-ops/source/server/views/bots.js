import { escapeHtml, formatEpochSeconds } from './layout.js';
import { mapBucket, BUCKET_LABELS, BUCKET_ORDER } from '../mapTypes.js';

// Each panel's datum arrives in one of three states: a value, null (the
// panel's database is not configured), or { error } (the query threw). The
// section catches per panel rather than letting one dead database take the
// whole page down through app.js's error handler.
function isError(value) {
  return value !== null && typeof value === 'object' && typeof value.error === 'string';
}

function note(text) {
  return `<p class="detail">${escapeHtml(text)}</p>`;
}

function errorNote(value) {
  return `<p class="error">${escapeHtml(value.error)}</p>`;
}

function figure(label, value, unavailable) {
  const shown = isError(value) || value === null ? '—' : value;
  const title = value === null ? ` title="${escapeHtml(unavailable)}"` : '';
  return `<span class="cell"${title}><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(shown)}</span></span>`;
}

function renderPopulation({ accounts, online }) {
  const errors = [accounts, online].filter(isError).map(errorNote).join('\n  ');
  return `<section class="panel">
  <h2>Population</h2>
  <div class="figures">
    ${figure('bot accounts', accounts, 'The logon database is not configured.')}
    ${figure('bot characters online', online, 'The characters database is not configured.')}
  </div>
  ${note('These are different quantities and are never summed: a module bot is a Player object without a network session, so one account drives several bots at once. Real player numbers are in the status strip above; they come from .server info, which counts sessions and therefore never counts a bot.')}
  ${errors}
</section>`;
}

// mangosd.conf's own default for PlayerSave.Interval - see config.js. Used
// here only as a fallback for a config object that omits the value entirely
// (loadConfig always supplies it in production), so the sentence below stays
// truthful instead of printing "up to NaN minutes behind".
const DEFAULT_PLAYER_SAVE_INTERVAL_MS = 900000;

function renderBreakdown({ locations, playerSaveIntervalMs }) {
  const intervalMs = Number.isFinite(playerSaveIntervalMs) ? playerSaveIntervalMs : DEFAULT_PLAYER_SAVE_INTERVAL_MS;
  // Rounding a sub-30s interval down to 0 would print "up to 0 minutes
  // behind" - read as "not stale at all", the opposite of what this sentence
  // exists to say. Floor at 1 instead, and get the singular right at exactly
  // 1 minute.
  const minutes = Math.max(1, Math.round(intervalMs / 60000));
  const unit = minutes === 1 ? 'minute' : 'minutes';
  const stamp = note(`As of last save: mangosd writes a character's map and position only on the player-save timer, so this breakdown can be up to ${minutes} ${unit} behind. The counts in the panel above are not - they move at login and logout.`);

  if (isError(locations)) {
    return `<section class="panel">
  <h2>Where they are</h2>
  ${errorNote(locations)}
</section>`;
  }
  if (locations === null) {
    return `<section class="panel">
  <h2>Where they are</h2>
  ${note('Unavailable: the characters database or the world database is not configured. The breakdown needs both - the characters database for the rows and the world database for readable map names.')}
</section>`;
  }
  if (locations.length === 0) {
    return `<section class="panel">
  <h2>Where they are</h2>
  ${note('No bot characters are online.')}
  ${stamp}
</section>`;
  }

  const groups = new Map(BUCKET_ORDER.map((b) => [b, []]));
  for (const row of locations) {
    groups.get(mapBucket(row.mapType)).push(row);
  }

  const blocks = BUCKET_ORDER
    .filter((bucket) => groups.get(bucket).length > 0)
    .map((bucket) => {
      const rows = groups.get(bucket);
      const total = rows.reduce((sum, r) => sum + r.bots, 0);
      const body = rows.map((r) => {
        // A map with no map_template row shows its raw id rather than being
        // dropped, so the totals still add up.
        const name = r.mapName ?? `map ${r.mapId}`;
        return `      <tr><td>${escapeHtml(name)}</td><td>${escapeHtml(r.mapId)}</td><td>${escapeHtml(r.bots)}</td></tr>`;
      }).join('\n');
      return `  <h3>${escapeHtml(BUCKET_LABELS[bucket])} <span class="detail">(${escapeHtml(total)})</span></h3>
  <table>
    <thead><tr><th>map</th><th>id</th><th>bots</th></tr></thead>
    <tbody>
${body}
    </tbody>
  </table>`;
    }).join('\n');

  return `<section class="panel">
  <h2>Where they are</h2>
${blocks}
  ${stamp}
</section>`;
}

function renderSuspended({ suspended }) {
  if (isError(suspended)) {
    return `<section class="panel">
  <h2>Suspended bot accounts</h2>
  ${errorNote(suspended)}
</section>`;
  }
  if (suspended === null) {
    return `<section class="panel">
  <h2>Suspended bot accounts</h2>
  ${note('Unavailable: the logon database is not configured.')}
</section>`;
  }
  if (suspended.length === 0) {
    return `<section class="panel">
  <h2>Suspended bot accounts</h2>
  ${note('No bot accounts are suspended. This figure is exact, not a snapshot - it comes straight from account_banned.')}
</section>`;
  }

  const rows = suspended.map((r) => {
    const until = r.permanent ? 'permanent' : `until ${escapeHtml(formatEpochSeconds(r.unbandate))}`;
    return `    <tr><td>${escapeHtml(r.username)}</td><td>${escapeHtml(formatEpochSeconds(r.bandate))}</td><td>${until}</td><td>${escapeHtml(r.bannedby)}</td><td>${escapeHtml(r.banreason)}</td></tr>`;
  }).join('\n');

  return `<section class="panel">
  <h2>Suspended bot accounts</h2>
  <table>
    <thead><tr><th>account</th><th>banned</th><th>expires</th><th>by</th><th>reason</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</section>`;
}

// Written out rather than hidden, because buttons that report success and
// change nothing are worse than no buttons. The full accounting, with the
// core line numbers, is in the design spec under "Why this section ships with
// no controls".
function renderNoControls() {
  return `<section class="panel">
  <h2>Controls</h2>
  ${note('This section has no controls. The .bot commands drive the core\'s native PlayerBotMgr, which this realm does not run - .bot stop would report success and leave every bot running. The module that does run the bots exposes one command that would work without a session, but it was never registered in the core\'s command table, so nothing here can reach it. Adding real controls needs a core change first; it is written up in the design spec.')}
</section>`;
}

export function renderBotsBody({ accounts, online, locations, suspended, playerSaveIntervalMs }) {
  return `<h1>Bots</h1>
${renderPopulation({ accounts, online })}
${renderBreakdown({ locations, playerSaveIntervalMs })}
${renderSuspended({ suspended })}
${renderNoControls()}`;
}
