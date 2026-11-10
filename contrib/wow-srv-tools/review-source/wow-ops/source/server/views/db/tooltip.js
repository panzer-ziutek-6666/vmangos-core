import { escapeHtml } from '../layout.js';
import { qualityClass, RESISTANCE_COLUMNS } from './fields.js';
import { itemSubclassName, inventoryTypeName, bondingName, itemStatName } from '../../dbLookups/itemClasses.js';

// item_template's stat array, stat_type1..10 paired with stat_value1..10
// (ItemPrototype.h) - same slots server/views/db/item.js's renderStats reads,
// duplicated here rather than imported because that one renders a <ul> for
// the full item page and this one renders bare lines for a hover card. A
// slot with value 0 carries no stat regardless of stat_type, so it is
// skipped - an empty row is worse than no row (controller decision 2).
function statLines(row) {
  const lines = [];
  for (let i = 1; i <= 10; i++) {
    const value = Number(row[`stat_value${i}`]);
    if (!value) continue;
    lines.push(`<div>+${escapeHtml(value)} ${escapeHtml(itemStatName(row[`stat_type${i}`]))}</div>`);
  }
  return lines;
}

// RESISTANCE_COLUMNS is fields.js's (shared with item.js, which renders the
// same six columns as a full <li> list rather than these bare <div> lines).
// Armor is not one of these (shown separately below); a zero value means the
// item grants nothing in that school, true of most items, so it is skipped.
function resistanceLines(row) {
  return RESISTANCE_COLUMNS
    .map(([col, label]) => [label, Number(row[col])])
    .filter(([, value]) => value)
    .map(([label, value]) => `<div>${escapeHtml(label)} Resistance +${escapeHtml(value)}</div>`);
}

// dmg_min1..5 / dmg_max1..5 - a weapon's damage roll(s). A slot with both
// min and max at 0 is empty. The school (dmg_type) is skipped here: it only
// ever differs from Physical on a handful of elemental weapons, and the
// item page (item.js) already states it in full for anyone who needs it.
function damageLines(row) {
  const lines = [];
  for (let i = 1; i <= 5; i++) {
    const min = Number(row[`dmg_min${i}`]);
    const max = Number(row[`dmg_max${i}`]);
    if (!min && !max) continue;
    lines.push(`<div>${escapeHtml(min)} - ${escapeHtml(max)} Damage</div>`);
  }
  return lines;
}

// The item hover card every item link on this branch triggers via
// hx-get="/db/tooltip/item/<entry>" hx-trigger="mouseenter once"
// (itemList.js). Built from item_template columns only, in the client's own
// order (task brief step 3): name, item level, binding, slot and subclass,
// damage and speed, armour and block, stats, resistances, durability,
// requirements, sell price.
//
// Quality colours are the client's own:
// vmangos-core/src/game/SharedDefines.h:205 (ItemQualityColors) - shared
// with the listview through qualityClass (fields.js) rather than a second
// copy here.
//
// No Use:/Equip: text: turning a spell id into the sentence the client
// shows needs the spell machinery a later cycle builds (cycle 5) - the item
// page (task 8) lists spellid_1..5 and their triggers plainly instead.
export function renderItemTooltip(row) {
  const lines = [
    `<div class="${qualityClass(row.quality)}">${escapeHtml(row.name)}</div>`,
    `<div>Item Level ${escapeHtml(row.item_level)}</div>`
  ];

  if (Number(row.bonding)) lines.push(`<div>${escapeHtml(bondingName(row.bonding))}</div>`);

  lines.push(`<div>${escapeHtml(inventoryTypeName(row.inventory_type))} ${escapeHtml(itemSubclassName(row.class, row.subclass))}</div>`);

  lines.push(...damageLines(row));
  if (Number(row.delay)) lines.push(`<div>Speed ${(Number(row.delay) / 1000).toFixed(2)}</div>`);

  if (Number(row.armor)) lines.push(`<div>${escapeHtml(row.armor)} Armor</div>`);
  if (Number(row.block)) lines.push(`<div>${escapeHtml(row.block)} Block</div>`);

  lines.push(...statLines(row));
  lines.push(...resistanceLines(row));

  if (Number(row.max_durability)) {
    lines.push(`<div>Durability ${escapeHtml(row.max_durability)} / ${escapeHtml(row.max_durability)}</div>`);
  }
  if (Number(row.required_level)) lines.push(`<div>Requires Level ${escapeHtml(row.required_level)}</div>`);

  if (Number(row.sell_price)) lines.push(`<div class="detail">Sell Price: ${escapeHtml(row.sell_price)} copper</div>`);

  return `<div class="tooltip">
  ${lines.join('\n  ')}
</div>`;
}
