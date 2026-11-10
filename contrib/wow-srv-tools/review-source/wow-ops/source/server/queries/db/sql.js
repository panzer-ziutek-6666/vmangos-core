// The identifier quoter the Database section's query modules share. The four
// query modules that shipped before this section each carry their own copy;
// they are left alone rather than refactored, because rewriting working,
// reviewed code is not part of this change.
export function quoteIdentifier(name) {
  return `\`${String(name).replaceAll('`', '``')}\``;
}

// The world database is optional in config: a panel pointed only at `logon`
// still boots and still serves Accounts. Every caller in this section treats
// null as "render the explanatory note", never as an error.
export function worldSchema(config) {
  return config?.mysql?.world?.database ?? null;
}

// schema.table, quoted - zone.js, zones.js and faction.js each defined this
// verbatim (spell.js already had it); one copy now.
export function qualified(schema, table) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

// The reference schema (server/config.js's mysql.dbcSchema) always validates
// to a truthy name - it defaults to 'dbc' rather than staying unset - so a
// truthy dbcSchema is not proof the schema actually exists. It is built by
// tools/import-dbc.js, an offline step that may never have been run, or that
// documents itself as leaving a partial schema behind on a failed run. Either
// way the query for it fails with ER_NO_SUCH_TABLE (a missing table) or
// ER_BAD_DB_ERROR (the schema itself does not exist), not with an empty
// result set - the two error codes app.js's own setErrorHandler does not
// treat as a database read (ER_BAD_DB_ERROR is there for the *configured*
// databases, not an optional reference one), which is why an unguarded read
// here surfaced as a raw 500 with the driver's message.
export async function withMissingReference(fallback, run) {
  try {
    return await run();
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_DB_ERROR') return fallback;
    throw err;
  }
}

// A reference schema imported before this cycle's talent_tab columns
// (talent_tab.name/background/dbc_row, added by the talent calculator cycle) fails a read that
// selects them with ER_BAD_FIELD_ERROR, not ER_NO_SUCH_TABLE or
// ER_BAD_DB_ERROR - withMissingReference deliberately leaves that code alone
// (above), since a bad field in a query this panel wrote is usually a bug,
// not a missing import. The one caller-side fact that turns ER_BAD_FIELD_ERROR
// into "outdated, not a bug" is knowing the query reads only the optional
// reference schema - so this is a separate, narrow helper each such read
// wraps itself in, rather than a case withMissingReference itself grows.
export async function withOutdatedReference(fallback, run) {
  try {
    return await run();
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') return fallback;
    throw err;
  }
}
