import { quoteIdentifier } from './sql.js';
import { highestPatchClause, highestBuildClause } from './progressive.js';

// Every searchable kind, in the order results render. `key` is the id column;
// `current` makes the read match the row the server loaded: patch-keyed
// templates through highestPatchClause (SQLStorageImpl.h:364), build-keyed
// spell_template and faction through highestBuildClause (SpellMgr.cpp:3722,
// ObjectMgr.cpp:8743); area_template has neither column. The zone spec reads
// every area_template row, zones and sub-areas alike - restricting it to
// zone_id = 0 (no parent) hid every sub-area from search even though its own
// page (/db/zone/:id) exists and names the zone it belongs to; "Goldshire"
// (id 87, a sub-area of Elwynn Forest) is exactly the case that broke.
// quest_template is the one table whose name column is not lowercase `name`.
const SPECS = [
  { kind: 'creature', table: 'creature_template', key: 'entry', nameColumn: 'name', current: 'patch' },
  { kind: 'item', table: 'item_template', key: 'entry', nameColumn: 'name', current: 'patch' },
  { kind: 'quest', table: 'quest_template', key: 'entry', nameColumn: 'Title', current: 'patch' },
  { kind: 'gameobject', table: 'gameobject_template', key: 'entry', nameColumn: 'name', current: 'patch' },
  { kind: 'spell', table: 'spell_template', key: 'entry', nameColumn: 'name', current: 'build' },
  { kind: 'zone', table: 'area_template', key: 'entry', nameColumn: 'name', current: null },
  { kind: 'faction', table: 'faction', key: 'id', nameColumn: 'name', current: 'build' }
];

// LIMIT cannot be bound as a `?` parameter in a way mysql2 renders correctly
// (server/queries/db/spawns.js), so it is validated before any query runs and
// interpolated as a plain integer literal.
function validatedLimit(limit) {
  if (!Number.isInteger(limit)) {
    throw new Error('searchTemplates: limit must be an integer');
  }
  return limit;
}

// MySQL's LIKE treats \, % and _ specially inside the pattern itself
// (backslash is the default escape character). A caller's term is wrapped in
// %...% below to search anywhere in the name, so its own literal % and _ (and
// any \ it already contains) must be escaped first - otherwise a search for
// "100%", a literal string several item and quest names carry, would match
// every row instead of the ones that actually contain it.
function escapeLike(term) {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// The conditions and their params that follow the caller's own, for one spec.
function currentRow(schema, spec, { wowPatch, clientBuild }) {
  const conditions = [];
  const params = [];
  if (spec.current === 'patch') { conditions.push(highestPatchClause(schema, spec.table, 't1')); params.push(wowPatch); }
  if (spec.current === 'build') { conditions.push(highestBuildClause(schema, spec.table, 't1', spec.key)); params.push(clientBuild); }
  return { conditions, params };
}

// The id path: the query is only digits, so it is offered as an exact key in
// every kind rather than searched as text. At most one row per kind can
// match, so this needs no COUNT(*) - the row count is the total.
async function searchNumeric(pool, { schema, entry, wowPatch, clientBuild }) {
  const groups = [];
  for (const spec of SPECS) {
    const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(spec.table)}`;
    const nameCol = quoteIdentifier(spec.nameColumn);
    const { conditions, params } = currentRow(schema, spec, { wowPatch, clientBuild });
    const where = [`t1.${spec.key} = ?`, ...conditions].join(' AND ');
    const [rows] = await pool.query(
      `SELECT t1.${spec.key} AS id, t1.${nameCol} AS name FROM ${qualified} t1 WHERE ${where}`,
      [entry, ...params]
    );
    const mapped = rows.map((r) => ({ id: Number(r.id), name: r.name }));
    groups.push({ kind: spec.kind, rows: mapped, total: mapped.length });
  }
  return groups;
}

// The text path: a name search, capped and counted separately since a search
// term can match far more rows than are worth rendering.
async function searchText(pool, { schema, term, wowPatch, clientBuild, limit }) {
  const cappedLimit = validatedLimit(limit);
  const likeTerm = `%${escapeLike(term)}%`;

  const groups = [];
  for (const spec of SPECS) {
    const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(spec.table)}`;
    const nameCol = quoteIdentifier(spec.nameColumn);
    const { conditions, params: currentParams } = currentRow(schema, spec, { wowPatch, clientBuild });
    const where = [`t1.${nameCol} LIKE ?`, ...conditions].join(' AND ');
    const params = [likeTerm, ...currentParams];

    const [countRows] = await pool.query(`SELECT COUNT(*) AS n FROM ${qualified} t1 WHERE ${where}`, params);
    const total = Number(countRows[0]?.n ?? 0);

    const [rows] = await pool.query(
      `SELECT t1.${spec.key} AS id, t1.${nameCol} AS name FROM ${qualified} t1
       WHERE ${where}
       ORDER BY t1.${spec.key}
       LIMIT ${cappedLimit}`,
      params
    );

    groups.push({ kind: spec.kind, rows: rows.map((r) => ({ id: Number(r.id), name: r.name })), total });
  }
  return groups;
}

// Searches creature, item, quest, gameobject, spell, zone and faction for
// `query`, each read the way its own page reads it: patch-progressive
// templates against the patch the running server loaded (highestPatchClause),
// spell_template and faction against the running client build
// (highestBuildClause), area_template plainly, every row - zones and
// sub-areas both, since each has its own /db/zone/:id page. A query of only
// digits takes the id path (searchNumeric); anything else, including an empty
// string once trimmed, is a name search - except an empty string asks the
// database nothing at all, since every row would otherwise match.
export async function searchTemplates(pool, { schema, query, wowPatch, clientBuild, limit }) {
  const trimmed = String(query ?? '').trim();
  if (trimmed === '') return { numeric: false, groups: [] };

  const numeric = /^\d+$/.test(trimmed);
  const groups = numeric
    ? await searchNumeric(pool, { schema, entry: Number(trimmed), wowPatch, clientBuild })
    : await searchText(pool, { schema, term: trimmed, wowPatch, clientBuild, limit });

  return { numeric, groups };
}
