import { escapeHtml } from '../layout.js';
import { gameObjectTypeName, namedSlotValue } from '../../dbLookups/gameObjectTypes.js';

// The gameobject hover card every name in the /db/objects listview triggers
// via hx-get="/db/tooltip/gameobject/<entry>" hx-trigger="mouseenter once"
// (gameobjectList.js). Built from gameobject_template columns only
// (controller decision 3): name, type, whether it is locked (the lock id
// from the slot this type keeps it in, namedSlotValue - the same rule
// gameobjectList.js's Locked column and the `locked` filter use) and the raw faction
// template id - the tooltip does not join the reference schema, because a
// hover must stay at two queries.
//
// No loot or quest wording: that data lives in gameobject_loot_template,
// gameobject_questrelation and gameobject_involvedrelation, tables this route
// never reads (the same rule creatureTooltip.js follows for loot, vendor,
// trainer and quest) and which belong on the detail page, which does read
// them.
export function renderGameObjectTooltip(row) {
  const lines = [`<div>${escapeHtml(row.name)}</div>`];
  lines.push(`<div>${escapeHtml(gameObjectTypeName(row.type))}</div>`);
  const lockId = namedSlotValue(row, 'lock id');
  if (lockId) lines.push(`<div>Locked (id ${escapeHtml(lockId)})</div>`);
  lines.push(`<div class="detail">Faction template ${escapeHtml(row.faction)}</div>`);

  return `<div class="tooltip">
  ${lines.join('\n  ')}
</div>`;
}
