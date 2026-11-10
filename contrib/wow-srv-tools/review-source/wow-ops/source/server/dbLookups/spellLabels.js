import { quoteIdentifier, withMissingReference } from '../queries/db/sql.js';
import { highestBuildClause } from '../queries/db/progressive.js';

// spell_template is keyed (entry, build) and loaded "highest build not above
// the client build" (vmangos-core/src/game/Spells/SpellMgr.cpp:3722).
export async function fetchSpellRows(pool, { schema, ids, clientBuild }) {
  const unique = [...new Set(ids.map(Number).filter(Number.isInteger))];
  if (unique.length === 0) return new Map();
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier('spell_template')}`;
  const [rows] = await pool.query(
    `SELECT t1.* FROM ${table} t1 WHERE t1.entry IN (${unique.map(() => '?').join(', ')}) AND ${highestBuildClause(schema, 'spell_template', 't1')}`,
    [...unique, clientBuild]
  );
  return new Map(rows.map((r) => [Number(r.entry), r]));
}

// A trainer row or a quest's reward spell can name either the spell actually
// granted, or a "teaching" spell whose own first effect is
// SPELL_EFFECT_LEARN_SPELL (36) - what that spell actually grants is its own
// effectTriggerSpell1, not its own entry. The core enforces exactly this
// split when it loads a trainer table
// (vmangos-core/src/game/ObjectMgr.cpp:10721-10735: "has non-learning spell
// ... possible must be used spell X instead", matching on `Effect[0] ==
// SPELL_EFFECT_LEARN_SPELL && EffectTriggerSpell[0] == spell`) and casts a
// quest's reward spell the same way at completion
// (vmangos-core/src/game/Objects/Player.cpp:13431). A row that is not a
// learn spell links to itself.
function taughtSpellId(row) {
  if (!row) return null;
  return Number(row.effect1) === 36 ? Number(row.effectTriggerSpell1) : Number(row.entry);
}

// Batch form: reads every id's row once (fetchSpellRows) and resolves each
// through taughtSpellId, falling back to the id itself when its row was not
// found (an unbuilt build, or a bad data row) rather than dropping the link.
export async function resolveTaughtSpellIds(pool, { schema, ids, clientBuild }) {
  const unique = [...new Set(ids.map(Number).filter((n) => n > 0))];
  const map = new Map();
  if (unique.length === 0) return map;
  const rows = await fetchSpellRows(pool, { schema, ids: unique, clientBuild });
  for (const id of unique) map.set(id, taughtSpellId(rows.get(id)) ?? id);
  return map;
}

function emptyLabels() {
  return { castMs: new Map(), durationMs: new Map(), range: new Map(), radius: new Map(), iconName: new Map() };
}

// The client's cast-time, duration, range, radius and icon tables, imported
// into the reference schema (tools/import-dbc.js). One statement for a whole
// page: each branch of the UNION ALL reads one table for the index ids the
// given spell rows carry, into a common (kind, id, a, b, c) shape.
export async function fetchSpellLabels(pool, { dbcSchema, spells }) {
  const labels = emptyLabels();
  if (!dbcSchema || spells.length === 0) return labels;
  const ids = (col) => [...new Set(spells.map((s) => Number(s[col])).filter((n) => n > 0))];
  const radiusIds = [...new Set(spells.flatMap((s) => [1, 2, 3].map((i) => Number(s[`effectRadiusIndex${i}`]))).filter((n) => n > 0))];
  const t = (name) => `${quoteIdentifier(dbcSchema)}.${quoteIdentifier(name)}`;
  const branches = [];
  const params = [];
  const add = (sql, list) => { if (list.length) { branches.push(sql.replace('(?)', `(${list.map(() => '?').join(', ')})`)); params.push(...list); } };
  // MySQL names a UNION's result columns after its FIRST SELECT - not each
  // branch's own aliases - so every branch must alias identically (kind, id,
  // a, b, c), not just the one that happens to be written first. Without
  // this, a page with no cast-time index (all instant/passive spells) drops
  // the 'cast' branch, leaves the next branch unaliased, and every row comes
  // back with no `kind` property.
  add(`SELECT 'cast' AS kind, id AS id, cast_time AS a, NULL AS b, NULL AS c FROM ${t('spell_cast_times')} WHERE id IN (?)`, ids('castingTimeIndex'));
  add(`SELECT 'duration' AS kind, id AS id, duration AS a, NULL AS b, NULL AS c FROM ${t('spell_duration')} WHERE id IN (?)`, ids('durationIndex'));
  add(`SELECT 'range' AS kind, id AS id, min_range AS a, max_range AS b, name AS c FROM ${t('spell_range')} WHERE id IN (?)`, ids('rangeIndex'));
  add(`SELECT 'radius' AS kind, id AS id, radius AS a, NULL AS b, NULL AS c FROM ${t('spell_radius')} WHERE id IN (?)`, radiusIds);
  add(`SELECT 'icon' AS kind, id AS id, NULL AS a, NULL AS b, path AS c FROM ${t('spell_icon')} WHERE id IN (?)`, ids('spellIconId'));
  if (branches.length === 0) return labels;

  const rows = await withMissingReference(null, async () => (await pool.query(branches.join(' UNION ALL '), params))[0]);
  if (rows === null) return labels;

  const byKind = { cast: new Map(), duration: new Map(), range: new Map(), radius: new Map(), icon: new Map() };
  for (const r of rows) { if (!byKind[r.kind]) continue; byKind[r.kind].set(Number(r.id), r); }
  for (const s of spells) {
    const e = Number(s.entry);
    const cast = byKind.cast.get(Number(s.castingTimeIndex));
    if (cast) labels.castMs.set(e, Number(cast.a));
    const dur = byKind.duration.get(Number(s.durationIndex));
    if (dur) labels.durationMs.set(e, Number(dur.a));
    const range = byKind.range.get(Number(s.rangeIndex));
    if (range) labels.range.set(e, { min: Number(range.a), max: Number(range.b), name: range.c ?? '' });
    for (const i of [1, 2, 3]) {
      const rad = byKind.radius.get(Number(s[`effectRadiusIndex${i}`]));
      if (rad) labels.radius.set(`${e}:${i}`, Number(rad.a));
    }
    const icon = byKind.icon.get(Number(s.spellIconId));
    if (icon?.c) labels.iconName.set(e, String(icon.c).split('\\').pop());
  }
  return labels;
}

// The ctx substituteSpellText (spellText.js) takes, for one spell row.
export function spellContext(row, labels, referenced) {
  const e = Number(row.entry);
  return {
    spell: row,
    durationMs: labels.durationMs.get(e) ?? null,
    rangeYards: labels.range.get(e)?.max ?? null,
    radiusYards: [1, 2, 3].map((i) => labels.radius.get(`${e}:${i}`) ?? null),
    referenced
  };
}
