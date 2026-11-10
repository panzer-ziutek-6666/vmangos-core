# wow-ops operator guide

The detailed guide to running wow-ops against a VMaNGOS realm: setup, what every section does,
the server behaviours it works around, and troubleshooting. For a short overview, the stack and a
quick start, see [README.md](README.md).

wow-ops is an operations panel for a VMaNGOS realm. It is a small server-rendered web app: reads
come from the realm's MySQL databases, and writes (creating an account, changing a GM level,
banning a player, and so on) are sent to the running `mangosd` as GM commands over its SOAP
interface, one at a time. Every command sent is recorded in `audit.sqlite`.

## Prerequisites

Before starting the panel, you need three things running or in place. Paths below are given
relative to the **server directory** — the VMaNGOS install directory that holds `mangosd`,
`mangosd.conf` and the bundled MySQL.

- **Node 24 or later.**
- **MySQL running**, with the realm's databases (by default `realmd`, `characters`, `mangos`
  and `logs`).
- **`mangosd` running, with SOAP enabled.** The panel talks to `mangosd` over SOAP for every
  write; without it running (and without SOAP turned on), the panel still starts and its
  read-only views still work, but every command shows the server as unreachable.

## Enabling SOAP

SOAP is off by default. To turn it on, edit the SOAP block of `mangosd.conf` in the server
directory and set:

```
SOAP.Enabled = 1
SOAP.IP = 127.0.0.1
SOAP.Port = 7878
```

Leave `SOAP.IP` and `SOAP.Port` at those values unless you have a specific reason to change
them — they are what `config.json` points at by default. This setting is read only at startup,
so after changing it you must restart `mangosd`; toggling it while the server is already running
has no effect until the next restart.

## The panel's game account

The panel authenticates to SOAP as a real game account, and that account must hold
`SEC_ADMINISTRATOR`, which in VMaNGOS is **gmlevel 6** (not 4 — the `AccountTypes` enum in
upstream MaNGOS numbers levels differently than VMaNGOS grants them). GM level does not live in
`account.gmlevel`, which is vestigial in VMaNGOS; it lives in `account_access`, keyed by
`(id, RealmID)`. Checking `account.gmlevel` instead of `account_access` will tell you the wrong
thing about who can use the panel.

To list accounts that already qualify, run this read-only query against `realmd`:

```sql
SELECT a.username, aa.gmlevel
FROM realmd.account a
JOIN realmd.account_access aa ON aa.id = a.id
WHERE aa.gmlevel >= 6;
```

If nothing comes back, grant gmlevel 6 on `account_access` to an account before configuring the
panel with it.

**Give that account a strong password of its own.** Its password is the only thing between
`mangosd`'s SOAP port and unrestricted console authority: SOAP authenticates each request with
HTTP Basic credentials over plain HTTP, and the panel keeps them in `config.json`. Use an account
nobody plays on, and a password nobody else uses. The core caps it at 16 characters
(`MAX_ACCOUNT_STR`, `vmangos-core/src/game/AccountMgr.h:47`) and upper-cases it before hashing it
(`AccountMgr.cpp:50-51`), so letter case adds nothing. Length, digits and symbols do; spaces and
quotes are refused. To change it, run `.account set password <account> <new> <new>` from the
`mangosd` console, then put the new value in `soap.pass`. The panel's own Accounts section can
send the same command, but the panel then stops working until `config.json` is updated. Keep
`SOAP.IP` at `127.0.0.1`, so the port is not reachable from other machines.

## Configuration

1. Copy the example config: `cp config.example.json config.json`.
2. Fill in `soap.user` and `soap.pass` with the account from the previous step. The example file
   ships both as the placeholder `CHANGEME`; the panel refuses to start while either field still
   says that.
3. `realm.id` defaults to `1`. Change it only if the realm is registered under a different
   realm ID in `realmd.realmlist`.
4. `realm.wowPatch` must match `WowPatch` in `mangosd.conf` (0-10). It tells the panel which
   game_event rows are excluded by the content patch the realm runs, so the Game events
   section can distinguish excluded events from deliberately disabled ones.
5. `realm.clientBuild` must match `SUPPORTED_CLIENT_BUILD` in the core's CMake configuration
   (default 5875 for 1.12.1). The Database section uses it when querying template tables keyed
   by build, so looking up a faction name or spell name pins the client version.
6. `realm.talentRate` must match `Rate.Talent` in `mangosd.conf` (default 1). The talent
   calculator uses it to size a tree's level-60 total and the level it reports a build needs;
   get it wrong and the calculator shows a total or a required level the running server would
   not agree with.
7. `events.wowPatch` is a deprecated alias for `realm.wowPatch`, kept so an existing
   `config.json` keeps booting. If both are present, `realm.wowPatch` wins. New configs should
   use only `realm.wowPatch`.
8. Of the four database sections under `mysql`, only `logon` is required to start the panel —
   it is what the Accounts section and the login-account lookups above run against. The other
   three (`characters`, `world`, `logs`) are optional; sections that need them (for example, the
   bot count on the status strip, which reads `characters`) simply degrade to showing nothing for
   that figure if the corresponding section is left out of `config.json`.
