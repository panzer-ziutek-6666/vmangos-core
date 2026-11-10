// Parses the output of `.event list all`. The console row format is "%d - %s %s"
// (mangos_string 1103), where the trailing state string is " [active]" (35) or
// " [inactive]" (317) - hence the doubled space in a real line. Descriptions are
// raw text out of game_event.description and may contain dashes and brackets,
// so the state marker is anchored to the end of the line and the description is
// whatever lies between.
//
// This is the one place the panel reads meaning out of prose. Anything that
// does not match the shape exactly is dropped rather than guessed at: an
// unparsed row shows up as an event whose live state is unknown, which the view
// reports honestly, while a mis-parsed one would put a wrong state beside a
// real event id.
const ROW = /^(\d+) - (.*?)\s*\[(active|inactive)\]$/;

export function parseEventList(output) {
  if (typeof output !== 'string') return [];

  const rows = [];
  for (const line of output.split('\n')) {
    const match = ROW.exec(line.trim());
    if (!match) continue;
    // A chat-format row (mangos_string 583) carries the client link markup the
    // console format never produces. A SOAP session is a console session, so
    // this cannot happen - and if it ever does, refusing the row keeps a
    // description full of markup out of the table.
    if (match[2].includes('|H')) continue;
    rows.push({
      id: Number(match[1]),
      description: match[2],
      active: match[3] === 'active'
    });
  }
  return rows;
}
