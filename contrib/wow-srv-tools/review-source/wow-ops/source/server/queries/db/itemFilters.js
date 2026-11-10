// Sorting is the one place a user-supplied string would have to become SQL
// text: a column name cannot be bound as a parameter. So it is not supplied -
// a key is looked up in this table, and anything not in it is the default.
// Same rule as server/commands/validate.js follows for GM command arguments:
// reject the value rather than try to make it safe.
export const ITEM_SORTS = {
  name: 't1.name',
  quality: 't1.quality',
  ilvl: 't1.item_level',
  level: 't1.required_level',
  slot: 't1.inventory_type',
  entry: 't1.entry'
};

export const PAGE_SIZE = 50;

function intOrNull(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

// A person typing "100%" into the name box means those characters, not
// "anything". LIKE's own wildcards are escaped before the term is bound.
function likeTerm(text) {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
  return `%${escaped}%`;
}

export function parseItemFilters(query = {}) {
  const conditions = [];
  const params = [];
  const applied = {};

  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q) {
    conditions.push('t1.name LIKE ?');
    params.push(likeTerm(q));
    applied.q = q;
  }

  const numeric = [
    // ItemQuality, vmangos-core/src/game/SharedDefines.h:194-200.
    ['quality', 't1.quality = ?', { max: 6 }],
    // ItemClass, ItemPrototype.h:135-153.
    ['class', 't1.class = ?', { max: 15 }],
    // ItemSubclassWeapon has max subclass 20, ItemPrototype.h:190-215.
    ['subclass', 't1.subclass = ?', { max: 20 }],
    // Measured maxima on this realm are 100; bound by column capacity (0-255).
    ['minlevel', 't1.required_level >= ?', { max: 255 }],
    ['maxlevel', 't1.required_level <= ?', { max: 255 }],
    // Measured maxima on this realm are 100; bound by column capacity (0-255).
    ['minilvl', 't1.item_level >= ?', { max: 255 }],
    ['maxilvl', 't1.item_level <= ?', { max: 255 }],
    // InventoryType, ItemPrototype.h:100-131.
    ['slot', 't1.inventory_type = ?', { max: 28 }]
  ];
  for (const [key, condition, bounds] of numeric) {
    const value = intOrNull(query[key], bounds);
    if (value === null) continue;
    conditions.push(condition);
    params.push(value);
    applied[key] = value;
  }

  const sort = Object.hasOwn(ITEM_SORTS, query.sort) ? query.sort : 'name';
  const dir = query.dir === 'desc' ? 'desc' : 'asc';
  const page = intOrNull(query.page, { min: 1 }) ?? 1;

  applied.sort = sort;
  applied.dir = dir;
  applied.page = page;

  return { conditions, params, sort, dir, page, pageSize: PAGE_SIZE, applied };
}