9. `terrain.mapsDir` is the server's extracted `maps` directory. Only a zone page's spawn lists
   (`/db/zone/:id`) read it, to place NPCs and objects the way the core itself would; left out, a
   zone page still renders, with a note where the spawn lists would be instead of failing.
10. `config.json` is gitignored — it holds a plaintext credential and must never be committed.

The Database section's icons, map art, item sets, skills, zones and talent trees come from the
client's own files, loaded by two offline tools described further down: `npm run import-dbc` (the
reference schema) and `npm run extract-art` (the art). Run both once after setup, and again after
updating wow-ops, since a newer version may import more tables or extract more art. Neither is
needed for the operator sections.

## Running it

```
npm install # first time only
npm start
```

Then open <http://127.0.0.1:8420>. The panel binds to `127.0.0.1` only, and it also rejects any
request whose `Origin` or `Host` header doesn't match its own address and port — so it is
reachable only from a browser running on this same machine, on that port.

## What you can do in it

- **Accounts** — create an account, set its GM level, set its password, ban it, unban it, or
  delete it. Every action shows the exact command sent before you confirm and the server's raw
  response after.
- **Server** — the message of the day, chat and on-screen broadcasts, the maintenance
  commands, the shutdown family, and the realm registry.
- **Characters** — search the character list, open one character, and run the moderation,
  mail and deleted-character commands against it.
- **Game events** — every game event with its live state and schedule, per-event start and stop,
  and a guarded enable/disable pair.
- **Tickets** — the GM ticket queue, one page per ticket, and the whole `.ticket` command family
  that SOAP can reach.
- **Audit log** (`/audit`) — the last 200 actions taken through the panel, with the command sent,
  its status, and how long it took.

### Bots

Read-only. Bot accounts and online bot characters are counted separately —
one bot account drives several bots at once, because a module bot is a
`Player` object without a network session, so the two figures differ by a
large factor and are never summed.

The location breakdown comes from `characters.characters`, which mangosd
writes only on the player-save timer, so it is a snapshot up to
`bots.playerSaveIntervalMs` (default 15 minutes) old. The counts are not:
`characters.online` moves at login and logout.

The section has no controls. `.bot start|stop|reload|add|delete` drive the
core's native `PlayerBotMgr`. A realm whose bots come from a separate module
does not run that manager, so those commands would report success and change
nothing; a core change would be needed before real controls are possible.

The location breakdown queries the `characters`, `logon` and `world`
databases by name from a single pool (`characters.characters` joined against
`logon.account` and `world.map_template`) rather than opening a connection
to each. That only works when all three live on the same MySQL server under
credentials that can see all three schemas; point `world` at a different
host, or give each database its own least-privilege user, and the panel
degrades correctly (the breakdown shows a raw driver error instead of taking
the page down) but without a clearer explanation of why.

### Server

Two halves that work quite differently.

**The running server, over SOAP.** Read or set the message of the day, announce to chat, put a
notification on everyone's screen, save all players, expire old corpses, set the player limit,
reset every raid instance, and shut the server down or restart it. Four things are worth knowing
before using them:

- **A MOTD set here is lost at the next restart.** `.server set motd` only assigns the string in
  memory; nothing writes it back to `mangosd.conf`, and the server rebuilds the MOTD from the
  `Motd` config value every time it starts.
- **The player limit doubles as a lockout.** A number caps how many may be online, but one of
  `player`, `moderator`, `gamemaster` or `administrator` sets the minimum security level instead —
  and raising it immediately kicks everyone below it, bot characters included. `reset` restores
  the configured limit.
- **Shutdown, restart, idle shutdown and idle restart each need their own word typed in.** They
  differ only in the exit code and in whether they wait for the server to empty first. Nothing in
  this panel relaunches `mangosd`, so a restart is a shutdown here unless a wrapper script is
  watching the exit code. One Cancel button covers all four.
- **`.server exit` is deliberately absent.** SOAP can reach it, and it would stop the server
  instantly with nothing able to bring it back, so there is no code path in the panel that can
  produce that command.

**The realm registry, over SQL.** This is the one place the panel writes to MySQL instead of
sending a command, because no GM command edits `realmd.realmlist` and `mangosd` never reads that
table — `realmd` does, re-polling it on its own timer, so an edit takes effect without restarting
anything. Realm rows can be added, edited and deleted, and every write is recorded in the audit
log with a `SQL realmlist ...` description. Two consequences:

- **Adding a realm does not start a server.** A `realmlist` row is an advertisement. A row
  pointing at an address where no `mangosd` is listening simply fails to connect.
- **The registry keeps working while `mangosd` is down**, unlike everything else on the page —
  which is exactly when a realm row usually needs fixing.

Field validation mirrors what `realmd` itself accepts, because a row it dislikes is not reported
anywhere the panel can see: an address that does not resolve, a subnet mask with a hole in it, or
a realm flag outside the four it keeps will make `realmd` skip or silently rewrite the row,
leaving a realm that looks configured here and is missing from the client's realm list.

The realm type dropdown is not a guess at a convention. The core passes the value straight to the
client, and the client resolves it through `Cfg_Configs.dbc` — read out of the 1.12.1 client —
into the PvP and RP booleans its realm list displays: 0, 2, 4 and 9 are
Normal; 1, 3, 5 and 10 are PvP; 6 and 7 are RP; 8 is RP PvP. Anything outside that range displays
as Normal.

