// The `.event` family. Its parent row in the command table is declared
// allowConsole = false (vmangos-core/src/game/Chat/Chat.cpp:1201), which looks
// like it should put the whole family out of SOAP's reach - but FindCommand
// descends into a child table without consulting the parent, and ExecuteCommand
// checks isAvailable only on the resolved leaf (Chat.cpp:1887). Every leaf in
// eventCommandTable is allowConsole = true (Chat.cpp:377-386), so all of these
// work. Verified live over SOAP on 2026-09-02.
import { assertEventId } from './validate.js';

// Without the literal "all" the handler prints only the events currently
// running (ServerCommands.cpp:643-645), which would leave the page unable to
// tell an inactive event from one that does not exist.
export function buildEventListAll() {
  return '.event list all';
}

// The info handler is the unnamed "" row of eventCommandTable (Chat.cpp:384),
// so the command is `.event <id>`.
export function buildEventInfo(id) {
  return `.event ${assertEventId(id)}`;
}

// Memory only, and temporary. StartEvent(id, true) sets the event's start to
// now and its end to now + length in RAM (GameEventMgr.cpp:90-95); nothing is
// written to game_event, so a restart reverts it, and GameEventMgr::Update
// stops the event again once `length` minutes have passed.
export function buildEventStart(id) {
  return `.event start ${assertEventId(id)}`;
}

// The mirror image: StopEvent(id, true) backdates the start so the event reads
// as finished (GameEventMgr.cpp:106-110). The scheduler starts it again at its
// next occurrence.
export function buildEventStop(id) {
  return `.event stop ${assertEventId(id)}`;
}

// These two persist: EnableEvent writes UPDATE game_event SET disabled
// (GameEventMgr.cpp:132) through the world server, which owns that table and
// its in-memory copy. A disable also stops the event if it is running.
export function buildEventEnable(id) {
  return `.event enable ${assertEventId(id)}`;
}

export function buildEventDisable(id) {
  return `.event disable ${assertEventId(id)}`;
}
