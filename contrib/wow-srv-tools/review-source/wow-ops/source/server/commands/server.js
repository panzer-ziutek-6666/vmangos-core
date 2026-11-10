import { assertMessageText, assertShutdownDelay, assertPlimitValue, PLIMIT_NAME_LIST } from './validate.js';

// Command spellings from vmangos-core/src/game/Chat/Chat.cpp:955-1005,
// 1239-1240 and 1266. Every command below is allowConsole = true, which is
// what makes it reachable over SOAP at all (Chat.h:66).
//
// .server exit is deliberately absent. It is SEC_CONSOLE and would run
// (Chat.cpp:993), but nothing in this panel can start mangosd again, so
// there must be no builder that can produce it.

export function buildMotd() {
  return '.server motd';
}

export function buildSetMotd(text) {
  return `.server set motd ${assertMessageText(text, 'message of the day')}`;
}

export function buildAnnounce(text) {
  return `.announce ${assertMessageText(text)}`;
}

export function buildNotify(text) {
  return `.notify ${assertMessageText(text)}`;
}

export function buildSaveAll() {
  return '.saveall';
}

export function buildCorpses() {
  return '.server corpses';
}

export function buildResetAllRaids() {
  return '.server resetallraids';
}

export const PLIMIT_LEVELS = PLIMIT_NAME_LIST;

export function buildPlimit(value) {
  return `.server plimit ${assertPlimitValue(value)}`;
}

// All four take <delay> [exitcode]; the exit code is never passed, so the
// core's own default applies (SHUTDOWN_EXIT_CODE for the shutdowns,
// RESTART_EXIT_CODE for the restarts).
export const SHUTDOWN_KINDS = ['shutdown', 'restart', 'idleshutdown', 'idlerestart'];

export function buildShutdown(kind, delaySeconds) {
  if (!SHUTDOWN_KINDS.includes(kind)) {
    throw new Error(`shutdown kind must be one of ${SHUTDOWN_KINDS.join(', ')}`);
  }
  return `.server ${kind} ${assertShutdownDelay(delaySeconds)}`;
}

// Every subtable's "cancel" resolves to the same handler,
// HandleServerShutDownCancelCommand (Chat.cpp:950-973), so one spelling
// cancels a pending shutdown, restart, idleshutdown or idlerestart alike.
export function buildShutdownCancel() {
  return '.server shutdown cancel';
}
