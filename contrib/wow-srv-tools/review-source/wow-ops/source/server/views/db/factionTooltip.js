import { escapeHtml } from '../layout.js';

// Built from fetchFactionRow's single joined row (server/queries/db/factions.js):
// parent_name is the card's "side" (Ruling 4 / M2), the same self-join
// loadFaction's own parent lookup uses.
export function renderFactionTooltip(row) {
  const lines = [`<div>${escapeHtml(row.name)}</div>`];
  if (row.parent_name) lines.push(`<div class="detail">${escapeHtml(row.parent_name)}</div>`);
  if (row.description) lines.push(`<div class="detail">${escapeHtml(row.description)}</div>`);
  if (Number(row.reputation_list_id) < 0) lines.push('<div class="detail">Internal faction, no reputation</div>');
  return `<div class="tooltip">
  ${lines.join('\n  ')}
</div>`;
}
