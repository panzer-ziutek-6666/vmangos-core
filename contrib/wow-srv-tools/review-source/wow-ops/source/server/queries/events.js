// The schedule half of the Game events section. The live half - whether an
// event is running right now - exists only in mangosd's memory and is read with
// `.event list all`; see server/eventList.js and server/sections/events.js for
// how the two are merged, and why game_event.disabled is not the running state.
//
// game_event is keyed on `entry` alone, unlike map_template and quest_template,
// so this needs no highest-patch collapse. Its patch_min and patch_max columns
// are a filter the core applies at load time, not part of the key.
function quoteIdentifier(name) {
  return `\`${String(name).replaceAll('`', '``')}\``;
}

// occurence and length are minutes: the core renders them with
// secsToTimeString(value * MINUTE) (vmangos-core/src/game/Commands/
// ServerCommands.cpp:713-714). The field names here say so, because a bare
// `length` invites being read as seconds.
export async function listGameEvents(pools, config) {
  const pool = pools?.world;
  const worldDb = config?.mysql?.world?.database;
  if (!pool || !worldDb) return null;

  const [rows] = await pool.query(`
    SELECT entry, description, start_time, end_time, occurence, length,
           holiday, hardcoded, disabled, patch_min, patch_max
    FROM ${quoteIdentifier(worldDb)}.game_event
    ORDER BY entry
  `);

  return rows.map((r) => ({
    id: Number(r.entry),
    description: r.description ?? '',
    // '0000-00-00 00:00:00' comes back from mysql2 as null, and many rows hold
    // it: a hardcoded event legitimately has no scheduled window.
    startTime: r.start_time ?? null,
    endTime: r.end_time ?? null,
    occurrenceMinutes: Number(r.occurence),
    lengthMinutes: Number(r.length),
    holiday: Number(r.holiday),
    hardcoded: Number(r.hardcoded) === 1,
    disabled: Number(r.disabled) === 1,
    patchMin: Number(r.patch_min),
    patchMax: Number(r.patch_max)
  }));
}
