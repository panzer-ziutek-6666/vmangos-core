import { QUEST_SORTS, QUEST_TYPES, RACEMASK_ALLIANCE, RACEMASK_HORDE, RACEMASK_ALL_PLAYABLE } from '../../dbLookups/questCategories.js';

// Sort keys are looked up, never supplied: a column name cannot be bound.
export const QUEST_SORT_KEYS = {
  name: 't1.Title',
  level: 't1.QuestLevel',
  minlevel: 't1.MinLevel',
  entry: 't1.entry'
};

export const PAGE_SIZE = 50;

function intOrNull(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

function likeTerm(text) {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
  return `%${escaped}%`;
}

// ZoneOrSort is a signed smallint: a positive value is a zone id, bounded by
// the column; a negative one is a QuestSort id stored negated
// (vmangos-core/src/game/SharedDefines.h:886-920) and must be one the core
// names. The parser has no database, so it bounds rather than looks up.
function categoryOrNull(value) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return null;
  const n = Number(value);
  if (n > 0) return n <= 32767 ? n : null;
  if (n < 0) return QUEST_SORTS.has(-n) ? n : null;
  return null;
}

// A side means "a character of that side can take it": no playable-race
// restriction (RequiredRaces & RACEMASK_ALL_PLAYABLE = 0, which is how a mask
// with no playable bit reads too - questCategories.js's questSide comment),
// or a mask naming at least one race of that side (SharedDefines.h:78-84).
const SIDE_MASKS = { alliance: RACEMASK_ALLIANCE, horde: RACEMASK_HORDE };

export function parseQuestFilters(query = {}) {
  const conditions = [];
  const params = [];
  const applied = {};

  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q) {
    conditions.push('t1.Title LIKE ?');
    params.push(likeTerm(q));
    applied.q = q;
  }

  if (Object.hasOwn(SIDE_MASKS, query.side)) {
    conditions.push('((t1.RequiredRaces & ?) = 0 OR t1.RequiredRaces & ? <> 0)');
    params.push(RACEMASK_ALL_PLAYABLE, SIDE_MASKS[query.side]);
    applied.side = query.side;
  }

  const type = intOrNull(query.type, { max: 65535 });
  if (type !== null && QUEST_TYPES.has(type)) {
    conditions.push('t1.Type = ?');
    params.push(type);
    applied.type = type;
  }

  const category = categoryOrNull(query.category);
  if (category !== null) {
    conditions.push('t1.ZoneOrSort = ?');
    params.push(category);
    applied.category = category;
  }

  // QuestLevel and MinLevel are tinyint unsigned (0-255): the bound is the
  // column's, not a game level cap.
  const numeric = [
    ['minlevel', 't1.QuestLevel >= ?'],
    ['maxlevel', 't1.QuestLevel <= ?'],
    ['minreq', 't1.MinLevel >= ?'],
    ['maxreq', 't1.MinLevel <= ?']
  ];
  for (const [key, condition] of numeric) {
    const value = intOrNull(query[key], { max: 255 });
    if (value === null) continue;
    conditions.push(condition);
    params.push(value);
    applied[key] = value;
  }

  const sort = Object.hasOwn(QUEST_SORT_KEYS, query.sort) ? query.sort : 'name';
  const dir = query.dir === 'desc' ? 'desc' : 'asc';
  const page = intOrNull(query.page, { min: 1 }) ?? 1;
  applied.sort = sort;
  applied.dir = dir;
  applied.page = page;

  return { conditions, params, sort, dir, page, pageSize: PAGE_SIZE, applied };
}