The zone dropdown shows which realm-list tab the choice actually produces on a 1.12 client, which
is not one tab per zone: `realmd` collapses most zones onto the same category for a Classic
client.

### Characters

The list hides bot characters by default and is capped at a hundred rows; the search box matches
a name as a prefix. Location comes from `characters.map` and `characters.zone`, which `mangosd`
writes only on the player save timer (`PlayerSave.Interval`, fifteen minutes by default), so it is
labelled *as of the last save* everywhere it appears. The online column is written at login and
logout and is accurate to the second.

Four of the commands work only while the character is in the world, because the core resolves
their target with the form of `ExtractPlayerTarget` that never looks in the database: `.kick`,
`.repairitems`, `.send message` and `.character reputation`. The panel disables those four for an
offline character rather than offering an action that can only answer "Player not found".

Three commands do something other than their name suggests, and the page says so:

- **`.character rename` does not rename.** It sets the rename flag; the player chooses a new name
  at their next login.
- **`.ban character` bans the owning account**, found through the character, and applies it in the
  background. The server returns no output on success, so an empty result there means accepted,
  not failed.
- **`.character deleted restore` and `delete` act on every match** of the prefix search, up to the
  fifty rows the core itself returns — not on one character. Both, like `.character erase` and the
  three mass sends, need the value typed back before the panel will send them.

`.send items` carries one item stack per mail: `MAX_MAIL_ITEMS` is 1 in this core, despite the
handler's own comment describing twelve.

The deleted-characters page stays empty, and says why, while `mangosd.conf` sets
`CharDelete.Method = 0`, which removes a deleted character's row outright, so `deleted_name` is
never written and there is nothing to restore. Set it to 1 to keep deletions recoverable, and
record that in `characters.charDeleteMethod` in `config.json` so the page stops explaining an
empty list.

Commands that exist but are deliberately absent: `.character race`, `.skin`, `.fillflys`,
`.aiinfo` and the `.character clean` pair. They are reachable over SOAP but are not moderation.
Commands that cannot be reached at all, because their `allowConsole` flag is false, are never
rendered: `.additem`, `.levelup`, `.modify money`, `.tele`, `.pinfo`, `.whispers`, `.unstuck`.

### Game events

The page merges two sources, because neither answers the whole question. `mangos.game_event`
holds the schedule, the occurrence and length (both in **minutes**), the hardcoded flag and the
persisted `disabled` flag. Whether an event is running right now exists only in `mangosd`'s
memory, and is read with `.event list all`. When the server cannot be reached the schedule still
renders and every state reads *unknown* — never *inactive*, which would be a claim the panel
cannot support.

`game_event.disabled` is not the running state. At load, the core force-disables any event whose
`patch_min`..`patch_max` range excludes the running `WowPatch`, and it does that in memory
without touching the column. Tell the panel which patch the realm runs with `realm.wowPatch` in
`config.json` (from `WowPatch` in `mangosd.conf`) and those events are flagged *excluded by
patch*. With the stock world database at patch 10 that is 16 events, on top of the 17 the column
marks disabled.

The two pairs of commands differ in kind, and the page keeps them apart:

- **Start and stop are temporary.** They rewrite the event's start and end in memory only; nothing
  reaches the database, so a restart undoes them. A started event also ends by itself once its
  *lasts* duration has passed, because the scheduler re-checks every event against its schedule.
- **Enable and disable persist.** `mangosd` writes `game_event.disabled` itself, so the change
  survives a restart, a disable stops a running event, and a disabled event is never started by
  the scheduler. Both need the event id typed back before the panel will send them.

A hardcoded event is marked as such: those carry their own update logic in the core, so a manual
start or stop behaves differently for them than for a scheduled event.

**A flag says what the scheduler will do with an event, not whether it is running.** An event
marked disabled or excluded by patch can still be active, because `GameEventMgr::StartEvent`
checks only that the event exists and never consults the disabled flag, and the hardcoded driver
events call it directly. With the stock world database at patch 10, event 22 (AQ War Effort) is both excluded by patch 10 and
active for exactly that reason. The state column is the authority; the flags are the reasons
behind it. The scheduler will not start such an event on its own, and `.event start` refuses one
that is disabled — but another event can start it.

### Tickets

