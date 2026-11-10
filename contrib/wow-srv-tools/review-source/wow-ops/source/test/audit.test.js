import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditLog } from '../server/audit.js';

test('records a successful action and reads it back', () => {
  const log = createAuditLog(':memory:');
  const id = log.record({
    section: 'accounts', action: 'create',
    command: '.account create Jaina hunter2',
    status: 'ok', ok: true, output: 'Account created: Jaina', durationMs: 42
  });
  assert.ok(id > 0);

  const [row] = log.recent();
  assert.equal(row.section, 'accounts');
  assert.equal(row.action, 'create');
  assert.equal(row.command, '.account create Jaina hunter2');
  assert.equal(row.status, 'ok');
  assert.equal(row.ok, 1);
  assert.equal(row.output, 'Account created: Jaina');
  assert.equal(row.duration_ms, 42);
  assert.ok(row.at, 'every row is timestamped');
  log.close();
});

test('records failures and timeouts too', () => {
  const log = createAuditLog(':memory:');
  log.record({ section: 'accounts', action: 'delete', command: '.account delete Nobody', status: 'failed', ok: false, output: 'There is no such account.', durationMs: 12 });
  log.record({ section: 'server', action: 'saveall', command: '.saveall', status: 'timeout', ok: false, output: 'No response within 10000 ms.', durationMs: 10000 });

  const rows = log.recent();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.status), ['timeout', 'failed'], 'newest first');
  log.close();
});

test('honours the limit', () => {
  const log = createAuditLog(':memory:');
  for (let i = 0; i < 10; i += 1) {
    log.record({ section: 's', action: 'a', command: `.cmd ${i}`, status: 'ok', ok: true, output: '', durationMs: 1 });
  }
  const rows = log.recent(3);
  assert.equal(rows.length, 3);
  // Verify the correct rows are returned (newest first: 9, 8, 7)
  assert.deepEqual(rows.map((r) => r.command), ['.cmd 9', '.cmd 8', '.cmd 7']);
  log.close();
});

test('rejects a record with no command', () => {
  const log = createAuditLog(':memory:');
  assert.throws(
    () => log.record({ section: 's', action: 'a', command: '', status: 'ok', ok: true, output: '', durationMs: 1 }),
    /audit: command is required/
  );
  assert.throws(
    () => log.record({ section: 's', action: 'a', command: undefined, status: 'ok', ok: true, output: '', durationMs: 1 }),
    /audit: command is required/
  );
  assert.throws(
    () => log.record({ section: 's', action: 'a', command: null, status: 'ok', ok: true, output: '', durationMs: 1 }),
    /audit: command is required/
  );
  log.close();
});

// server/sections/accounts.js can call record() with a command the server
// has already executed - e.g. when a route param resolves an ACTIONS lookup
// through Object.prototype (POST /accounts/constructor) and produces an
// object instead of a string. That command already reached the server, so
// audit.record must never throw once it has a genuine (non-empty) value -
// it must coerce to a string and record, not discard the row.
test('coerces a non-string command to a string instead of throwing', () => {
  const log = createAuditLog(':memory:');
  const id = log.record({
    section: 'accounts', action: 'constructor',
    command: { toString() { return '[object Object]'; } },
    status: 'ok', ok: true, output: '', durationMs: 1
  });
  assert.ok(id > 0);

  const [row] = log.recent();
  assert.equal(row.command, '[object Object]');
  log.close();
});

test('sanitises NUL bytes in all text fields, preserving surrounding characters', () => {
  const log = createAuditLog(':memory:');
  const id = log.record({
    section: 'acc\x00ounts', action: 'cr\x00eate',
    command: '.account\x00 create test password',
    status: 'o\x00k', ok: true, output: 'Account\x00created', durationMs: 10
  });
  assert.ok(id > 0);

  const [row] = log.recent();
  assert.equal(row.section, 'acc\\x00ounts', 'NUL in section is escaped');
  assert.equal(row.action, 'cr\\x00eate', 'NUL in action is escaped');
  assert.equal(row.command, '.account\\x00 create test password', 'NUL in command is escaped');
  assert.equal(row.status, 'o\\x00k', 'NUL in status is escaped');
  assert.equal(row.output, 'Account\\x00created', 'NUL in output is escaped');
  log.close();
});

test('does not throw when the log is closed; returns null and logs to stderr with timestamp', () => {
  const log = createAuditLog(':memory:');
  log.close();

  // Capture console.error calls
  let errorCalls = [];
  const originalError = console.error;
  console.error = (...args) => {
    errorCalls.push(args);
  };

  try {
    const result = log.record({
      section: 'accounts', action: 'delete',
      command: '.account delete test',
      status: 'ok', ok: true, output: 'Deleted', durationMs: 5
    });

    assert.equal(result, null, 'returns null on write failure');
    assert.equal(errorCalls.length, 1, 'logs to stderr exactly once');
    const errorMsg = errorCalls[0][0];
    assert.match(errorMsg, /audit: failed to record/);
    assert.match(errorMsg, /at=\d{4}-\d{2}-\d{2}T/, 'includes timestamp in ISO format');
    assert.match(errorMsg, /section=accounts/);
    assert.match(errorMsg, /action=delete/);
    assert.match(errorMsg, /command=.account delete test/);
  } finally {
    console.error = originalError;
  }
});
