import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMotd, buildSetMotd, buildAnnounce, buildNotify, buildSaveAll, buildCorpses,
  buildResetAllRaids, buildPlimit, buildShutdown, buildShutdownCancel,
  SHUTDOWN_KINDS, PLIMIT_LEVELS
} from '../server/commands/server.js';

test('message commands take the raw rest of the line, unquoted', () => {
  // HandleServerSetMotdCommand/HandleAnnounceCommand take args verbatim
  // (ServerCommands.cpp:46,55,325), so quoting would put literal quotes on
  // the player's screen.
  assert.equal(buildSetMotd('Welcome back'), '.server set motd Welcome back');
  assert.equal(buildAnnounce('Restart in 5 minutes'), '.announce Restart in 5 minutes');
  assert.equal(buildNotify('Restart in 5 minutes'), '.notify Restart in 5 minutes');
});

test('a quote in a message is fine, a newline is not', () => {
  assert.equal(buildAnnounce('the "big" patch'), '.announce the "big" patch');
  assert.throws(() => buildAnnounce('two\nlines'), /one line/);
  assert.throws(() => buildAnnounce('two\rlines'), /one line/);
  assert.throws(() => buildAnnounce(''), /message is required/);
  assert.throws(() => buildAnnounce('x'.repeat(256)), /255 characters/);
});

test('the argument-free maintenance commands are exactly their spellings', () => {
  assert.equal(buildMotd(), '.server motd');
  assert.equal(buildSaveAll(), '.saveall');
  assert.equal(buildCorpses(), '.server corpses');
  assert.equal(buildResetAllRaids(), '.server resetallraids');
});

test('plimit takes a named level or a non-negative number', () => {
  assert.deepEqual(PLIMIT_LEVELS, ['reset', 'player', 'moderator', 'gamemaster', 'administrator']);
  assert.equal(buildPlimit('reset'), '.server plimit reset');
  assert.equal(buildPlimit('gamemaster'), '.server plimit gamemaster');
  assert.equal(buildPlimit('40'), '.server plimit 40');
  assert.equal(buildPlimit('0'), '.server plimit 0');
});

test('plimit refuses a negative number, which the core reads as a security level', () => {
  // ServerCommands.cpp:352-360 stores a named level as its negation, so a
  // typed "-3" would silently mean "gamemasters only" instead of a count.
  assert.throws(() => buildPlimit('-3'), /player limit/);
  assert.throws(() => buildPlimit('lots'), /player limit/);
  assert.throws(() => buildPlimit(''), /player limit/);
});

test('the shutdown family takes a delay in seconds', () => {
  assert.deepEqual(SHUTDOWN_KINDS, ['shutdown', 'restart', 'idleshutdown', 'idlerestart']);
  assert.equal(buildShutdown('shutdown', '300'), '.server shutdown 300');
  assert.equal(buildShutdown('restart', '60'), '.server restart 60');
  assert.equal(buildShutdown('idleshutdown', '0'), '.server idleshutdown 0');
  assert.equal(buildShutdown('idlerestart', '86400'), '.server idlerestart 86400');
});

test('no second argument is ever passed, because it is an exit code and not a reason', () => {
  // ServerCommands.cpp:415-433: the optional second argument is an exit code
  // capped at 125. The spec called it a reason; it is not.
  assert.equal(buildShutdown('shutdown', '300').split(' ').length, 3);
});

test('the shutdown family rejects an unknown kind or a bad delay', () => {
  assert.throws(() => buildShutdown('exit', '5'), /shutdown kind/);
  assert.throws(() => buildShutdown('shutdown', '-1'), /delay/);
  assert.throws(() => buildShutdown('shutdown', '86401'), /delay/);
  assert.throws(() => buildShutdown('shutdown', '5.5'), /delay/);
  assert.throws(() => buildShutdown('shutdown', ''), /delay/);
});

test('one cancel covers every kind, because they share a handler', () => {
  assert.equal(buildShutdownCancel(), '.server shutdown cancel');
});

test('there is no way to build .server exit', () => {
  assert.ok(!SHUTDOWN_KINDS.includes('exit'));
  assert.throws(() => buildShutdown('exit', '0'), /shutdown kind/);
});
