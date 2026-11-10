// Sorting is the one place a user-supplied string would have to become SQL
// text: a column name cannot be bound as a parameter. So it is not supplied -
// a key is looked up in this table, and anything not in it is the default.
// Same rule as server/commands/validate.js follows for GM command arguments:
// reject the value rather than try to make it safe.
export const CREATURE_SORTS = {
  name: 't1.name',
  level: 't1.level_min',
  rank: 't1.rank',
  type: 't1.type',
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

export function parseCreatureFilters(query = {}) {
  const conditions = [];
  const params = [];
  const applied = {};

  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q) {
    conditions.push('t1.name LIKE ?');
    params.push(likeTerm(q));
    applied.q = q;
  }

  // 258 distinct factions on this realm is too many for a select, and a
  // person looks for "Riverpaw", not faction id 14. This is a condition on
  // the joined faction table's own name column (aliased `faction` by
  // creatures.js), never on t1 - and creatures.js drops it again when the
  // reference schema that backs the join is unavailable, rather than let an
  // orphaned condition reference a join that was never made.
  const faction = typeof query.faction === 'string' ? query.faction.trim() : '';
  if (faction) {
    conditions.push('faction.name LIKE ?');
    params.push(likeTerm(faction));
    applied.faction = faction;
  }

  const numeric = [
    // CreatureEliteType, vmangos-core/src/game/Objects/CreatureDefines.h:87-94:
    // 0 (normal) through 4 (rare) - 5 values, matching the 5 distinct ranks
    // measured in this realm's creature_template.
    ['rank', 't1.rank = ?', { max: 4 }],
    // CreatureType, vmangos-core/src/game/Objects/CreatureDefines.h:40-53: 1
    // (Beast) through 11 (Totem). 0 is not a named type - it is the
    // CreatureInfo struct field's unset default (CreatureDefines.h:253), not
    // an enum member - but it is real data on this realm (see
    // server/dbLookups/creatureTypes.js, which falls it through to
    // "Unknown"), so it stays in range rather than being excluded: 12
    // distinct values measured (0-11).
    ['type', 't1.type = ?', { max: 11 }],
    // level_min/level_max are tinyint unsigned columns (capacity 0-255).
    // Bound by the column, not by a level-60 game cap: this realm's
    // creature_template already reaches level 70, and cycle 3 ruled that a
    // bound exists to keep a parameter sane, not to encode a game rule, after
    // the plan's level cap silently dropped a filter for level 70.
    ['minlevel', 't1.level_min >= ?', { max: 255 }],
    ['maxlevel', 't1.level_max <= ?', { max: 255 }]
  ];
  for (const [key, condition, bounds] of numeric) {
    const value = intOrNull(query[key], bounds);
    if (value === null) continue;
    conditions.push(condition);
    params.push(value);
    applied[key] = value;
  }

  const sort = Object.hasOwn(CREATURE_SORTS, query.sort) ? query.sort : 'name';
  const dir = query.dir === 'desc' ? 'desc' : 'asc';
  const page = intOrNull(query.page, { min: 1 }) ?? 1;

  applied.sort = sort;
  applied.dir = dir;
  applied.page = page;

  return { conditions, params, sort, dir, page, pageSize: PAGE_SIZE, applied };
}
