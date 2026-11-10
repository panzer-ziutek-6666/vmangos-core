# wow-ops

A web-based operations panel and game database browser for a
[VMaNGOS](https://github.com/vmangos/core) realm (World of Warcraft 1.12.1).

It gives a realm operator one place to manage the running server: accounts, characters, bans,
game events, GM tickets, broadcasts, the realm list. It also includes a read-only, wowhead-style
browser of the realm's own game data. Every action goes through the server the same way a GM
would, and every action is recorded in a local audit log.

For the full operator guide — what each section does, the server behaviours it works around, and
troubleshooting — see **[GUIDE.md](GUIDE.md)**.

## Features

**Operator sections** (these write to the running server):

- **Accounts:**
  - create an account, set its GM level or password;
  - ban, unban or delete it;
  - see the exact command before sending it, and the server's reply after.
- **Server:**
  - message of the day, chat and on-screen announcements;
  - saving, the player limit, instance resets, shutdown and restart;
  - the realm registry (`realmlist`).
- **Characters:** search, per-character moderation, mail, and deleted-character recovery.
- **Game events:** each event's live state and schedule, start and stop, and enable and disable.
- **Tickets:** the GM ticket queue and the ticket commands reachable remotely.
- **Bots:** online and account counts, and where the bots are, for realms running a bot module.
- **Audit log:** the most recent commands the panel sent, with status and timing.

**Database browser** (read-only):

- **Items, item sets, NPCs, objects, quests, spells and skills:** filterable, sortable listviews,
  a page per entry, and hover cards on every link.
- **Zones:** the in-game world map, drawn from the client's own art, with a dot for every NPC and
  object spawn. Each spawn is placed in its zone the way the server itself decides, from the
  server's terrain data.
- **Factions:** starting reputation by race and class, how to earn it, and member NPCs.
- **A talent calculator:** each class's trees over the client's artwork. Left-click adds a rank and
  right-click removes one, and the build is kept in the URL so it can be shared.
- **Search** across all of the above.

The browser shows each row the way the running server loaded it: the right content patch and
client build, not whatever a naive query returns.

## How it works

- **Reads** go straight to the realm's MySQL databases.
- **Writes** are GM commands sent one at a time to the running `mangosd` over its SOAP interface.
  The server caches game data in memory, so a direct SQL write would not take effect; a command
  does. The one exception is the realm registry, which `realmd` re-reads by itself.
- **Every command sent** is recorded in `audit.sqlite`, with passwords redacted.
- **The database browser** only reads. It never contacts `mangosd`.
- **Reference data and art** (icons, map tiles, talent-tree backgrounds, and a copy of the client's
  data tables) are produced by offline tools from your own game client's files. Nothing from the
  game ships with this repository.

## Technology stack

| Part | Choice |
| --- | --- |
| Runtime | Node.js 24 or later |
| Web server | [Fastify](https://fastify.dev/) 5, with `@fastify/formbody` and `@fastify/static` |
| UI | Server-rendered HTML with [htmx](https://htmx.org/) 2 (vendored, no bundler) |
| Database | MySQL, through [`mysql2`](https://github.com/sidorares/node-mysql2) |
| Audit log | SQLite, through Node's built-in `node:sqlite` |
| Server control | The VMaNGOS SOAP interface |
| Tests | Node's built-in test runner (`node:test`) |
| Offline tools | Pure JavaScript readers for MPQ archives, BLP textures and DBC tables, and a PNG writer |

There is no build step and no front-end framework: edit a file and restart.

## Requirements

- **Node.js 24 or later.**
- **A VMaNGOS realm** for client 1.12.1 (build 5875):
  - its MySQL databases: logon (`realmd`), `characters`, world (`mangos`) and `logs`. Only the
    logon database is strictly required; sections whose database is missing explain themselves
    instead of failing;
  - `mangosd` running with **SOAP enabled**, for the operator sections;
  - a game account with **GM level 6** (`SEC_ADMINISTRATOR`, stored in `account_access`) for the
    panel to act as.
- **Optional, for the database browser's art and reference data:**
  - a World of Warcraft 1.12.1 client (its `Data` directory);
  - the server's extracted `dbc` directory;
  - the server's extracted `maps` directory, to place spawns in zones.

## Quick start

1. **Install dependencies.**

   ```sh
   npm install
   ```

2. **Enable SOAP** in the server's `mangosd.conf`, then restart `mangosd`:

   ```
   SOAP.Enabled = 1
   SOAP.IP = 127.0.0.1
   SOAP.Port = 7878
   ```

3. **Pick the panel's account.** It needs GM level 6, and it should be an account no one plays
   on, with a strong password of its own, since that password guards SOAP's full console
   authority (see [GUIDE.md](GUIDE.md#the-panels-game-account)). This read-only query lists
   accounts that qualify:

   ```sql
   SELECT a.username, aa.gmlevel
   FROM realmd.account a JOIN realmd.account_access aa ON aa.id = a.id
   WHERE aa.gmlevel >= 6;
   ```

4. **Configure.** Copy the example and fill it in:

   ```sh
   cp config.example.json config.json
   ```

   Set `soap.user` and `soap.pass` to that account; the panel refuses to start while either still
   reads `CHANGEME`. Set the four `mysql` connections, and check the `realm` values against your
   server: `wowPatch` must match `WowPatch` in `mangosd.conf`, `clientBuild` is 5875 for 1.12.1,
   and `talentRate` must match `Rate.Talent`. `config.json` is gitignored; keep it that way, since
   it holds a password.

5. **Optionally, build the reference data and art** for the database browser. Add the `client`,
   `assets` and `terrain` sections to `config.json` (see `config.example.json`) and create an empty
   MySQL schema for the reference data (`dbc` by default). Then:

   ```sh
   npm run import-dbc    # the client's data tables into the reference schema
   npm run extract-art   # icons, map tiles and overlays, talent backgrounds, as PNGs
   ```

   Both are offline, one-off steps; re-run them after updating wow-ops. Without them, the operator
   sections and most of the database browser still work, and the pages that need the missing data
   say so.

6. **Run it.**

   ```sh
   npm start
   ```

   Then open `http://127.0.0.1:<panel.port>` (8420 by default).

## Security model

- The panel binds to `127.0.0.1` only, and it refuses any request whose `Origin` or `Host` does
  not match its own address. It is meant to be used from a browser on the same machine as the
  server, and it has no login of its own. Do not expose it to a network.
- SOAP commands run with full console authority. The audit log is the record of what the panel
  did.
- Passwords are redacted in the audit log. `config.json` and `audit.sqlite` are gitignored.

## Tests

```sh
npm test
```

The suite uses Node's built-in test runner. Tests named `*-live.test.js` run read-only checks
against a real realm's databases and client files; each skips itself when `config.json` or the
data it needs is not available. On a machine without a realm, the rest of the suite still runs.

## Project layout

```
server/            the panel
  app.js           Fastify setup, origin checks, section wiring
  queries/         SQL reads, one module per section (queries/db/ for the browser)
  commands/        GM command builders and argument validation
  sections/        routes
  views/           HTML rendering (views/db/ for the browser)
  dbLookups/       shared lookups: names, enums, spell text, terrain, talent rules
tools/             offline tooling: MPQ, BLP and DBC readers, art extractor, DBC importer
public/            stylesheet and the vendored htmx
test/              node:test suites
config.example.json
GUIDE.md           the operator guide
LICENSE            MIT
```

## License

[MIT](LICENSE).

## Disclaimer

wow-ops is an independent tool for operating a VMaNGOS server. It is not affiliated with or
endorsed by Blizzard Entertainment. World of Warcraft and its assets are trademarks and property
of Blizzard Entertainment. This repository contains no game assets: the art and data tables it
displays are extracted locally from a game client you supply.