The list and the detail page are read from `characters.gm_tickets`; unlike the game events, the
database is authoritative here, because every ticket command ends in a save. `closed_by` is four
states in one column, so the panel spells them out: open, closed from a console, *the player
withdrew it* (the creator's own guid), or closed by a named GM.

**The console overrides the assignment rules.** `close`, `complete` and the response commands each
skip their "must be assigned to you" check when there is no player behind the session, so the panel
can work any ticket without an in-world GM. The flip side is that `.ticket assign` needs an explicit
GM character name — it normally defaults to the GM who typed it, and the panel is not a character.
A close from the panel is recorded against the console, not against a GM.

Three things the server does that the page warns about, all found by driving a real ticket:

- **Completing is a one-way door.** A completed ticket can no longer be closed (the server calls it
  archived) and cannot be deleted either, because deleting requires a *closed* ticket. It leaves the
  queue only when the player acknowledges the response in their client. Close a ticket you want gone.
- **`.ticket reload <id>` works once per ticket per server run.** The core records which ids it has
  been asked to reload and never clears that record, so every later reload answers "added to reload
  list" and does nothing. Restarting `mangosd` is the only reset.
- **Append and append-line differ at the end, not the start.** `appendln` writes the text and *then*
  a line break, so it terminates a line rather than beginning one; two plain appends run together
  with no separator.

Five ticket commands cannot be reached over SOAP at all and are never rendered: `escalate`,
`counter`, `next`, `previous` and `notify`. Two more affect the whole realm and each need a typed
phrase: `.ticket reset` deletes every ticket and resets the id counter (the server refuses it while
any ticket is open), and `.ticket togglesystem` turns ticket filing on or off for everyone and lives
in memory only, so a restart re-enables it.

### Database

Read-only, in the strictest sense the panel has: this section issues `SELECT` against the
`world` database and nothing else. Unlike every other section, it sends no command to `mangosd`
over SOAP and writes no row to `audit.sqlite` — there is nothing for the audit log to record,
because nothing here is an action taken against the running server.

It searches and cross-links `creature`, `item`, `quest`, `gameobject`, `spell`, `zone` and `faction`
templates, starting from `/db`. A name search groups its matches by kind — the zone group, labelled
"Zones and areas", covers every `area_template` row the name matches, continents and sub-areas
alike, since a sub-area has its own zone page too; a term that is all digits is instead looked up as
an exact id in every kind at once, rather than searched by name. What it shows for a given entry is **the row the running server would have loaded, not
every row that matches that id in the table.** `creature_template`, `item_template`,
`quest_template` and `gameobject_template` are all keyed `(entry, patch)`: an entry can carry
several rows, one per content patch it changed in, and the core does not read them with a plain
`WHERE entry = ?`. `SQLStorageLoaderBase::LoadProgressive` takes, per entry, the row with the
highest `patch` not above `sWorld.GetWowPatch()`
(`vmangos-core/src/shared/Database/SQLStorageImpl.h:364`), and this section reproduces that same
query rather than a naive lookup. An entry with more than one patch row is exactly where a
hand-written `SELECT` goes wrong, so the page names every patch that entry has and marks which
one was actually loaded, instead of silently picking one.

**Items are also browsable, not just searchable.** `/db/items` is a paged listview, filterable by
name, quality, class, equip slot, and required-level and item-level ranges, through the form the
page renders (`server/views/db/itemList.js`). Choosing a class adds a subtype control for that
class, and changing the class clears the subtype chosen under the old one, since a subtype id
means something different under each class. Sortable on any column whose header offers it, in
either direction. Every filter, sort and page
number lives in the URL's own query string — the form submits through htmx but pushes the URL on
each change, so a filtered, sorted view can be bookmarked, reloaded or shared as a plain link, and
the browser's back button steps back through the filter history rather than leaving the page. `GET
/db/items` renders that whole page; the same route answers an htmx request (one asking for just the
listview fragment) with only the table and its pager, which is what a filter or sort or page change
actually fetches. `/db/itemsets` lists every item set the client defines; each links to
`/db/itemset/:id`, which shows the set's members, its bonuses, and its required skill if it has one
— membership there comes from `item_template.set_id` on the world side, not from the set table
itself. The bonuses read as the client writes them, "(2) Set: +200 Armor.", from each bonus
spell's own substituted description, linked to the spell with its hover card. Hovering an item's
name anywhere it is linked (the items listview, a set's member list, an item page's own
cross-links) fetches its tooltip once from `/db/tooltip/item/:id` and swaps it in next to the name;
hovering the same name again does not ask a second time.

**NPCs and objects are browsable the same way.** `/db/npcs` lists creature templates with their
level range, rank, type, faction, the map they spawn on and how many spawns they have, filterable
by name, faction name, rank, type and a level range. `/db/objects` lists gameobject templates with
their type, lock id, whether they carry loot, whether they need a quest, their map and spawn count,
filterable by name, type, "locked" and "has loot". Both work like the items listview: htmx
filtering with the URL pushed, sortable headers, and a hover card on every name, from
`/db/tooltip/creature/:id` and `/db/tooltip/gameobject/:id`. A card reads only the template row,
so it shows the raw faction template id rather than the name the listview joins in. Neither
listview has icons, because the client ships no flat icon art for creatures or objects, only 3D
models.

A gameobject's lock id, loot id and quest id sit in a different `data` slot for each type, so each
column reads the slot the row's own type uses: the lock the core's `GetLockId` would return, the
loot `GetLootId` would return (chests and fishing holes only), and a positive quest id where the
type's struct names one (`server/queries/db/gameobjectFilters.js`). A creature's spawn count and
map are the same patch-bounded, five-column spawn match the creature page itself uses, so the two
never disagree.

The creature, gameobject, item and quest pages all render inside this browser's own layout, not
the operator panel's, so no page in this section sends anything to `mangosd`; each links back to
its own listview. Every item link on a listview or an entity page — a loot table, a vendor's
stock, a container's contents, a quest's rewards — is now coloured by that item's real quality,
the same colours the items listview and an item's own page title already used (a plain `/db`
search result still links by id and name only; see below).

**Quests are browsable too.** `/db/quests` lists quest name, quest and required level, races
(Any, Alliance, Horde or Mixed, from `RequiredRaces`), category, type, and the rewards column:
fixed item rewards, then the choice-of rewards, then XP and money — each item reward with its own
quality-coloured link and icon. The races column and filter describe the race restriction only
(`RequiredRaces`, tested by `Player::SatisfyQuestRace`,
`vmangos-core/src/game/Objects/Player.cpp:13726-13742`); a quest open to every race may still be
given only by one side's NPCs, since the giver's own faction is a separate check this panel has
no way to show here. It filters by name, races, type, category, and quest-level and
required-level ranges, and sorts on name, level, required level or entry. A quest level of 0
means the taking player's own level, not level zero
(`Player::GetQuestLevelForPlayer`, `vmangos-core/src/game/Objects/Player.h:1129`), and is shown as
"player's level" everywhere the level appears. The category select groups its
options rather than listing every id flat: the two continents and "Dungeons and raids" (by the
zone's own `area_template.map_id`), "Other zones" for a zone that `area_template` does not name,
then "Class", "Profession" and "Seasonal and other" for the negative values that mean a quest sort
rather than a zone. A zone's name in that select, and in the category column, comes from the
world database's own `area_template`; a sort's name and group come from the core's own
`QuestSort` enum (`vmangos-core/src/game/SharedDefines.h:886-920`), reproduced in this panel
since the world DB has no table for it. XP and money are shown as the row's base values, not
what a character would actually receive: `RewXP` is the full award up to five levels above the
quest (`Quest::XPValue`, `vmangos-core/src/game/QuestDef.cpp:180-200`), scaled by the server's own
quest XP rate and given only below the level cap — a character already at the cap is paid money
instead (`vmangos-core/src/game/Objects/Player.cpp:13370-13376`); a positive `RewOrReqMoney` is
scaled by the server's own money rate at hand-in
(`QuestDef.cpp:204-209`) — the listview says so next to the numbers rather than trying to
reproduce the server's rate. Hovering a quest link on a listview or an entity page — the
quests listview, a creature's or gameobject's quest list, another quest's chain — fetches its card
once from `/db/tooltip/quest/:id`, the same one-card-at-a-time, fetch-once behaviour as the item,
creature and gameobject hover cards.

Icons and item set names both come from offline tooling described further down (**Offline art
tools** and **DBC reference importer**), and neither is required to browse items. Run neither, and
`/db/items` still lists and filters every row — each just keeps an empty icon frame where its image
would be, with a note that no extracted art was found — and `/db/itemsets` shows a note that the
reference schema may not be built, rather than failing either page outright.

The section exists to get right a set of traps that a one-off `SELECT` gets wrong, all found
while building it:

- **Loot is keyed on `loot_id`, not `entry`.** A creature's loot table is
  `creature_template.loot_id`, and in the stock world database 21 creature templates have a `loot_id` that
  differs from their own `entry` — looking up loot by the creature's id instead would show the
  wrong table, or none.
- **Reference loot is followed both ways.** A loot row with a negative `mincountOrRef` is not an
  item; it points at a shared entry in `reference_loot_template`, and the page expands that
  reference in place, the way `LootTemplate::Process` does at runtime. From an item page, "dropped
  by" walks the same link backwards to find every creature or gameobject whose loot table reaches
  that item through a reference.
- **A chest's loot table lives in `data1`, not a dedicated column.** `gameobject_template` stores
  its type-specific fields in a generic `data0..data23` union; only two types (`chest` and
  `fishinghole`, both `GAMEOBJECT_TYPE`s 3 and 25) put a loot id in that union, and both put it in
  slot 1. Every other type's `data1` is something else entirely, so the page only treats it as a
  loot id for those two types.
- **A spawn can sit in any of five id columns.** The `creature` table has `id`, `id2`..`id5`, and
  the server spawns from whichever one is set; only `id` is indexed, so a lookup restricted to it
  silently misses every row spawned through `id2`..`id5` — in the stock world database that is over 13,000 rows
  out of 66,243. The page checks all five and says which one matched. `gameobject` has just one
  `id` column, so its lookup is a plain equality.
- **There are no zone names in the spawn tables.** Neither `creature` nor `gameobject` stores a
  zone or area id — only `map` plus x/y/z coordinates. Naming a zone from those needs the
  server's extracted terrain files, which SQL cannot derive, so an NPC or object page shows the map
  and coordinates; the zone pages (below) do resolve spawns to zones, through those terrain files.
- **`faction`, `faction_template` and `spell_template` are keyed by client build, not by patch.**
  Same shape as the `(entry, patch)` tables — the core loads the row with the highest `build` not
  above `SUPPORTED_CLIENT_BUILD` — but keyed on `build` instead, and in `faction`'s case on `id`
  rather than `entry`. An exact-build match would be wrong far more often than right: in the
  stock world database only 1,003 of 22,381 distinct `spell_template` entries carry a row at build
  5875, so the other ~95% need the same "nearest earlier build" fallback.
- **Quest reward reputation and creature/gameobject faction come from two different tables.** A
  creature's or gameobject's `faction` column is a `faction_template` id, resolved through that
  table to the underlying `faction` row. A quest's `RewRepFaction1..5` is a plain `faction`
  (`Faction.dbc`) id already, read straight — joining it through `faction_template` the way the
  other two are resolved would land on the wrong row.

**Spells are browsable too, and every other page now links into them.** `/db/spells` lists name
(with its icon and rank subtext), level, school, the skill line that teaches it, cast time and
cooldown, filterable by name, class, skill, school and a level range, and sortable on name, level
or entry. By default it shows only spells a skill line actually teaches — that is, an entry that
`skill_line_ability` names at the configured client build — because most of `spell_template`'s
rows are never learnable: creature abilities, item procs, quest triggers and the like, which
would otherwise swamp a plain search. Ticking "every spell" drops that filter and searches the
whole table. The class filter matches a spell whose `skill_line_ability.class_mask` is 0 (no
class restriction beyond what the skill line itself implies) or includes the chosen class's bit.
Hovering a spell's name anywhere it is linked fetches its card from `/db/tooltip/spell/:id` once,
exactly like the item, creature, gameobject and quest cards.

A spell's own page (`/db/spell/:id`) adds a summary line (level, school, cast time, cooldown,
range, duration and cost, each part dropped when the spell has nothing to say there), its full
effect list (effect, aura, amount, radius, target and any triggered spell), reagents and totems,
every skill line and trainer that teaches it, and every item that casts or teaches it — a
recipe, plan or tome does not name the spell it teaches directly, so it is matched the same way
a trainer row is, through the Learn Spell effect it casts.

**Descriptions are substituted, not shown raw.** `spell_template.description` and
`.auraDescription` carry `$`-tokens the client itself expands at display time — `$s1` for an
effect's magnitude, `$d` for its duration, `$o` for a damage-over-time total, `$t` for a tick
interval, `$a`/`$r` for radius and range, and a handful more the realm's own data actually uses.
This panel expands the common set the same way, following the core's own arithmetic rather than
a third-party parser's: an effect's value is `EffectBasePoints` plus `EffectBaseDice` when
`EffectDieSides` is 0 or 1, otherwise a roll between the two
(`vmangos-core/src/game/Objects/SpellCaster.cpp:1162-1189`). A token this panel does not handle,
or one whose underlying value genuinely is not there — an `$o` on an effect with no tick
amplitude, say — is left exactly as written rather than guessed at or dropped; the output is
plain text, escaped once at render, never re-interpreted as HTML.

**Rage is the one power shown scaled down from what the row stores.** A rage pool is created at
1000 internally against 100 for energy or focus (`vmangos-core/src/game/Objects/Unit.cpp:8321-8322`),
so `spell_template.manaCost` for a rage-costing spell is itself stored in tenths of the number the
client shows — the hover card and the spell page both divide by ten before printing "N Rage", so
what is on screen always matches what the game client would show, not the raw column.

`/db/skills` lists every skill line the reference schema knows, grouped the same way the spells
page's own skill filter groups them (class skills, professions, secondary skills, weapon skills,
armor proficiencies, languages, then everything else). Each line's own page
(`/db/skill/:id`) lists what it teaches at the configured build: the spell, the skill-up range it
trains between (`min_value`–`max_value`, the same two values the core's own skill-gain chance is
computed from), when it is auto-learned rather than trained (`req_skill_value`, shown only when
`learn_on_get_skill` is set), which classes and races it is restricted to, and what supersedes it,
if anything.

Every item, creature and quest page now links its spells the same way it already linked items,
creatures and quests: an item's on-use or on-equip spells, a trainer creature's taught spells,
and a quest's cast-on-accept objectives and reward spell all carry a link to that spell's page and
its hover card.

**Zones and factions are browsable too, and every page that names one now links to it.** `/db/zones`
lists the two continents' mapped zones — from the reference schema's `world_map_area`, joined to
`area_template` for the zone's own name and side — and, grouped as Dungeons, Raids and
Battlegrounds, every instance map that has at least one zone to show. A zone's own page
(`/db/zone/:id`) shows its side, its sub-areas if it has any or the zone it belongs to if it is one,
its level range (from the NPCs placed inside it), its quests (`quest_template.ZoneOrSort`), and, when
the reference schema has a world-map rectangle for it, that map with a dot for every NPC and object
spawn. The map is drawn fully explored: over the parchment tiles, every texture the client paints
for an explored area (`WorldMapOverlay.dbc`, `vmangos-core/src/game/Database/DBCStructure.h:752-768`),
each laid out tile by tile from its offset and cropped to its size the way the client's world map
frame does. A sub-area always shows its *zone's* side, never a column of its own: the core
switches on the zone's team alone when it moves a player between PvP zones (`Player::UpdateZone`,
`vmangos-core/src/game/Objects/Player.cpp:6796-6811`), so a sub-area with no team of its own still
has to show the value the core actually acts on.

Neither `creature` nor `gameobject` stores a zone or area id of its own, the same gap the NPCs and
objects trap above describes — so the zone page fills its spawn lists the way the core itself would:
for every spawn on the zone's own map, and on every instanced map that links back to it, it reads the
area flag out of the server's own extracted terrain files and resolves that flag to an `area_template`
row exactly as `GridMap::getArea` does (`vmangos-core/src/game/Maps/GridMap.cpp:257-266`), then keeps
only the spawns whose resolved zone or area is the one being shown. An instanced map's own zone comes
from `map_template.linked_zone` when the map sets one — the zone a flag-0 grid there resolves to
(`vmangos-core/src/game/Maps/Map.h:161-162`), which is how Blackrock Spire's spawns (map 229) belong
to zone 1583 on map 0. A map with no `linked_zone` instead links the `area_template` row on its own
map whose name matches the map's own name, ignoring case and a leading "The" — "Deadmines" the map
against "The Deadmines" the zone — because an instance's map can also carry other, genuinely
unrelated zones with no parent of their own, which would otherwise be mistaken for the instance's
main zone.

Three things can go missing under a zone page without it failing outright. With no `terrain.mapsDir`
configured, the page says NPCs and objects need the server's terrain files and drops only the spawn
lists. With `terrain.mapsDir` configured but not found on disk, it says the configured maps directory
was not found, for the same effect. And a terrain file that fails to parse as the core's own map
format is named and skipped rather than aborting the read, so one bad grid file only costs its own
patch of spawns, not the whole page.

**Factions are the world database's own build-keyed copy, read the same way `faction_template` and
`spell_template` are.** `/db/factions` lists every faction the client can gain reputation with,
grouped under its own parent faction (Alliance, Horde, Steamwheedle Cartel and the rest — `Faction.dbc`'s
parent id, `team`), plus the internal, non-reputable factions creatures are assigned to, listed
separately. A faction's own page (`/db/faction/:id`) shows its starting reputation by race and class,
every NPC assigned to it — through `faction_template.faction_id`, not `faction` directly, the same
indirection the NPCs and objects trap above already describes — every quest that rewards it, every
on-kill reputation award naming it, and every item that requires a standing with it. `faction` is
keyed `(id, build)` and read "highest build not above the configured one" exactly like
`faction_template` and `spell_template` (`highestBuildClause`; see the trap list above): a name or
reputation figure pulled by hand instead of through that same clause can show the wrong client's
data.

**`/db/talents` is a calculator, not just a browser.** It lists the nine classes; each links to
`/db/talents/:class`, which draws all three of that class's trees and lets a build be planned
against the rules the core itself enforces, not just displayed. Left-clicking an available
talent's icon adds a rank; right-clicking a talent that already has one removes its most recent
rank. Both are htmx requests that push the URL, so every state the calculator can reach is also a
plain link: `?build=` holds one digit per talent per tree, in row-then-column order, trees joined
by `-`, and it never reaches SQL — `parseBuild` reads it one talent at a time and keeps only the
prefix the rules below actually allow, so a hand-edited or impossible build silently falls back to
its own longest legal prefix rather than erroring. The rules come from the core, not this panel's
own guess: a rank needs `Row * 5` points already spent in its tree and, if it names one, its
prerequisite talent at the required rank (`Player::LearnTalent`,
`vmangos-core/src/game/Objects/Player.cpp:20998-21050`), and the character's total across all
three trees is `(level - 9) * Rate.Talent` from level 10 on (`Player::CalculateTalentsPoints`,
`vmangos-core/src/game/Objects/Player.cpp:20772-20776`) — `realm.talentRate` states that rate,
since the panel cannot read `mangosd.conf` for it (see Configuration below), and the calculator
reports the level a build needs as the smallest one whose total covers what is spent. Taking a
rank back follows the client's own refund rule: the server never removes a single rank, so the
panel enforces the rule itself, refusing to take a rank back while another talent that depends on
it still holds a point at that rank, or while removing it would leave a row above it short of its
own `Row * 5` points. Hovering a talent's icon fetches its hover card once from
`/db/tooltip/talent/:id`, the same fetch-once behaviour as every other card in this section; a
spell page that is itself a talent rank links back to the calculator with `?talent=<id>`, which
marks that talent on the tree it opens to. Each tree's own art is the client's own 300×331 crop of
its background texture, laid under the talent grid; without extracted art the tree still renders
and works, just on the plain background, and without the reference schema built the class page and
the calculator say to run `npm run import-dbc` instead.

Two config keys tell this section what the running server actually does, and neither can be read
back from the database — the panel states them because `mangosd.conf` and the CMake configuration
aren't available to it at runtime:

- **`realm.wowPatch`** must match `WowPatch` in `mangosd.conf` (0-10). It is the patch the
  `(entry, patch)` lookup above filters against.
- **`realm.clientBuild`** must match `SUPPORTED_CLIENT_BUILD` from the core's CMake configuration
  (5875 for 1.12.1). It is the build the faction and spell lookups filter against.

Get either wrong and the browser does not error — it silently disagrees with the running server
about which rows exist. Set `wowPatch` too low and an entry that only gained its current stats in
a later patch shows the earlier, wrong version, or is missing entirely if its earliest row is past
the configured patch; set it too high and a row the server has not "unlocked" yet is shown as
live. Get `clientBuild` wrong and faction or spell names resolve against the wrong client version,
or blank out for entries that only got a row at a later build. Both keys default (10 and 5875) to
the values of a standard 1.12.1 realm at its last content patch, so a `config.json` without a
`realm` block is right for such a realm — the risk is a value that was typed in and then drifted
from the realm's actual configuration.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Red "mangosd is not reachable" banner | `mangosd` is not running, SOAP was never enabled, or it was enabled in `mangosd.conf` but `mangosd` was never restarted afterward. |
| HTTP 403 on every request | The browser sent a foreign `Origin` or `Host` header. Reach the panel as `127.0.0.1` or `localhost` on its configured port, not through a proxy, a different hostname, or a different port. |
| Panel exits at startup saying `config.json` not found | You skipped the configuration step above — copy `config.example.json` to `config.json` first. |
| Panel exits complaining about a placeholder | `soap.user` or `soap.pass` in `config.json` still say `CHANGEME`. |
| Commands fail with a credentials error | The configured account either does not exist or is below gmlevel 6 — recheck it with the `account_access` query above. |
| A realm you added does not appear in the client | `realmd` skipped the row. Check that the address and local address resolve, that the subnet mask is contiguous, and that the realm is not marked hidden. |

## Notes worth knowing

- Passwords are redacted from the audit log, but the raw command sent to `mangosd` (password
  included) is echoed back to the browser once, in the response to the action that sent it. That
  is not a new disclosure — you just typed the password into that same form — but it means the
  response page itself is sensitive for a moment.
- `audit.sqlite` is local, gitignored state. It can be deleted at any time; the panel recreates
  it on next start.
- The status strip's bot count comes from a SQL query (`characters.online`, joined against the
  configured bot account prefix in `realmd.account`), not from `mangosd`'s `.bot info` command.
  A realm that runs its bots through a separate module, which the core's own bot manager knows
  nothing about, sees `.bot info` report zero bots regardless of how many are actually running.

## Offline art tools

Two tools turn the client's own art into ordinary PNGs so it can be judged outside the game.
Both are offline and run by hand from a shell in this directory — nothing in the panel calls
either of them, and neither needs `mangosd` or MySQL running.

- **Extraction.** `npm run extract-art` reads item icons, spell icons, every zone's world-map
  tiles, the world map's explored-area overlays and the talent-tree backgrounds out of the
  client's data archives and decodes them to PNGs under the asset root.
  `npm run census-compression` samples that same client data and reports which compression
  methods its archives actually use — the way a codec this project has not implemented would be
  found before it causes silent, unexplained misses. Both need the **client** section in
  `config.json`: the client install to read art from, and the server's extracted DBC directory
  that names which files to look for. `extract-art` also needs the **assets** section, below, to
  know where to write the result.
- **Viewing.** `npm run contact-sheet` reads the PNGs `extract-art` already wrote and generates a
  single static page at the asset root: every icon at its natural size (hovering one shows its
  file name), and every zone's twelve map tiles laid out in tile order so a correctly assembled
  map is easy to tell from a scrambled one. `npm run serve-assets` starts a small local web
  server so that page, and the PNGs it links to, can be opened in a browser rather than the
  file system. Both need the **assets** section: the root the PNGs and the generated page live
  under, and (for `serve-assets` only) the port it binds — `assets.port`, defaulting to 8421.
  It must not be `panel.port`: the two servers bind independently and nothing compares the two
  values, so a clash surfaces as `EADDRINUSE` when the second one starts.

Neither the **client** nor the **assets** section is required to run the panel itself; a
`config.json` that never runs these tools can leave both out. A relative `assets.root` is
resolved against the directory the command is run from — which the `npm run` scripts make this
one — so all three tools agree on where the extraction went. An absolute root avoids the
question entirely.

The extraction report counts spell icons and item candidates separately, and the spell line is
the one to watch. Item candidates are guesses offered to the archive on purpose — every string
in `ItemDisplayInfo.dbc` — so roughly nine in ten of them miss on a perfectly healthy run.
Spell-icon paths come out of the client's own data and nearly all resolve: a 1.12.1 client ships
1000 of 1019, the other 19 being cut content no archive contains. A spell figure much below
that is the signal that a name list or the archive precedence has broken.

## DBC reference importer

`npm run import-dbc` reads the client's own DBC files and loads them into a dedicated MySQL
schema so the Database section, and anyone auditing the world DB by hand, can compare a
template row against the client's ground truth instead of trusting that the world DB dump still
agrees with it. It is offline, like the art tools above: nothing in the panel calls it, and it
needs neither `mangosd` nor the panel running, only `client.dbcDir` from `config.json` pointing
at the server's extracted DBC directory.

The target schema (`mysql.dbcSchema`, `dbc` by default) is its own database, created once by
hand: the panel's MySQL user has no global `CREATE`, and the tool refuses to run against any of
the four schemas `config.json`'s `mysql` section names as a realm database, because it drops
every table it imports.

```sql
CREATE DATABASE dbc;
GRANT ALL PRIVILEGES ON dbc.* TO '<the panel's MySQL user>'@'localhost';
```

A run against a 1.12.1 client's DBC directory loads twenty-six tables and 64951 rows. Each
table is dropped and recreated from its DBC file every time, so a re-run is safe and is how a
schema built from an older client patch is refreshed. `dbc_import` records the source file's
size, modification time and record count alongside the client build the import was run with, so
a schema that has gone stale against the DBC directory it was built from is something a query
can find rather than something someone has to remember.

## Tests

`npm test`. The database tests need MySQL running; they create and drop fixture tables inside
the existing `logs` database, never a database of their own, and never touch `realmd`.

## Design notes

The code carries its own reasoning: every rule it encodes about the server's behaviour cites the
VMaNGOS source file and line it was read from (`vmangos-core/src/game/...`, relative to a checkout
of the core beside this one), so a claim can be checked against the core rather than taken on
trust.
