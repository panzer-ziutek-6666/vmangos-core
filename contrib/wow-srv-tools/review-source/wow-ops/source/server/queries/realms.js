// The realm registry, realmd.realmlist, plus the run history in
// realmd.uptime. Both tables live in the logon database, so unlike
// server/queries/bots.js nothing here has to qualify a schema by name - the
// pool's own default schema is the right one.
//
// This is the only place in the panel that WRITES through a MySQL pool, and
// it is a deliberate exception to the "reads over SQL, writes over SOAP"
// rule the rest of the panel follows. The reason the rule exists is that the
// world server caches its DB tables in memory, so a SQL write behind a
// running mangosd does nothing until a reload. realmlist is not one of those
// tables: mangosd never reads it, realmd does, and realmd re-polls it on its
// own interval (vmangos-core/src/realmd/RealmList.cpp:150-160). There is also
// no GM command that edits it, so SOAP is not an option. Every write here is
// recorded in the audit log by server/sections/server.js.

// The ten columns the panel owns. population, gamebuild_min, gamebuild_max
// and flag are left to their defaults: the first is written by mangosd, and
// the other three are legacy columns realmd's own query does not even select
// (RealmList.cpp:168-172).
const COLUMNS = [
  'name', 'address', 'localAddress', 'localSubnetMask', 'port',
  'icon', 'realmflags', 'timezone', 'allowedSecurityLevel', 'realmbuilds'
];

function values(row) {
  return COLUMNS.map((c) => row[c]);
}

function requirePool(pools) {
  const pool = pools?.logon;
  if (!pool) throw new Error('the logon database is not configured, so the realm registry cannot be changed');
  return pool;
}

// mysql2 puts a NaN parameter into the query as the bare token NaN, which
// MySQL then reads as a column name and rejects with "Unknown column 'NaN'
// in 'where clause'". That is an ER_BAD_FIELD_ERROR, which the app's error
// handler does not classify as a database outage, so it would reach the
// operator as a raw 500 carrying driver text. Refuse the id here instead.
function requireId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`"${id}" is not a realm id`);
  }
  return n;
}

export async function listRealms(pools) {
  const pool = pools?.logon;
  if (!pool) return [];
  const [rows] = await pool.query(
    `SELECT id, ${COLUMNS.join(', ')}, population, flag FROM realmlist ORDER BY id`
  );
  return rows;
}

export async function getRealm(pools, id) {
  const realmId = requireId(id);
  const pool = pools?.logon;
  if (!pool) return null;
  const [rows] = await pool.query(
    `SELECT id, ${COLUMNS.join(', ')}, population, flag FROM realmlist WHERE id = ?`,
    [realmId]
  );
  return rows[0] ?? null;
}

export async function insertRealm(pools, row) {
  const pool = requirePool(pools);
  const placeholders = COLUMNS.map(() => '?').join(', ');
  const [result] = await pool.query(
    `INSERT INTO realmlist (${COLUMNS.join(', ')}) VALUES (${placeholders})`,
    values(row)
  );
  return result.insertId;
}

export async function updateRealm(pools, id, row) {
  const realmId = requireId(id);
  const pool = requirePool(pools);
  const assignments = COLUMNS.map((c) => `${c} = ?`).join(', ');
  const [result] = await pool.query(
    `UPDATE realmlist SET ${assignments} WHERE id = ?`,
    [...values(row), realmId]
  );
  return result.affectedRows;
}

export async function deleteRealm(pools, id) {
  const realmId = requireId(id);
  const pool = requirePool(pools);
  const [result] = await pool.query('DELETE FROM realmlist WHERE id = ?', [realmId]);
  return result.affectedRows;
}

// One row per mangosd run: when it started, how long it lasted, the peak
// player count, and the core revision it was built from. Note that
// onlineplayers counts network sessions, so module bots never appear in it -
// the same caveat the status strip carries.
export async function listUptimeHistory(pools, limit = 20) {
  const pool = pools?.logon;
  if (!pool) return [];
  const n = Number(limit);
  const safeLimit = Number.isInteger(n) && n > 0 && n <= 200 ? n : 20;
  const [rows] = await pool.query(
    `SELECT realmid, starttime, startstring, uptime, onlineplayers, maxplayers, revision
     FROM uptime ORDER BY starttime DESC LIMIT ?`,
    [safeLimit]
  );
  return rows;
}
