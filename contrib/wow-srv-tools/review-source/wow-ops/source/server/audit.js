import { DatabaseSync } from 'node:sqlite';

// Append-only, in its own file, deliberately outside every game database: the
// audit trail of a tool must not live inside what that tool can destroy. SOAP
// commands execute at SEC_CONSOLE, which is unrestricted, so this is the only
// record of what the panel did.

function sanitizeText(text) {
  // Replace NUL bytes with a visible escape so they do not silently truncate the stored text.
  return text.replace(/\0/g, '\\x00');
}

export function createAuditLog(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS actions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      at          TEXT    NOT NULL,
      section     TEXT    NOT NULL,
      action      TEXT    NOT NULL,
      command     TEXT    NOT NULL,
      status      TEXT    NOT NULL,
      ok          INTEGER NOT NULL,
      output      TEXT    NOT NULL,
      duration_ms INTEGER NOT NULL
    );
  `);

  const insert = db.prepare(`
    INSERT INTO actions (at, section, action, command, status, ok, output, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const select = db.prepare(`SELECT * FROM actions ORDER BY id DESC LIMIT ?`);

  return {
    record({ section, action, command, status, ok, output, durationMs }) {
      // A command may already have been sent to the server by the time this
      // is called (see server/sections/accounts.js) - a genuinely missing
      // command is still rejected, but anything else must be coerced to a
      // string and recorded rather than thrown away. The audit row must
      // never be the thing that fails after the server has already acted.
      if (command === undefined || command === null) {
        throw new Error('audit: command is required');
      }
      const commandStr = typeof command === 'string' ? command : String(command);
      if (commandStr.length === 0) {
        throw new Error('audit: command is required');
      }
      const at = new Date().toISOString();
      const sectionVal = sanitizeText(String(section ?? ''));
      const actionVal = sanitizeText(String(action ?? ''));
      const commandVal = sanitizeText(commandStr);
      const statusVal = sanitizeText(String(status ?? ''));
      const okVal = ok ? 1 : 0;
      const outputVal = sanitizeText(String(output ?? ''));
      const durationVal = Number(durationMs) || 0;

      try {
        const info = insert.run(at, sectionVal, actionVal, commandVal, statusVal, okVal, outputVal, durationVal);
        return Number(info.lastInsertRowid);
      } catch (err) {
        // Write failure: log to stderr and return null so the row is not lost in the log,
        // and the caller can tell the write did not land. The audit record survives in process logs.
        console.error(
          `audit: failed to record: at=${at} section=${sectionVal} action=${actionVal} command=${commandVal} status=${statusVal} ok=${okVal} output=${outputVal} duration=${durationVal}`,
          err
        );
        return null;
      }
    },
    recent(limit = 100) {
      return select.all(limit);
    },
    close() {
      db.close();
    }
  };
}
