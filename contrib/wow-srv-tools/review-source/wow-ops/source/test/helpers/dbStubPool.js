// A pool that answers by table name and remembers every call. Entity page
// loaders issue a dozen statements each; matching on the table is the only
// way to write an assertion that survives a harmless change to a SELECT list.
//
// `tables` maps a table name to the rows that statement should return. The
// first key whose name appears in the SQL wins, so put the more specific name
// first: 'npc_vendor_template' before 'npc_vendor'.
export function dbStubPool(tables) {
  const calls = [];
  const entries = Object.entries(tables);
  return {
    calls,
    // Named `world` so a caller can spread it: { world: dbStubPool(...) }
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });
        const hit = entries.find(([table]) => sql.includes(table));
        return [hit ? hit[1] : []];
      }
    },
    callsFor(table) {
      return calls.filter((c) => c.sql.includes(table));
    }
  };
}
