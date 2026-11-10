import { escapeHtml } from '../layout.js';
import { creatureTypeName, creatureRankName } from '../../dbLookups/creatureTypes.js';

// The creature hover card every NPC name in the /db/npcs listview triggers
// via hx-get="/db/tooltip/creature/<entry>" hx-trigger="mouseenter once"
// (creatureList.js). Built from creature_template columns only (controller
// decision 1): name, subname beneath it when present, level range (one
// number when min equals max), rank, type and faction id - the tooltip does
// not join the reference schema, because a hover must stay at two queries.
//
// No loot, vendor, trainer or "Requires" wording: that data lives in tables
// this route never reads (controller decision 2, the defect cycle 3 shipped)
// and belongs on the detail page, which does read them.
export function renderCreatureTooltip(row) {
  const lines = [`<div>${escapeHtml(row.name)}</div>`];
  if (row.subname) lines.push(`<div class="detail">${escapeHtml(row.subname)}</div>`);

  const level = Number(row.level_min) === Number(row.level_max)
    ? escapeHtml(row.level_min)
    : `${escapeHtml(row.level_min)}-${escapeHtml(row.level_max)}`;
  lines.push(`<div>Level ${level}</div>`);

  lines.push(`<div>${escapeHtml(creatureRankName(row.rank))} ${escapeHtml(creatureTypeName(row.type))}</div>`);
  lines.push(`<div class="detail">Faction template ${escapeHtml(row.faction)}</div>`);

  return `<div class="tooltip">
  ${lines.join('\n  ')}
</div>`;
}
