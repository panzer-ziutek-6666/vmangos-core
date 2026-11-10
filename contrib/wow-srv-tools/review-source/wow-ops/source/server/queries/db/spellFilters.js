import { quoteIdentifier } from './sql.js';
import { highestBuildJoin } from './progressive.js';

export const SPELL_SORT_KEYS = { name: 't1.name', level: 't1.spellLevel', entry: 't1.entry' };
export const PAGE_SIZE = 50;
// Playable classes, vmangos-core/src/game/SharedDefines.h:87-100 (6 and 10 absent in 1.12).
export const VALID_CLASSES = new Set([1, 2, 3, 4, 5, 7, 8, 9, 11]);

// spell_template.spellLevel is `int unsigned` on this realm's world DB
// (information_schema.columns, checked 2026-09-23), not a tinyint like the
// quest level columns - so its bound is the column's own max, not 255.
const SPELL_LEVEL_MAX = 4294967295;

function intOrNull(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

function likeTerm(text) {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
  return `%${escaped}%`;
}

function isSet(value) {
  return typeof value === 'string' && value !== '';
}

// "Learnable" = named by skill_line_ability at this build (keyed (id, build)).
// spell_id has no index, so this is one set-based IN (...) the server
// materialises once, never a per-row lookup. The highest-build rule is
// applied with highestBuildJoin, not highestBuildClause: skill_line_ability's
// primary key is (id, build), so `id` itself is indexed, but a correlated
// MAX(build) subquery still runs once per outer row of the whole table
// regardless of that index - measured 2026-09-23 at ~1.1s for the default
// page's rows statement with the correlated form, ~257ms with the join. See
// progressive.js's highestBuildJoin for the mechanics.
export function parseSpellFilters(query = {}, { schema, clientBuild } = {}) {
  const conditions = [];
  const params = [];
  const applied = {};

  const q = typeof query.q === 'string' ? query.q.trim() : '';
  const cls = intOrNull(query.class, { min: 1, max: 11 });
  const skill = intOrNull(query.skill, { min: 1, max: 65535 });
  const all = isSet(query.all);
  if (all) applied.all = true;

  const learnableParts = [];
  const learnableParams = [];
  if (cls !== null && VALID_CLASSES.has(cls)) {
    learnableParts.push('(s.class_mask = 0 OR s.class_mask & ? <> 0)');
    learnableParams.push(1 << (cls - 1));
    applied.class = cls;
  }
  if (skill !== null) {
    learnableParts.push('s.skill_id = ?');
    learnableParams.push(skill);
    applied.skill = skill;
  }
  if (!all || learnableParts.length > 0) {
    if (!Number.isFinite(clientBuild)) {
      throw new Error('parseSpellFilters: the learnable condition needs a finite clientBuild');
    }
    const sla = `${quoteIdentifier(schema)}.${quoteIdentifier('skill_line_ability')}`;
    const join = highestBuildJoin(schema, 'skill_line_ability', 's', 'id');
    const where = learnableParts.length ? ` WHERE ${learnableParts.join(' AND ')}` : '';
    conditions.push(`t1.entry IN (SELECT s.spell_id FROM ${sla} s ${join}${where})`);
    params.push(clientBuild, ...learnableParams);
  }

  if (q) { conditions.push('t1.name LIKE ?'); params.push(likeTerm(q)); applied.q = q; }

  const school = intOrNull(query.school, { max: 6 });
  if (school !== null) { conditions.push('t1.school = ?'); params.push(school); applied.school = school; }

  for (const [key, condition] of [['minlevel', 't1.spellLevel >= ?'], ['maxlevel', 't1.spellLevel <= ?']]) {
    const v = intOrNull(query[key], { max: SPELL_LEVEL_MAX });
    if (v === null) continue;
    conditions.push(condition); params.push(v); applied[key] = v;
  }

  const sort = Object.hasOwn(SPELL_SORT_KEYS, query.sort) ? query.sort : 'name';
  const dir = query.dir === 'desc' ? 'desc' : 'asc';
  const page = intOrNull(query.page, { min: 1 }) ?? 1;
  Object.assign(applied, { sort, dir, page });
  return { conditions, params, sort, dir, page, pageSize: PAGE_SIZE, applied };
}
