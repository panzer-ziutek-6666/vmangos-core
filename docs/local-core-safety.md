# SQL shutdown outcomes, log privacy and world-state termination

This change set contains all local core fixes: fatal SQL/worker/service outcomes,
four command/chat log privacy fixes, and the world-state terminator fix. The
Windows operating tools and IIS panel are separate components.

## Behavior and review points

- A SQL worker initializes its MySQL client context on its own thread, drains
  accepted work before `mysql_thread_end`, and does not execute SQL after cleanup
  or after failed initialization. STOP before the loop and late arrivals are
  covered by the isolated regression suite.
- Every failed `_Query` attempt is classified, including the final allowed read
  attempt after reconnect. An unconfirmed write and error 1053 are not replayed.
  Failed commit remains a failed/uncertain outcome even if rollback is attempted.
  Fatal failures and abandoned queued work are observable in core/service exit
  results; handled duplicate/deadlock behavior is retained. There is no durable
  replay queue. The historical unconfirmed operation's effect remains unknown.
- `Chat.cpp` logs the resolved command name and a redaction marker instead of
  arguments; the skipped-command path omits the command text. RA omits the full
  received command line, SOAP records the account instead of the command, and
  invalid-link chat errors omit the rejected message body. Dispatch still receives
  the original command/message. Existing actor/account/IP context is not anonymized.
- This intentionally reduces diagnostics: logs cannot reconstruct exact command
  parameters, rejected content or parameter-dependent failures. Existing audit
  consumers that parse complete command strings must adapt. The change does not
  promise that every SQL/error log is free of sensitive content.
- `Player::SendInitWorldStates` skips the default zero sentinel and appends one
  final `(0, 0)` after zone/battleground/outdoor/war-effort states. The target's
  bot-cinematic guard and `Log::Player` spelling correction are preserved.

## Validation and its limits

The complete 15-production-file / 7-test-file source set was built out of source
on Windows x64 with MSVC v143 14.44.35207 and Windows SDK 10.0.26100.0. Configure,
full Release/link and the supervising process returned 0; mangosd/realmd EXE/PDB
GUID+Age identities matched. All 5,486 versioned build inputs were compared by
SHA256 before reusing this build for the PR. The embedded revision identifies the
reviewed `e8160a07e` parent, not the later publication commit. This document is an
additional noncompiled file.

The 24 C++ SQL/worker/service regression cases are reused only with matching
production and test inputs. See [the harness README](../tests/isolated-sql-outcome/README.md)
for actual compiled/extracted functions and explicitly substituted MySQL/SCM boundaries.
Those cases do not test the four loggers or client world-state behavior.

Separately, the complete built candidate passed an isolated DEV lifecycle with
real MySQL: readiness, graceful world/realm/MySQL stop, and measured native 0 for
world, realm and both MySQL processes before handle release. The two already
upstream SQL migrations were applied to cloned databases, with full primary-key
comparisons against preimages and independent checks of all four migration sets.
Tests of PowerShell comparison/migration tools are operational evidence, not
additional C++ test cases. No operational tool or database content is included here.

ClientSmoke=NOT_RUN. Linux build, client gameplay/audio verification, real 1053
fault injection, Windows reboot/PRESHUTDOWN and SCM recovery are not established
by this evidence. The complete updated candidate has not been deployed to production.
The earlier production R3 deployment stopped the old release and started R3; it
does not prove a production graceful STOP of R3 or any Windows reboot path.

## Separate handoffs

`src/shared/ServiceWin32.cpp` and the reproducible PowerShell C++ test runner are
part of this core PR. Machine-specific Windows controllers, Maintenance/intent,
SCM/task routing, collector/release registry and migration/rollback/DEV scripts
need a separate operational review and handoff. They cannot establish OS ordering
merely by being referenced here.

The local untracked `contrib/admin-panel/` is a distinct ASP.NET Core/IIS component,
not a core fix. Its docs still describe read-only scaffolding while its source
contains fixed control POST routes and Task Scheduler dispatch. It requires its
own coherent source/documentation/build/security review before publication; the
neighboring ZIP is also excluded. The active panel outside the core source tree
and the separate wow-ops repository must not be conflated with this snapshot.

No private configuration, credential, player data, dump, backup, executable or
diagnostic package belongs in this PR. No local core fix is left optional.
