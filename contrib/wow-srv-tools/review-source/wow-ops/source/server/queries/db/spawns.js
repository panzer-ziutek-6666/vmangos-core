import { quoteIdentifier } from './sql.js';

// Where does this entry actually stand in the world - a spawn lookup, not a
// template lookup. Two tables, two shapes:
//
// creature has five id columns (id..id5) and the server picks one of them at
// spawn time; only `id` is indexed, so a lookup on `id` alone silently misses
// every row spawned through id2..id5. On this realm that is 9648 (id2) + 3047
// (id3) + 608 (id4) + 8 (id5) rows out of 66243 total (a real COUNT(*); the
// 67844 this comment used to cite was an information_schema.tables estimate,
// not the true row count) - not a rare case. The five-column OR is an
// accepted 66243-row scan rather than an index added to a table the released
// world dump owns.
//
// gameobject has a single `id` column, so its lookup is a plain equality.
//
// Neither table stores a zone or area id - they carry `map` plus coordinates
// only. Naming a zone needs terrain data the extractors produce, which is not
// derivable in SQL, so this module never invents one: callers get a map id
// and x/y/z and that is the entirety of what the database knows.
const ID_COLUMNS = ['id', 'id2', 'id3', 'id4', 'id5'];

function toRow(dbRow) {
  return {
    guid: Number(dbRow.guid),
    map: Number(dbRow.map),
    x: Number(dbRow.position_x),
    y: Number(dbRow.position_y),
    z: Number(dbRow.position_z)
  };
}

// LIMIT cannot be a bound `?` parameter in a way mysql2 renders correctly, so
// it is validated here - before any query is issued, including the COUNT(*)
// - and interpolated as a plain integer literal.
function validatedLimit(fnName, limit) {
  if (!Number.isInteger(limit)) {
    throw new Error(`${fnName}: limit must be an integer`);
  }
  return limit;
}

// Row lookup on all five id columns, with the patch filter loot.js already
// uses (patch_min <= ? AND ? <= patch_max) - both tables carry that same
// pair of columns.
export async function fetchCreatureSpawns(pool, { schema, entry, wowPatch, limit }) {
  const cappedLimit = validatedLimit('fetchCreatureSpawns', limit);
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier('creature')}`;
  const idMatch = ID_COLUMNS.map((col) => `${col} = ?`).join(' OR ');
  const where = `(${idMatch}) AND patch_min <= ? AND ? <= patch_max`;
  const idParams = ID_COLUMNS.map(() => entry);

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS n FROM ${qualified} WHERE ${where}`,
    [...idParams, wowPatch, wowPatch]
  );
  // A real COUNT(*) always returns exactly one row, even for zero matches -
  // but a caller that stubs this table without wiring up a count row (an
  // entity page test that is not about spawns at all) would otherwise throw
  // reading .n off undefined. A genuine query failure still propagates,
  // since it never reaches this line at all.
  const total = Number(countRows[0]?.n ?? 0);

  const [rows] = await pool.query(
    `SELECT guid, id, id2, id3, id4, id5, map, position_x, position_y, position_z
     FROM ${qualified}
     WHERE ${where}
     ORDER BY map, guid
     LIMIT ${cappedLimit}`,
    [...idParams, wowPatch, wowPatch]
  );

  return {
    total,
    rows: rows.map((dbRow) => {
      // Which of id..id5 actually matched - the server spawns from exactly
      // one of them, and the page needs to say which, since it is not
      // always `id`.
      const column = ID_COLUMNS.find((col) => Number(dbRow[col]) === entry);
      return { ...toRow(dbRow), column };
    })
  };
}

// gameobject has only one id column, so this is the same shape without the
// five-way OR and without a `column` on the result.
export async function fetchGameObjectSpawns(pool, { schema, entry, wowPatch, limit }) {
  const cappedLimit = validatedLimit('fetchGameObjectSpawns', limit);
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier('gameobject')}`;
  const where = `id = ? AND patch_min <= ? AND ? <= patch_max`;

  const [countRows] = await pool.query(`SELECT COUNT(*) AS n FROM ${qualified} WHERE ${where}`, [
    entry,
    wowPatch,
    wowPatch
  ]);
  // See fetchCreatureSpawns above: a real COUNT(*) always yields one row, but
  // an under-stubbed test table must not throw for it.
  const total = Number(countRows[0]?.n ?? 0);

  const [rows] = await pool.query(
    `SELECT guid, map, position_x, position_y, position_z
     FROM ${qualified}
     WHERE ${where}
     ORDER BY map, guid
     LIMIT ${cappedLimit}`,
    [entry, wowPatch, wowPatch]
  );

  return { total, rows: rows.map(toRow) };
}
