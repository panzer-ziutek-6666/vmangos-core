import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { readConfigFile, DB_KEYS } from '../server/config.js';
import { LAYOUTS } from './dbc/layouts/index.js';
import { importTable } from './dbc/importer.js';
import { checkRowCounts } from './dbc/verify.js';

// MySQL cannot roll back DDL, and this tool is offline and safe to re-run, so
// a failure stops the run and says where rather than trying to undo the tables
// already imported.
export async function importAll(connection, { dbcDir, layouts = LAYOUTS, log = () => {} }) {
  const tables = [];
  for (const layout of layouts) {
    try {
      const result = await importTable(connection, layout, dbcDir);
      tables.push(result);
      log(`${result.table.padEnd(24)} ${String(result.records).padStart(6)} rows`);
    } catch (err) {
      return { tables, failed: { table: layout.table, file: layout.file, message: err.message } };
    }
  }
  return { tables, failed: null };
}

// What the schema was built from. Without it a schema left stale by a client
// update is invisible: the tables still look complete.
export const META_TABLE = 'dbc_import';

export function createMetaSql() {
  return `CREATE TABLE \`${META_TABLE}\` (
  \`table_name\` VARCHAR(64) NOT NULL,
  \`source_file\` VARCHAR(64) NOT NULL,
  \`records\` INT UNSIGNED NOT NULL,
  \`field_count\` INT UNSIGNED NOT NULL,
  \`record_size\` INT UNSIGNED NOT NULL,
  \`source_bytes\` BIGINT UNSIGNED NOT NULL,
  \`source_modified\` DATETIME NOT NULL,
  \`client_build\` INT UNSIGNED NOT NULL,
  \`imported_at\` DATETIME NOT NULL,
  PRIMARY KEY (\`table_name\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
}

export async function writeMeta(connection, tables, { clientBuild, importedAt = new Date() }) {
  await connection.query(`DROP TABLE IF EXISTS \`${META_TABLE}\``);
  await connection.query(createMetaSql());
  for (const t of tables) {
    await connection.query(
      `INSERT INTO \`${META_TABLE}\` (\`table_name\`, \`source_file\`, \`records\`, \`field_count\`, \`record_size\`, \`source_bytes\`, \`source_modified\`, \`client_build\`, \`imported_at\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.table, t.file, t.records, t.fieldCount, t.recordSize, t.sourceBytes, t.sourceModified, clientBuild, importedAt]
    );
  }
}

// mysql.dbcSchema is one string beside four realm connection blocks, so
// pointing it at "world" (or any of the others) is one copy-paste away - and
// importAll DROPs every table it imports, in whichever schema it is told to
// connect to. DB_KEYS is the same list config.js validates those four blocks
// under, so this can't drift from what actually counts as a realm database.
// Compared case/whitespace-insensitively because MySQL schema names are
// case-insensitive on this platform (lower_case_table_names), so "World" is
// just as much a mistake as "world".
export function isRealmSchema(schema, mysqlCfg) {
  const realmNames = DB_KEYS.map((key) => mysqlCfg[key]?.database)
    .filter(Boolean)
    .map((name) => name.trim().toLowerCase());
  return realmNames.includes(schema.trim().toLowerCase());
}

export function grantHelp(schema, user) {
  return `CREATE DATABASE \`${schema}\`;\nGRANT ALL PRIVILEGES ON \`${schema}\`.* TO '${user}'@'localhost';`;
}

// The configured user has no global CREATE, so the schema is a one-time manual
// step. Both of these mean "it is not there, or you cannot reach it", and both
// have the same answer.
export function isMissingSchema(err) {
  return err?.code === 'ER_BAD_DB_ERROR' || err?.code === 'ER_DBACCESS_DENIED_ERROR';
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const here = dirname(fileURLToPath(import.meta.url));
  const cfg = readConfigFile(join(here, '..', 'config.json'));
  if (!cfg.client) {
    console.error('config.json needs a "client" section. See config.example.json.');
    process.exit(1);
  }
  if (!cfg.mysql.world) {
    console.error('config.json needs mysql.world: the reference schema lives on the same server.');
    process.exit(1);
  }

  const schema = cfg.mysql.dbcSchema;
  if (isRealmSchema(schema, cfg.mysql)) {
    console.error(`mysql.dbcSchema is "${schema}", which is a realm database. The reference schema must be its own; this tool drops every table it imports.`);
    process.exit(1);
  }

  let connection;
  try {
    connection = await mysql.createConnection({ ...cfg.mysql.world, database: schema });
  } catch (err) {
    if (isMissingSchema(err)) {
      console.error(`The "${schema}" schema does not exist, or this user cannot reach it.`);
      console.error('Run these once, as a MySQL user that may create databases:\n');
      console.error(grantHelp(schema, cfg.mysql.world.user));
      process.exit(1);
    }
    throw err;
  }

  // The server runs with IGNORE_SPACE,NO_ENGINE_SUBSTITUTION, which lets an
  // over-long string or out-of-range number truncate silently instead of
  // erroring - and the row-count check below counts rows, not correctness, so
  // it would not notice. STRICT_ALL_TABLES turns that into a thrown error on
  // this connection only.
  await connection.query("SET SESSION sql_mode='STRICT_ALL_TABLES'");

  try {
    const result = await importAll(connection, { dbcDir: cfg.client.dbcDir, log: (line) => console.log(line) });
    if (result.failed) {
      console.error(`\n${result.failed.file}: ${result.failed.message}`);
      console.error(`${result.tables.length} tables were imported before it.`);
      process.exit(1);
    }
    const rows = result.tables.reduce((sum, t) => sum + t.records, 0);
    console.log(`\n${result.tables.length} tables, ${rows} rows, from client build ${cfg.realm.clientBuild}.`);

    // The row count is the cheap, complete check: it cannot catch a
    // mis-declared field name (that needs the world-DB comparison in
    // tools/dbc/verify.js), but it does catch a truncated or duplicated
    // import outright. It runs before writeMeta so a run that fails it
    // cannot leave dbc_import claiming a complete, timestamped import.
    const counts = await checkRowCounts(connection, result.tables.map((t) => ({ table: t.table, records: t.records })));
    const wrong = counts.filter((c) => !c.ok);
    for (const c of wrong) console.error(`${c.table}: ${c.actual} rows imported for ${c.expected} records`);
    if (wrong.length > 0) process.exit(1);

    await writeMeta(connection, result.tables, { clientBuild: cfg.realm.clientBuild });
  } finally {
    await connection.end();
  }
}
