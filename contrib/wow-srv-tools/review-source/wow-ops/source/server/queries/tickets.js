// gm_tickets lives in the characters database while the map name comes from the
// world database, so this runs on the characters pool and qualifies the world
// schema by name - the same cross-schema approach as server/queries/characters.js.
//
// Unlike the Game events section, SQL is authoritative here: every ticket
// command ends in GmTicket::SaveToDB() or TicketMgr::CloseTicket, which saves
// (vmangos-core/src/game/GMTicketMgr.cpp:401-410), so the panel never has to
// parse a command's output to know a ticket's state.
function quoteIdentifier(name) {
  return `\`${String(name).replaceAll('`', '``')}\``;
}

// assigned_to and closed_by hold character guids, so both are resolved against
// characters.characters. closed_by additionally carries two sentinels - 0 for
// open and -1 for a console close (GMTicketMgr.h:167) - which match no row and
// come back with a null name; server/ticketTypes.js reads them.
//
// map_template is keyed (entry, patch), so the join collapses each entry to its
// highest patch row, as everywhere else in this panel.
function selectSql({ charactersDb, worldDb, where }) {
  return `
    SELECT
      t.ticket_id, t.guid, t.name, t.message, t.create_time, t.last_modified_time,
      t.map, mt.map_name AS map_name,
      t.position_x, t.position_y, t.position_z,
      t.closed_by, t.assigned_to, t.comment, t.response,
      t.completed, t.escalated, t.viewed, t.ticket_type, t.security_needed,
      a.name AS assigned_to_name, c.name AS closer_name
    FROM ${quoteIdentifier(charactersDb)}.gm_tickets t
    LEFT JOIN (
      SELECT m1.entry, m1.map_name
      FROM ${quoteIdentifier(worldDb)}.map_template m1
      WHERE m1.patch = (
        SELECT MAX(m2.patch) FROM ${quoteIdentifier(worldDb)}.map_template m2 WHERE m2.entry = m1.entry
      )
    ) mt ON mt.entry = t.map
    LEFT JOIN ${quoteIdentifier(charactersDb)}.characters a ON a.guid = t.assigned_to
    LEFT JOIN ${quoteIdentifier(charactersDb)}.characters c ON c.guid = t.closed_by
    ${where}
    ORDER BY t.ticket_id DESC
  `;
}

function mapRow(r) {
  return {
    id: Number(r.ticket_id),
    guid: Number(r.guid),
    name: r.name,
    message: r.message ?? '',
    createTime: Number(r.create_time),
    lastModifiedTime: Number(r.last_modified_time),
    map: Number(r.map),
    mapName: r.map_name ?? null,
    positionX: Number(r.position_x),
    positionY: Number(r.position_y),
    positionZ: Number(r.position_z),
    closedBy: Number(r.closed_by),
    assignedTo: Number(r.assigned_to),
    assignedToName: r.assigned_to_name ?? null,
    closerName: r.closer_name ?? null,
    comment: r.comment ?? '',
    response: r.response ?? '',
    completed: Number(r.completed) === 1,
    escalated: Number(r.escalated),
    viewed: Number(r.viewed) === 1,
    ticketType: Number(r.ticket_type),
    securityNeeded: Number(r.security_needed)
  };
}

function schemas(pools, config) {
  const pool = pools?.characters;
  const charactersDb = config?.mysql?.characters?.database;
  const worldDb = config?.mysql?.world?.database;
  if (!pool || !charactersDb || !worldDb) return null;
  return { pool, charactersDb, worldDb };
}

export async function listTickets(pools, config, { includeClosed = false } = {}) {
  const ctx = schemas(pools, config);
  if (!ctx) return null;

  const where = includeClosed ? '' : 'WHERE t.closed_by = 0';
  const [rows] = await ctx.pool.query(selectSql({ ...ctx, where }));
  return rows.map(mapRow);
}

export async function getTicket(pools, config, id) {
  const ctx = schemas(pools, config);
  if (!ctx) return null;

  const [rows] = await ctx.pool.query(selectSql({ ...ctx, where: 'WHERE t.ticket_id = ?' }), [id]);
  return rows[0] ? mapRow(rows[0]) : null;
}
