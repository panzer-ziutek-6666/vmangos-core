# VMaNGOS chat command reference

**Command count:** 817

Every in-game / console command registered in `ChatHandler::getCommandTable()`
(`src/game/Chat/Chat.cpp`), generated from the source of this fork. 817 commands in total,
757 of which take arguments or run something directly; the rest are parent nodes that only
group sub-commands.

## How to read this document

* Commands are typed in the chat window prefixed with a dot (`.additem 2589 5`), or on the
  `mangosd` console / RA session without the dot.
* **Lvl** is the minimum account security level required (`account.gmlevel` in the realm DB):

  | Lvl | Name |
  |-----|------|
  | 0 | Player |
  | 1 | Moderator |
  | 2 | Ticketmaster |
  | 3 | Gamemaster |
  | 4 | Basic admin |
  | 5 | Developer |
  | 6 | Administrator |
  | 7 | Console only |

  Levels and help text can be overridden per command in the world DB `command` table
  (`name`, `security`, `help`, `flags`), which is read once at startup; the values below are
  the hardcoded defaults. `.reload command` re-reads that table.
* **C** marks commands that also work from the server console or an RA connection. Commands
  without it need a logged-in character (they use your selection or your position).
* **Description** says what the command does. It was written from the handler body, not from
  the `help` column of the `command` table — that column is empty for almost every command in
  this fork, and the table itself is shipped empty. A description that says *container* marks
  a parent node with no behaviour of its own; where a parent both groups sub-commands and does
  something when typed alone, the description covers what it does alone and the syntax column
  shows its arguments.
* Syntax conventions: `<required>`, `[optional]`, `a|b` = pick one. Most commands that take an
  item / creature / gameobject / spell / quest / area-trigger id also accept the shift-clicked
  chat link instead of the raw id. A `[player]` argument defaults to your current target when
  omitted, and accepts an offline character name for many commands.
* Examples use placeholder ids (item 2589 = Linen Cloth, creature 299 = Defias Smuggler,
  spell 133 = Fireball). Substitute your own.

## Frequently used

```
.gm on                      # enter GM mode (immune, no aggro)
.gm fly on                  # GM flight
.gm visible off             # hide from players
.tele name Bobmage ironforge
.go xyz -8949.95 -132.49 83.53 0
.additem 2589 20            # 20x Linen Cloth into your bags
.npc spawn add 299          # spawn creature 299 permanently at your position
.gobject add 3239           # spawn gameobject 3239 permanently
.lookup creature defias     # find creature ids by name
.lookup item linen
.character level Bobmage 60
.modify speed 3             # 3x run speed on the selected player
.revive                     # resurrect the selected player
.reload creature_template   # reload one world DB table without a restart
.server info                # uptime, player count, revision
```

## Contents

* [`.account`](#account) — 13
* [`.additem`](#additem) — 1
* [`.additemset`](#additemset) — 1
* [`.ahbot`](#ahbot) — 3
* [`.angle`](#angle) — 1
* [`.announce`](#announce) — 1
* [`.anticheat`](#anticheat) — 1
* [`.antispam`](#antispam) — 5
* [`.aoedamage`](#aoedamage) — 1
* [`.auction`](#auction) — 4
* [`.aura`](#aura) — 1
* [`.ban`](#ban) — 7
* [`.baninfo`](#baninfo) — 4
* [`.bank`](#bank) — 1
* [`.banlist`](#banlist) — 4
* [`.battlebot`](#battlebot) — 9
* [`.bg`](#bg) — 4
* [`.bot`](#bot) — 9
* [`.cast`](#cast) — 5
* [`.channel`](#channel) — 3
* [`.character`](#character) — 26
* [`.charge`](#charge) — 1
* [`.cheat`](#cheat) — 21
* [`.cinematic`](#cinematic) — 4
* [`.combatstop`](#combatstop) — 1
* [`.cometome`](#cometome) — 1
* [`.commands`](#commands) — 1
* [`.cooldown`](#cooldown) — 4
* [`.damage`](#damage) — 1
* [`.debug`](#debug) — 65
* [`.deleteitem`](#deleteitem) — 1
* [`.demorph`](#demorph) — 1
* [`.deplenish`](#deplenish) — 1
* [`.die`](#die) — 1
* [`.dismount`](#dismount) — 1
* [`.distance`](#distance) — 1
* [`.escort`](#escort) — 7
* [`.event`](#event) — 6
* [`.explorecheat`](#explorecheat) — 1
* [`.fear`](#fear) — 1
* [`.freeze`](#freeze) — 1
* [`.gm`](#gm) — 7
* [`.go`](#go) — 18
* [`.gobject`](#gobject) — 21
* [`.gocorpse`](#gocorpse) — 1
* [`.gold`](#gold) — 3
* [`.goname`](#goname) — 1
* [`.gps`](#gps) — 1
* [`.group`](#group) — 5
* [`.groupgo`](#groupgo) — 1
* [`.groupinfo`](#groupinfo) — 1
* [`.groupspell`](#groupspell) — 3
* [`.guid`](#guid) — 1
* [`.guild`](#guild) — 8
* [`.help`](#help) — 1
* [`.hidearea`](#hidearea) — 1
* [`.honor`](#honor) — 6
* [`.hover`](#hover) — 1
* [`.instance`](#instance) — 12
* [`.itemmove`](#itemmove) — 1
* [`.kick`](#kick) — 1
* [`.knockback`](#knockback) — 1
* [`.learn`](#learn) — 13
* [`.levelup`](#levelup) — 1
* [`.linkgrave`](#linkgrave) — 1
* [`.list`](#list) — 13
* [`.log`](#log) — 1
* [`.lookup`](#lookup) — 28
* [`.maxskill`](#maxskill) — 1
* [`.mmap`](#mmap) — 9
* [`.modify`](#modify) — 54
* [`.mount`](#mount) — 1
* [`.movegens`](#movegens) — 1
* [`.mute`](#mute) — 1
* [`.nameaura`](#nameaura) — 1
* [`.namedie`](#namedie) — 1
* [`.namego`](#namego) — 1
* [`.neargrave`](#neargrave) — 1
* [`.notify`](#notify) — 1
* [`.npc`](#npc) — 54
* [`.partybot`](#partybot) — 20
* [`.pbcast`](#pbcast) — 3
* [`.pdump`](#pdump) — 3
* [`.pet`](#pet) — 8
* [`.pinfo`](#pinfo) — 1
* [`.pool`](#pool) — 4
* [`.possess`](#possess) — 1
* [`.pvp`](#pvp) — 1
* [`.quest`](#quest) — 5
* [`.quit`](#quit) — 1
* [`.recall`](#recall) — 1
* [`.reload`](#reload) — 113
* [`.removeriding`](#removeriding) — 1
* [`.repairitems`](#repairitems) — 1
* [`.replenish`](#replenish) — 1
* [`.reset`](#reset) — 8
* [`.respawn`](#respawn) — 1
* [`.revive`](#revive) — 1
* [`.save`](#save) — 1
* [`.saveall`](#saveall) — 1
* [`.send`](#send) — 9
* [`.server`](#server) — 20
* [`.service`](#service) — 2
* [`.setskill`](#setskill) — 1
* [`.showarea`](#showarea) — 1
* [`.sniff`](#sniff) — 1
* [`.spamer`](#spamer) — 4
* [`.spell`](#spell) — 5
* [`.stable`](#stable) — 1
* [`.start`](#start) — 1
* [`.taxicheat`](#taxicheat) — 1
* [`.tele`](#tele) — 5
* [`.ticket`](#ticket) — 25
* [`.trigger`](#trigger) — 3
* [`.unaura`](#unaura) — 1
* [`.unban`](#unban) — 4
* [`.unfreeze`](#unfreeze) — 1
* [`.unit`](#unit) — 25
* [`.unlearn`](#unlearn) — 4
* [`.unmute`](#unmute) — 1
* [`.unstuck`](#unstuck) — 1
* [`.variable`](#variable) — 1
* [`.video`](#video) — 3
* [`.wareffort`](#wareffort) — 6
* [`.wchange`](#wchange) — 1
* [`.whispers`](#whispers) — 1
* [`.world`](#world) — 4
* [`.wp`](#wp) — 5
* [`.wr`](#wr) — 1

## account

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.account` | 0 | yes | Account management. On its own, shows the security level of your own account. | `.account` (also a sub-command group) | |
| `.account characters` | 3 | yes | Lists the characters on an account, with race, class and level. | `.account characters <account>` | `.account characters testacc` |
| `.account cleardata` | 0 |  | Deletes your own account's saved UI data (`account_data` and `character_account_data`), forcing the client to rebuild its saved settings. | `.account cleardata` |  |
| `.account create` | 7 | yes | Creates a new game account with the given password. | `.account create <account> <password>` | `.account create testacc secret123` |
| `.account delete` | 7 | yes | Deletes an account and every character on it. | `.account delete <account>` | `.account delete testacc` |
| `.account onlinelist` | 7 | yes | Lists the accounts currently logged in. | `.account onlinelist [limit]` | `.account onlinelist 10` |
| `.account lock` | 0 | yes | Locks your own account to the IP address you are logged in from, or unlocks it. Usable only from an RA session. | `.account lock on\|off` | `.account lock on` |
| `.account set` | 6 | yes | Container for the commands that change another account's settings. | *(sub-commands only)* | |
| `.account set addon` | 7 | yes | Sets the expansion/addon level allowed on an account. | `.account set addon [account] <addon level>` | `.account set addon testacc 1` |
| `.account set gmlevel` | 7 | yes | Sets an account's security (GM) level; you cannot set a level at or above your own. | `.account set gmlevel [account] <gm level 0-7>` | `.account set gmlevel testacc 3` |
| `.account set password` | 7 | yes | Sets an account's password without knowing the old one. | `.account set password <account> <password> <password again>` | `.account set password testacc secret123 secret123` |
| `.account set locked` | 6 | yes | Locks or unlocks an account to the IP it last logged in from. | `.account set locked [account] <value>` | `.account set locked testacc 1` |
| `.account password` | 0 | yes | Changes your own account's password; requires the current password. Usable only from an RA session. | `.account password <old password> <new password> <new password again>` | `.account password secret123 secret123 secret123` |

## additem

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.additem` | 3 |  | Adds an item to your bags, or removes it when the count is negative. | `.additem <item> [count]` | `.additem 2589 5` |

## additemset

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.additemset` | 3 |  | Adds every item belonging to an item set to your bags. | `.additemset <itemset id>` | `.additemset 181` |

## ahbot

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.ahbot` | 6 | yes | Container for the auction house bot commands. | *(sub-commands only)* | |
| `.ahbot reload` | 6 | yes | Reloads the auction house bot's configuration and its item tables. | `.ahbot reload` |  |
| `.ahbot update` | 6 | yes | Makes the auction house bot post a new batch of auctions immediately. | `.ahbot update` |  |

## angle

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.angle` | 1 |  | Reports the angle between you and the target, in radians. | `.angle [player or creature link]` | `.angle 1` |

## announce

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.announce` | 4 | yes | Sends a system message to every player online. | `.announce <message>` | `.announce Server restart in 5 minutes` |

## anticheat

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.anticheat` | 2 |  | Prints the anticheat report collected for a player: which checks fired and how often. | `.anticheat [player]` | `.anticheat Bobmage` |

## antispam

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.antispam` | 2 | yes | Container for the chat spam filter commands. | *(sub-commands only)* | |
| `.antispam add` | 2 | yes | Adds a word to the `antispam_blacklist` table with a ban weight. | `.antispam add "<word>"` | `.antispam add "badword"` |
| `.antispam remove` | 4 | yes | Removes a word from the `antispam_blacklist` table. | `.antispam remove "<word>"` | `.antispam remove "badword"` |
| `.antispam replace` | 2 | yes | Adds a character substitution to `antispam_replacement`, so obfuscated spellings still match the blacklist. | `.antispam replace "<from>" "<to>"` | `.antispam replace "a" "b"` |
| `.antispam removereplace` | 4 | yes | Removes a character substitution from `antispam_replacement`. | `.antispam removereplace "<from>"` | `.antispam removereplace "a"` |

## aoedamage

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.aoedamage` | 3 |  | Deals the given amount of damage to every hostile unit within the given range of you. | `.aoedamage <damage int> <max range>` | `.aoedamage 1 1` |

## auction

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.auction` | 2 |  | Opens an auction house window; also the parent of the per-faction variants. | `.auction` (also a sub-command group) | |
| `.auction alliance` | 2 |  | Opens the Alliance auction house from wherever you are. | `.auction alliance` |  |
| `.auction goblin` | 2 |  | Opens the neutral (goblin) auction house from wherever you are. | `.auction goblin` |  |
| `.auction horde` | 2 |  | Opens the Horde auction house from wherever you are. | `.auction horde` |  |

## aura

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.aura` | 4 |  | Applies a spell's aura to the selected unit. | `.aura <spell id> [duration ms]` | `.aura 133 30000` |

## ban

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.ban` | 2 | yes | Container for the ban commands. | *(sub-commands only)* | |
| `.ban account` | 3 | yes | Bans an account for a duration, with a reason recorded. | `.ban account <account> <ban duration> <reason>` | `.ban account testacc 30d Exploiting` |
| `.ban allip` | 6 | yes | Bans every account that has ever logged in from an IP address. | `.ban allip <ip> [reason]` | `.ban allip 192.168.0.10 Exploiting` |
| `.ban character` | 3 | yes | Bans the account behind a character, for a duration, with a reason. | `.ban character <player> <ban duration> <reason>` | `.ban character Bobmage 30d Exploiting` |
| `.ban ip` | 6 | yes | Bans an IP address for a duration. | `.ban ip <ip> <ban duration> <reason>` | `.ban ip 192.168.0.10 30d Exploiting` |
| `.ban note` | 2 | yes | Records a note on a character's account without punishing it. | `.ban note [player] <reason>` | `.ban note Bobmage Exploiting` |
| `.ban warn` | 2 | yes | Records a warning on a character's account and tells the player. | `.ban warn [player] <reason>` | `.ban warn Bobmage Exploiting` |

## baninfo

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.baninfo` | 2 |  | Container for the commands that show why something is banned. | *(sub-commands only)* | |
| `.baninfo account` | 2 | yes | Shows the ban history of an account. | `.baninfo account <account>` | `.baninfo account testacc` |
| `.baninfo character` | 2 | yes | Shows the ban history of the account behind a character. | `.baninfo character [player]` | `.baninfo character Bobmage` |
| `.baninfo ip` | 3 | yes | Shows the ban entry for an IP address, with its expiry. | `.baninfo ip <ip>` | `.baninfo ip 192.168.0.10` |

## bank

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.bank` | 2 |  | Opens your own bank window from wherever you are. | `.bank` |  |

## banlist

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.banlist` | 2 | yes | Container for the commands that list active bans. | *(sub-commands only)* | |
| `.banlist account` | 2 | yes | Lists banned accounts, optionally filtered by a name prefix. | `.banlist account [name filter]` | `.banlist account bob` |
| `.banlist character` | 2 | yes | Lists banned characters, optionally filtered by a name prefix. | `.banlist character [name filter]` | `.banlist character bob` |
| `.banlist ip` | 3 | yes | Lists banned IP addresses, optionally filtered by an address prefix. | `.banlist ip [ip filter]` | `.banlist ip 192.168` |

## battlebot

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.battlebot` | 6 | yes | Container for the battleground bot commands. | *(sub-commands only)* | |
| `.battlebot add` | 6 | yes | Container for the per-battleground bot spawn commands. | *(sub-commands only)* | |
| `.battlebot add alterac` | 6 | yes | Adds bots to the Alterac Valley queue. | `.battlebot add alterac <bot count>` | `.battlebot add alterac 10` |
| `.battlebot add arathi` | 6 | yes | Adds bots to the Arathi Basin queue. | `.battlebot add arathi <bot count>` | `.battlebot add arathi 10` |
| `.battlebot add warsong` | 6 | yes | Adds bots to the Warsong Gulch queue. | `.battlebot add warsong <bot count>` | `.battlebot add warsong 10` |
| `.battlebot remove` | 6 |  | Removes the selected battle bot. | `.battlebot remove` |  |
| `.battlebot removeall` | 6 | yes | Removes every battle bot on the server. | `.battlebot removeall` |  |
| `.battlebot showpath` | 6 |  | Draws the path the selected battle bot is currently following, using visual waypoints. | `.battlebot showpath` |  |
| `.battlebot showallpaths` | 6 |  | Draws every bot path defined for the battleground you are in. | `.battlebot showallpaths` |  |

## bg

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.bg` | 3 |  | Battleground control. On its own, runs the battleground's custom debug command. | `.bg <battleground specific command>` | `.bg start` |
| `.bg status` | 3 |  | Lists the battlegrounds currently running, with their instance ids, player counts and queue state. | `.bg status` |  |
| `.bg start` | 3 |  | Immediately starts the battleground you are in, skipping the countdown. | `.bg start` |  |
| `.bg stop` | 3 |  | Immediately ends the battleground you are in. | `.bg stop` |  |

## bot

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.bot` | 6 | yes | Container for the standalone player bot commands. | *(sub-commands only)* | |
| `.bot add` | 6 | yes | Loads one bot into the world by character name. | `.bot add <player name>` | `.bot add Bobmage` |
| `.bot add_all` | 6 | yes | Loads every configured bot into the world. | `.bot add_all` |  |
| `.bot delete` | 6 | yes | Disconnects a bot by character name. | `.bot delete <player name>` | `.bot delete Bobmage` |
| `.bot info` | 6 | yes | Prints bot statistics: configured minimum and maximum, how many are loading, online and chatting. | `.bot info` |  |
| `.bot reload` | 6 | yes | Reloads the player bot system and its configuration. | `.bot reload` |  |
| `.bot stop` | 6 | yes | Unloads every bot currently in the world. | `.bot stop` |  |
| `.bot start` | 6 | yes | Restarts the bot system after `.bot stop`. | `.bot start` |  |
| `.bot ranadd` | 6 | yes | Adds the given number of randomly chosen bots. | `.bot ranadd <count>` | `.bot ranadd 5` |

## cast

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.cast` | 5 |  | Makes you cast a spell at the selected unit. | `.cast <spell id> [triggered]` | `.cast 133 1` |
| `.cast back` | 5 |  | Makes the selected unit cast a spell back at you. | `.cast back <spell id> [triggered]` | `.cast back 133 1` |
| `.cast dist` | 5 |  | Casts a spell at a point the given distance in front of you. | `.cast dist <spell id> <distance> [triggered]` | `.cast dist 133 2.0 1` |
| `.cast self` | 5 |  | Makes the selected unit cast a spell on itself. | `.cast self <spell id> [triggered]` | `.cast self 133 1` |
| `.cast target` | 5 |  | Makes the selected unit cast a spell at its own current target. | `.cast target <spell id> [triggered]` | `.cast target 133 1` |

## channel

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.channel` | 1 |  | Container for the chat channel commands. | *(sub-commands only)* | |
| `.channel join` | 1 |  | Joins a chat channel by name. | `.channel join <channel name>` | `.channel join World` |
| `.channel leave` | 1 |  | Leaves a chat channel by name. | `.channel leave <channel name>` | `.channel leave World` |

## character

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.character` | 2 | yes | Container for the commands that act on a character rather than a live unit. | *(sub-commands only)* | |
| `.character aiinfo` | 1 | yes | Shows which AI and movement generator the selected character is running (relevant for bots and possessed players). | `.character aiinfo` |  |
| `.character deleted` | 3 | yes | Container for the soft-deleted character commands. | *(sub-commands only)* | |
| `.character deleted delete` | 7 | yes | Permanently erases soft-deleted characters matching a name or GUID. | `.character deleted delete <name search string>` | `.character deleted delete 1` |
| `.character deleted list` | 3 | yes | Container for the soft-deleted character listings. | *(sub-commands only)* | |
| `.character deleted list account` | 3 | yes | Lists the soft-deleted characters of one account. | `.character deleted list account <account name search string>` | `.character deleted list account 10` |
| `.character deleted list name` | 3 | yes | Lists soft-deleted characters whose name matches the given string. | `.character deleted list name <character name search string>` | `.character deleted list name 1` |
| `.character deleted restore` | 4 | yes | Restores soft-deleted characters, optionally to a different account and under a new name. | `.character deleted restore <name search string> [new name] [account]` | `.character deleted restore 1 1 testacc` |
| `.character deleted old` | 7 | yes | Permanently erases every soft-deleted character older than the given number of days. | `.character deleted old [keep days]` | `.character deleted old 1` |
| `.character erase` | 7 | yes | Deletes a character outright, bypassing the soft-delete grace period. | `.character erase <player>` | `.character erase Bobmage` |
| `.character level` | 5 | yes | Sets a character's level, granting or taking the difference in experience. | `.character level [player] <level>` | `.character level Bobmage 60` |
| `.character rename` | 3 | yes | Flags a character to be renamed at next login, or renames it directly. | `.character rename [player]` | `.character rename Bobmage` |
| `.character reputation` | 2 | yes | Lists a character's reputation with every faction it knows. | `.character reputation [player]` | `.character reputation Bobmage` |
| `.character hasitem` | 2 | yes | Reports how many of an item a character owns, bank and bags included. | `.character hasitem <item id> [player]` | `.character hasitem 2589 Bobmage` |
| `.character race` | 4 | yes | Changes a character's race, remapping race-specific skills, spells and reputations. | `.character race <race id>` | `.character race 1` |
| `.character skin` | 4 | yes | Copies the appearance (skin, face, hair, gender) of one character onto another. | `.character skin <player>` | `.character skin Bobmage` |
| `.character fillflys` | 3 | yes | Marks every flight path known for a character, so all taxi nodes are usable. | `.character fillflys` |  |
| `.character premade` | 4 |  | Container for the premade gear and talent template commands. | *(sub-commands only)* | |
| `.character premade gear` | 4 |  | Applies a premade equipment template to a character, or lists the templates available for it. | `.character premade gear [template id]` | `.character premade gear 1` |
| `.character premade spec` | 4 |  | Applies a premade talent template to a character, or lists the templates available for it. | `.character premade spec [template id]` | `.character premade spec 1` |
| `.character premade savegear` | 5 |  | Saves the target's current equipment as a new premade gear template. | `.character premade savegear <template name>` | `.character premade savegear warrior_t1` |
| `.character premade savespec` | 5 |  | Saves the target's current talents as a new premade spec template. | `.character premade savespec <template name>` | `.character premade savespec warrior_t1` |
| `.character clean` | 6 | yes | Container for the bulk character clean-up commands. | *(sub-commands only)* | |
| `.character clean todelete` | 6 | yes | Deletes every character listed in the `characters_guid_delete` table. | `.character clean todelete` |  |
| `.character clean items` | 6 | yes | Deletes every item listed in the `characters_item_delete` table from bags, banks, mail and auctions, and reports what was removed. | `.character clean items` |  |
| `.character citytitle` | 6 |  | Grants or removes the capital city title on the selected character. | `.character citytitle on\|off` | `.character citytitle on` |

## charge

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.charge` | 3 |  | Makes you charge the selected unit, using the movement generator rather than the spell. | `.charge` |  |

## cheat

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.cheat` | 3 |  | Container for the per-player cheat toggles. Each one applies to the selected player, or to you. | *(sub-commands only)* | |
| `.cheat fly` | 3 |  | Toggles flight. Jumping cancels it. | `.cheat fly on\|off` | `.cheat fly on` |
| `.cheat fixedz` | 3 |  | Toggles a fixed Z coordinate, so movement stays at the current height. | `.cheat fixedz on\|off` | `.cheat fixedz on` |
| `.cheat beastmaster` | 3 |  | Toggles the ability to tame any creature, ignoring class, level and family limits. | `.cheat beastmaster on\|off [player]` | `.cheat beastmaster on Bobmage` |
| `.cheat god` | 3 |  | Toggles invulnerability to all damage. | `.cheat god on\|off [player]` | `.cheat god on Bobmage` |
| `.cheat cooldown` | 3 |  | Toggles spell cooldowns off. | `.cheat cooldown on\|off [player]` | `.cheat cooldown on Bobmage` |
| `.cheat casttime` | 3 |  | Toggles instant casting of every spell. | `.cheat casttime on\|off [player]` | `.cheat casttime on Bobmage` |
| `.cheat powercost` | 3 |  | Toggles free casting, ignoring mana, rage and energy costs. | `.cheat powercost on\|off [player]` | `.cheat powercost on Bobmage` |
| `.cheat debuffs` | 3 |  | Toggles immunity to hostile auras. | `.cheat debuffs on\|off [player]` | `.cheat debuffs on Bobmage` |
| `.cheat criticals` | 3 |  | Toggles guaranteed critical hits. | `.cheat criticals on\|off [player]` | `.cheat criticals on Bobmage` |
| `.cheat castchecks` | 3 |  | Toggles the cast requirement checks (range, line of sight, reagents, aura states). | `.cheat castchecks on\|off [player]` | `.cheat castchecks on Bobmage` |
| `.cheat procs` | 3 |  | Toggles guaranteed proc chances. | `.cheat procs on\|off [player]` | `.cheat procs on Bobmage` |
| `.cheat triggerpass` | 3 |  | Toggles passing through area triggers without their level or quest requirements. | `.cheat triggerpass on\|off [player]` | `.cheat triggerpass on Bobmage` |
| `.cheat ignoretriggers` | 3 |  | Toggles area triggers firing at all for this player. | `.cheat ignoretriggers on\|off [player]` | `.cheat ignoretriggers on Bobmage` |
| `.cheat immunepc` | 3 |  | Toggles immunity to attacks from players. | `.cheat immunepc on\|off [player]` | `.cheat immunepc on Bobmage` |
| `.cheat immunenpc` | 3 |  | Toggles immunity to attacks from creatures. | `.cheat immunenpc on\|off [player]` | `.cheat immunenpc on Bobmage` |
| `.cheat untargetable` | 3 |  | Toggles being targetable by anything. | `.cheat untargetable on\|off [player]` | `.cheat untargetable on Bobmage` |
| `.cheat waterwalk` | 3 |  | Toggles walking on water. | `.cheat waterwalk on\|off` | `.cheat waterwalk on` |
| `.cheat wallclimb` | 3 |  | Toggles climbing slopes the server would normally reject. | `.cheat wallclimb on\|off` | `.cheat wallclimb on` |
| `.cheat debugtargetinfo` | 3 |  | Toggles verbose targeting diagnostics being sent to this player. | `.cheat debugtargetinfo on\|off [player]` | `.cheat debugtargetinfo on Bobmage` |
| `.cheat status` | 3 |  | Lists the cheats currently active on the selected player. | `.cheat status [player]` | `.cheat status Bobmage` |

## cinematic

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.cinematic` | 5 |  | Container for the scripted camera path commands. | *(sub-commands only)* | |
| `.cinematic addwp` | 5 |  | Records your current position as a waypoint of a cinematic at the given millisecond offset. | `.cinematic addwp <cinematic id> <timer ms> <comment>` | `.cinematic addwp 1 5000 start of scene` |
| `.cinematic gotime` | 5 |  | Teleports you to the position a cinematic reaches at the given millisecond offset. | `.cinematic gotime <cinematic id> <time ms>` | `.cinematic gotime 1 5000` |
| `.cinematic listwp` | 5 |  | Draws the waypoints of a cinematic in the world. | `.cinematic listwp` |  |

## combatstop

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.combatstop` | 3 |  | Drops the selected unit out of combat immediately. | `.combatstop [player]` | `.combatstop Bobmage` |

## cometome

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.cometome` | 3 |  | Makes the selected creature walk to your position. | `.cometome` |  |

## commands

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.commands` | 0 | yes | Lists every command your security level can use. | `.commands` |  |

## cooldown

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.cooldown` | 3 |  | Container for the spell cooldown commands. | *(sub-commands only)* | |
| `.cooldown list` | 3 |  | Lists the spell cooldowns currently running on the selected unit. | `.cooldown list` |  |
| `.cooldown clear` | 3 |  | Clears one spell cooldown on the selected unit, or all of them when no spell is given. | `.cooldown clear [spell id]` | `.cooldown clear 133` |
| `.cooldown clearclientside` | 3 |  | Clears the client's own cooldown display for a player, without touching server state. | `.cooldown clearclientside` |  |

## damage

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.damage` | 3 |  | Deals the given amount of damage to the selected unit, optionally of a specific spell school. | `.damage <damage int> <school>` | `.damage 1 1` |

## debug

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.debug` | 2 | yes | Container for the developer diagnostics. Most of these exist to reproduce a bug, not to run a realm. | *(sub-commands only)* | |
| `.debug anim` | 3 |  | Plays an emote/animation id on you. | `.debug anim <emote id>` | `.debug anim 4` |
| `.debug bg` | 6 | yes | Toggles battleground test mode, which lets a battleground start with far fewer players. | `.debug bg` |  |
| `.debug bytes1` | 5 | yes | Sets a byte of the target's `UNIT_FIELD_BYTES_1` (stand state, animation tier, visibility flags). | `.debug bytes1 <offset> <value>` | `.debug bytes1 1 1` |
| `.debug bytes2` | 5 | yes | Sets a byte of the target's `UNIT_FIELD_BYTES_2` (sheath state, PvP flags, shapeshift form). | `.debug bytes2 <offset> <value>` | `.debug bytes2 1 1` |
| `.debug condition` | 2 |  | Evaluates a `conditions` table row against you and the target, and reports whether it passes. | `.debug condition <condition id>` | `.debug condition 1` |
| `.debug getitemstate` | 5 |  | Audits the item state cache of the selected player against the database and reports every mismatch. | `.debug getitemstate unchanged\|changed\|new\|removed\|queue\|all` | `.debug getitemstate unchanged` |
| `.debug lrecipient` | 3 |  | Shows which player or group currently owns the loot of the selected creature. | `.debug lrecipient` |  |
| `.debug getitemvalue` | 5 |  | Prints one update field of an item by GUID. | `.debug getitemvalue <item guid> <field index>` | `.debug getitemvalue 1 10` |
| `.debug getvaluebyindex` | 5 |  | Prints one update field of the target by its numeric index. | `.debug getvaluebyindex <field index>` | `.debug getvaluebyindex 10` |
| `.debug getvaluebyname` | 5 |  | Prints one update field of the target by its field name. | `.debug getvaluebyname <field name>` | `.debug getvaluebyname UNIT_FIELD_HEALTH` |
| `.debug getprevplaytime` | 5 |  | Shows how long the target's account had played before this session. | `.debug getprevplaytime` |  |
| `.debug moditemvalue` | 5 |  | Applies an arithmetic change to one update field of an item. | `.debug moditemvalue <item guid> <field index> <value>` | `.debug moditemvalue 1 10 1` |
| `.debug modvalue` | 5 |  | Applies an arithmetic change to one update field of the target. | `.debug modvalue <field index> <u\|i\|f> <value>` | `.debug modvalue 10 u 1` |
| `.debug play` | 2 |  | Container for the client playback commands. | *(sub-commands only)* | |
| `.debug play cinematic` | 2 |  | Plays a cinematic sequence for you. | `.debug play cinematic <cinematic id>` | `.debug play cinematic 1` |
| `.debug play sound` | 2 |  | Plays a sound id for you and everyone nearby. | `.debug play sound <sound id>` | `.debug play sound 1204` |
| `.debug play text` | 2 |  | Plays a `script_texts` entry from the selected creature, with its sound and emote. | `.debug play text <text id>` | `.debug play text 1` |
| `.debug play music` | 2 |  | Plays a music track id for you. | `.debug play music <sound id> [player]` | `.debug play music 1204 Bobmage` |
| `.debug send` | 3 |  | Container for the commands that send a raw packet to your own client. | *(sub-commands only)* | |
| `.debug send buyerror` | 5 |  | Sends a vendor buy error code to your client. | `.debug send buyerror <buy error id>` | `.debug send buyerror 1` |
| `.debug send channelnotify` | 5 |  | Sends a chat channel notification of the given type to your client. | `.debug send channelnotify <notify code>` | `.debug send channelnotify 1` |
| `.debug send chatmmessage` | 5 |  | Sends a chat message of the given type to your client. | `.debug send chatmmessage <type>` | `.debug send chatmmessage 1` |
| `.debug send equiperror` | 5 |  | Sends an equip error code to your client. | `.debug send equiperror <equip error id>` | `.debug send equiperror 1` |
| `.debug send opcode` | 5 |  | Builds a packet from `opcode.txt` and sends it to your client. | `.debug send opcode` |  |
| `.debug send poi` | 5 |  | Sends a point of interest marker to your map. | `.debug send poi <icon> <flags>` | `.debug send poi 1 1` |
| `.debug send qpartymsg` | 5 |  | Sends a quest party message code to your client. | `.debug send qpartymsg <message id>` | `.debug send qpartymsg 1` |
| `.debug send qinvalidmsg` | 5 |  | Sends a quest invalid message code to your client. | `.debug send qinvalidmsg <invalid quest message id>` | `.debug send qinvalidmsg 1` |
| `.debug send mailerror` | 5 |  | Sends a mail result code to your client. | `.debug send mailerror <mail id> <mail action> <mail error>` | `.debug send mailerror 1 1 1` |
| `.debug send sellerror` | 5 |  | Sends a vendor sell error code to your client. | `.debug send sellerror <sell error id>` | `.debug send sellerror 1` |
| `.debug send spellfail` | 5 |  | Sends a spell cast failure code to your client. | `.debug send spellfail <failnum> [failarg1] [failarg2]` | `.debug send spellfail 10 1 1` |
| `.debug send visual` | 5 | yes | Plays a spell's visual effect on the target without casting it. | `.debug send visual <spell id>` | `.debug send visual 133` |
| `.debug send chanvisual` | 5 | yes | Plays a spell's channel visual on the target, or stops it. | `.debug send chanvisual <spell id, 0 = stop>` | `.debug send chanvisual 1` |
| `.debug send chanvisualnext` | 5 | yes | Steps to the next spell id and plays its channel visual, for hunting down a specific effect. | `.debug send chanvisualnext <spell id, -1 = stop>` | `.debug send chanvisualnext 1` |
| `.debug send impact` | 5 | yes | Plays a spell's impact visual on the target. | `.debug send impact <spell id>` | `.debug send impact 133` |
| `.debug send openbag` | 3 |  | Tells a player's client to open a bag slot. | `.debug send openbag` |  |
| `.debug send worldstate` | 5 |  | Sets a world state variable for your client only, which is what drives battleground scoreboards. | `.debug send worldstate <field> <value>` | `.debug send worldstate 10 1` |
| `.debug setaurastate` | 5 |  | Sets or clears an aura state flag on the target. | `.debug setaurastate <state>` | `.debug setaurastate 1` |
| `.debug setitemvalue` | 5 |  | Writes one update field of an item by GUID. | `.debug setitemvalue <item guid> <field index> <value>` | `.debug setitemvalue 1 10 1` |
| `.debug setvaluebyindex` | 5 |  | Writes one update field of the target by its numeric index. | `.debug setvaluebyindex <field index> <u\|i\|f> <value>` | `.debug setvaluebyindex 10 u 1` |
| `.debug setvaluebyname` | 5 |  | Writes one update field of the target by its field name, handling the field's real type. | `.debug setvaluebyname <field name> <value>` | `.debug setvaluebyname UNIT_FIELD_HEALTH 1` |
| `.debug setprevplaytime` | 5 |  | Overwrites the previously played time recorded for the target's account. | `.debug setprevplaytime <seconds>` | `.debug setprevplaytime 1` |
| `.debug spellcheck` | 7 | yes | Runs the `spell_check` table against the core's hardcoded spell expectations and logs the mismatches. | `.debug spellcheck` |  |
| `.debug spellcoefs` | 5 | yes | Prints a spell's computed direct and periodic damage and healing coefficients. | `.debug spellcoefs <spell id>` | `.debug spellcoefs 133` |
| `.debug spellmods` | 5 |  | Applies a spell modifier to the selected player, flat or percentage, for testing talents. | `.debug spellmods <type> <effect index> <spellmodop> <value>` | `.debug spellmods 1 10 1 1` |
| `.debug forceupdate` | 5 |  | Resends one update field of the target to your client. | `.debug forceupdate <field index>` | `.debug forceupdate 10` |
| `.debug los` | 5 |  | Runs a line of sight test between you and the target and reports which static or dynamic object blocks it. | `.debug los` |  |
| `.debug los check` | 5 |  | Same as `.debug los`: reports what blocks line of sight to the target. | `.debug los check` |  |
| `.debug los allow` | 5 |  | Toggles collision for one VMap model, so a blocking object can be identified and ignored. | `.debug los allow on\|off` | `.debug los allow on` |
| `.debug moveto` | 3 |  | Sends the selected unit to a position using the given movement flags. | `.debug moveto <move flags, hex>` | `.debug moveto 1` |
| `.debug movedistance` | 5 |  | Moves the selected unit the given number of yards away from you. | `.debug movedistance <distance>` | `.debug movedistance 2.0` |
| `.debug faceme` | 3 |  | Turns the selected unit to face you. | `.debug faceme` |  |
| `.debug assert` | 6 | yes | Deliberately fails an assertion, to test crash handling and the stack trace writer. | `.debug assert` |  |
| `.debug pvpcredit` | 5 |  | Awards honor for a fake kill of the given rank, to test honor calculation. | `.debug pvpcredit` |  |
| `.debug unitstate` | 3 |  | Prints the selected unit's `UnitState` bitmask, or sets it. | `.debug unitstate <unit stat>` | `.debug unitstate 1` |
| `.debug control` | 3 |  | Grants or removes client-side movement control of the selected player. | `.debug control on\|off` | `.debug control on` |
| `.debug monster` | 3 |  | Makes the selected unit emit a chat, yell, emote, whisper or channel message, for testing chat packets. | `.debug monster <chat type>` | `.debug monster 1` |
| `.debug time` | 6 | yes | Scales the server's time rate, or restores it to normal. | `.debug time <rate>` | `.debug time 2.0` |
| `.debug moveflags` | 3 |  | Prints the selected unit's movement flags, or sets them. | `.debug moveflags <flags>` | `.debug moveflags 1` |
| `.debug movespline` | 3 |  | Prints the state of the selected unit's current movement spline. | `.debug movespline` |  |
| `.debug movemotion` | 5 |  | Prints the selected unit's movement generator stack and its current state. | `.debug movemotion <movetype>` | `.debug movemotion 1` |
| `.debug factionchange_items` | 6 | yes | Checks `player_factionchange_items` for items with no opposite-faction counterpart and reports them. | `.debug factionchange_items` |  |
| `.debug loottable` | 5 | yes | Dumps a loot table (creature, gameobject, fishing or reference) with the computed chance of every entry. | `.debug loottable <loot table name> <loot id> [simulation count]` | `.debug loottable 1 1 10` |
| `.debug utf8overflow` | 6 | yes | Sends a deliberately oversized multi-byte string, to test the string truncation path. | `.debug utf8overflow` |  |
| `.debug chatfreeze` | 6 | yes | Sends the malformed chat packet that used to freeze the client, to verify the fix. | `.debug chatfreeze` |  |

## deleteitem

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.deleteitem` | 3 |  | Removes a number of an item from a character, searching bags, bank, mail and auctions. | `.deleteitem <item> [count] [player]` | `.deleteitem 2589 5 Bobmage` |

## demorph

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.demorph` | 3 |  | Restores the selected unit's real display id after `.modify morph`. | `.demorph` |  |

## deplenish

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.deplenish` | 3 |  | Sets the selected unit to 1 health and zero power. | `.deplenish` |  |

## die

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.die` | 0 |  | Kills the selected unit. Availability below gamemaster level is controlled by a config option. | `.die` | requires `Command.DieForPlayers = 1` below gamemaster level, and `Command.DieSelfKill = 1` to target yourself |

## dismount

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.dismount` | 0 |  | Dismounts the selected player. | `.dismount` |  |

## distance

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.distance` | 1 |  | Reports the distance between you and the target. | `.distance [player or creature link]` | `.distance 1` |

## escort

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.escort` | 2 |  | Container for the escort quest waypoint commands (`script_waypoint`). | *(sub-commands only)* | |
| `.escort create` | 5 |  | Creates an escort waypoint path for a creature and quest, starting at your position. | `.escort create <creature id> <quest id> <faction>` | `.escort create 299 45 1` |
| `.escort addwp` | 5 |  | Appends your current position as a waypoint of a creature's escort path, with an optional wait time. | `.escort addwp [creature id] [wait time ms] [waypoint id]` | `.escort addwp 299 5000 3` |
| `.escort modwp` | 5 |  | Moves one waypoint of a creature's escort path to your position and sets its wait time. | `.escort modwp <creature id> <waypoint id> [new wait time ms]` | `.escort modwp 299 1 5000` |
| `.escort clearwp` | 5 |  | Removes every `script_waypoint` entry for a creature. | `.escort clearwp <creature id>` | `.escort clearwp 299` |
| `.escort showwp` | 2 |  | Draws a creature's escort waypoints in the world as visual markers. | `.escort showwp <creature id>` | `.escort showwp 299` |
| `.escort hidewp` | 2 |  | Removes the visual waypoint markers created by `.escort showwp`. | `.escort hidewp` |  |

## event

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.event` | 3 | yes | Game event control. On its own, prints one event's schedule and state. | `.event <event id>` | `.event 1` |
| `.event list` | 3 | yes | Lists the game events, marking which are active. | `.event list [all]` | `.event list 1` |
| `.event start` | 4 | yes | Starts a game event now, regardless of its schedule. | `.event start <event id>` | `.event start 1` |
| `.event stop` | 4 | yes | Stops a running game event now. | `.event stop <event id>` | `.event stop 1` |
| `.event enable` | 5 | yes | Allows a game event to start on its own schedule again. | `.event enable <event id>` | `.event enable 1` |
| `.event disable` | 5 | yes | Stops a game event from ever starting on its schedule. | `.event disable <event id>` | `.event disable 1` |

## explorecheat

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.explorecheat` | 2 |  | Marks every area of the map explored for the selected player, or clears all exploration. | `.explorecheat 0\|1` | `.explorecheat 0` |

## fear

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.fear` | 3 |  | Makes the selected unit flee from you for a short time. | `.fear <duration>` | `.fear 10000` |

## freeze

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.freeze` | 2 |  | Roots the selected unit in place by applying the freeze aura (spell 9454). | `.freeze` |  |

## gm

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.gm` | 2 |  | Toggles GM mode: immunity, no aggro, and access to GM-only interactions. | `.gm on\|off` | `.gm on` |
| `.gm chat` | 1 |  | Toggles the GM tag on your chat messages. | `.gm chat on\|off` | `.gm chat on` |
| `.gm fly` | 3 |  | Toggles GM flight. Jumping cancels it. | `.gm fly on\|off` | `.gm fly on` |
| `.gm ingame` | 0 | yes | Lists the GMs currently online and whether they accept whispers. | `.gm ingame` |  |
| `.gm list` | 6 | yes | Lists every account with a GM level on this realm, online or not. | `.gm list` |  |
| `.gm visible` | 2 |  | Toggles whether players can see you. | `.gm visible on\|off\|<visibility level>` | `.gm visible on 60` |
| `.gm setview` | 2 |  | Moves your camera to the selected unit; use it on yourself to restore the view. | `.gm setview` |  |

## go

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.go` | 2 |  | Teleports you. On its own, takes a `.tele` location name. | `.go <x> <y> <z> [map id]` | `.go -8949.95 -132.49 83.53 0` |
| `.go creature` | 2 |  | Teleports you to a creature, by spawn GUID or by creature entry. | `.go creature <creature guid or creature id>` | `.go creature 299` |
| `.go graveyard` | 2 |  | Teleports you to a graveyard by id. | `.go graveyard <graveyard id>` | `.go graveyard 1` |
| `.go grid` | 2 |  | Teleports you to the centre of a grid cell on a map. | `.go grid <grid x> <grid y> [mapid]` | `.go grid 32 32 0` |
| `.go object` | 2 |  | Teleports you to a gameobject, by spawn GUID or by entry. | `.go object <gameobject guid or gameobject id>` | `.go object 3239` |
| `.go target` | 2 |  | Teleports you to the selected unit. | `.go target` |  |
| `.go taxinode` | 2 |  | Teleports you to a flight master node by id. | `.go taxinode <node id>` | `.go taxinode 2` |
| `.go trigger` | 2 |  | Teleports you to an area trigger, or to the place it teleports to. | `.go trigger <area trigger id>` | `.go trigger 1` |
| `.go zonexy` | 2 |  | Teleports you to zone-relative map coordinates, the ones the world map shows. | `.go zonexy <x> <y> <area>` | `.go zonexy -8949.95 -132.49 1519` |
| `.go xy` | 2 |  | Teleports you to X/Y on a map; the ground height is looked up. | `.go xy <x> <y> [mapid]` | `.go xy -8949.95 -132.49 0` |
| `.go xyz` | 2 |  | Teleports you to exact X/Y/Z coordinates. | `.go xyz <x> <y> <z> [mapid]` | `.go xyz -8949.95 -132.49 83.53 0` |
| `.go xyzo` | 2 |  | Teleports you to exact X/Y/Z coordinates with a facing. | `.go xyzo <x> <y> <z> <orientation> [mapid]` | `.go xyzo -8949.95 -132.49 83.53 3.14 0` |
| `.go forward` | 2 |  | Moves you the given distance along your current facing. | `.go forward <distance>` | `.go forward 2.0` |
| `.go up` | 2 |  | Moves you the given distance straight up, or down for a negative value. | `.go up <distance>` | `.go up 2.0` |
| `.go relative` | 2 |  | Moves you by an offset relative to your facing: forward, right and up. | `.go relative <forward/back> <left/right> <up/down>` | `.go relative 10 0 0` |
| `.go warsong` | 2 |  | Teleports you into the Warsong Gulch map. | `.go warsong` |  |
| `.go arathi` | 2 |  | Teleports you into the Arathi Basin map. | `.go arathi` |  |
| `.go alterac` | 2 |  | Teleports you into the Alterac Valley map. | `.go alterac` |  |

## gobject

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.gobject` | 2 |  | Container for the gameobject commands. | *(sub-commands only)* | |
| `.gobject add` | 5 |  | Spawns a gameobject permanently at your position and writes it to the `gameobject` table. | `.gobject add <gameobject id> [spawntime secs]` | `.gobject add 3239 5000` |
| `.gobject tmpadd` | 3 |  | Spawns a gameobject that lives only until it despawns or the server restarts; nothing is saved. | `.gobject tmpadd <gameobject id>` | `.gobject tmpadd 3239` |
| `.gobject delete` | 5 |  | Deletes a gameobject spawn from the world and the database. Refuses if a script references its GUID. | `.gobject delete <gameobject guid>` | `.gobject delete 12345` |
| `.gobject move` | 3 |  | Moves a gameobject spawn to your position, or to given coordinates, and saves it. | `.gobject move <gameobject guid> <x> <y> <z>` | `.gobject move 12345 -8949.95 -132.49 83.53` |
| `.gobject near` | 2 |  | Lists the gameobject spawns within the given distance of you. | `.gobject near [distance]` | `.gobject near 2.0` |
| `.gobject target` | 3 |  | Finds the nearest gameobject spawn, by entry or by name, and prints its details. | `.gobject target <gameobject id>` | `.gobject target 3239` |
| `.gobject turn` | 3 |  | Turns a gameobject spawn to your facing and saves it. | `.gobject turn <gameobject guid> [o]` | `.gobject turn 12345 1` |
| `.gobject info` | 2 |  | Prints a gameobject's entry, GUID, type, display id, state and flags. | `.gobject info <gameobject guid>` | `.gobject info 12345` |
| `.gobject ufinfo` | 5 |  | Prints the raw update fields of a gameobject. | `.gobject ufinfo <gameobject guid>` | `.gobject ufinfo 12345` |
| `.gobject select` | 2 |  | Selects the nearest gameobject, so the following `.gobject` commands act on it. | `.gobject select` |  |
| `.gobject despawn` | 3 |  | Despawns the selected gameobject until its respawn timer elapses. | `.gobject despawn` |  |
| `.gobject toggle` | 3 |  | Flips the selected gameobject between its ready and activated states. | `.gobject toggle <gameobject guid>` | `.gobject toggle 12345` |
| `.gobject reset` | 3 |  | Resets the selected gameobject's state and loot to its spawn defaults. | `.gobject reset` |  |
| `.gobject respawn` | 3 |  | Respawns the selected gameobject immediately. | `.gobject respawn` |  |
| `.gobject use` | 3 |  | Uses the selected gameobject as a player would, running its loot or script. | `.gobject use` |  |
| `.gobject setgostate` | 3 |  | Sets a gameobject's GO state (ready, activated, destroyed). | `.gobject setgostate <gameobject guid> <go state>` | `.gobject setgostate 12345 1` |
| `.gobject setlootstate` | 3 |  | Sets a gameobject's loot state (not ready, ready, activated, just deactivated). | `.gobject setlootstate <gameobject guid> <loot state>` | `.gobject setlootstate 12345 1` |
| `.gobject customanim` | 3 |  | Plays a custom animation on a gameobject. | `.gobject customanim <gameobject guid> <anim id>` | `.gobject customanim 12345 1` |
| `.gobject spawnanim` | 3 |  | Plays a gameobject's spawn animation. | `.gobject spawnanim <gameobject guid>` | `.gobject spawnanim 12345` |
| `.gobject despawnanim` | 3 |  | Plays a gameobject's despawn animation. | `.gobject despawnanim <gameobject guid>` | `.gobject despawnanim 12345` |

## gocorpse

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.gocorpse` | 2 |  | Teleports you to a player's corpse. | `.gocorpse [player]` | `.gocorpse Bobmage` |

## gold

> **Runtime-verified correction:**
> `.gold add` requires unit suffixes on the money values: `#g #s #c`. Bare numeric values such as
> `.gold add Bobmage 5 20 50` are rejected as an ill-formed gold addition command.

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.gold` | 4 | yes | Container for the money commands, which take gold, silver and copper separately. | *(sub-commands only)* | |
| `.gold add` | 4 |  | Adds gold, silver and copper to a character and reports the balance before and after. Values require `g`, `s`, `c` suffixes. | `.gold add <player name> <gold>g <silver>s <copper>c` | `.gold add Bobmage 5g 20s 50c` |
| `.gold remove` | 4 |  | Takes gold, silver and copper from a character and reports the balance before and after. | `.gold remove <player name> <gold> <silver> <copper>` | `.gold remove Bobmage 5 20 50` |

## goname

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.goname` | 2 |  | Teleports you to a player, online or offline. Refuses to cross battleground and instance boundaries that would strand you. | `.goname [player]` | `.goname Bobmage` |

## gps

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.gps` | 1 |  | Prints where you or the target are: map, zone, area, grid and cell, height, liquid status and whether the position is indoors. | `.gps [player or creature link]` | `.gps 1` |

## group

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.group` | 3 | yes | Container for the commands that act on your whole group at once. | *(sub-commands only)* | |
| `.group additem` | 3 |  | Gives an item to every member of your group. | `.group additem <item id> [count]` | `.group additem 2589 5` |
| `.group revive` | 3 |  | Resurrects every dead member of your group. | `.group revive` |  |
| `.group replenish` | 3 |  | Restores health and power for every member of your group. | `.group replenish` |  |
| `.group summon` | 3 |  | Sends a summon request to every member of your group. | `.group summon` |  |

## groupgo

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.groupgo` | 2 |  | Summons a player's entire group to you. | `.groupgo [player]` | `.groupgo Bobmage` |

## groupinfo

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.groupinfo` | 2 | yes | Prints a group's composition: whether it is a party or a raid, its members and their state. | `.groupinfo [player]` | `.groupinfo Bobmage` |

## groupspell

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.groupspell` | 6 | yes | Container for the spell group stacking rule commands. | *(sub-commands only)* | |
| `.groupspell add` | 6 | yes | Adds a spell to a spell group in `spell_group`, which controls which auras stack. | `.groupspell add <spell id> <group id>` | `.groupspell add 133 1` |
| `.groupspell rule` | 6 | yes | Sets a spell group's stacking rule in `spell_group_stack_rules`. | `.groupspell rule <group id> <rule id>` | `.groupspell rule 1 1` |

## guid

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.guid` | 1 |  | Prints the GUID of the selected object. | `.guid` |  |

## guild

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.guild` | 3 | yes | Container for the guild commands. | *(sub-commands only)* | |
| `.guild create` | 3 | yes | Creates a guild with the given leader and name. | `.guild create [player] "<guild name>"` | `.guild create Bobmage "My Guild"` |
| `.guild delete` | 4 | yes | Disbands a guild by name. | `.guild delete "<guild name>"` | `.guild delete "My Guild"` |
| `.guild invite` | 3 | yes | Adds a player to a guild directly, skipping the invitation. | `.guild invite [player] "<guild name>"` | `.guild invite Bobmage "My Guild"` |
| `.guild uninvite` | 3 | yes | Removes a player from their guild. | `.guild uninvite [player]` | `.guild uninvite Bobmage` |
| `.guild rank` | 3 | yes | Sets a player's rank within their guild. | `.guild rank [player] <rank>` | `.guild rank Bobmage 0` |
| `.guild rename` | 4 | yes | Renames a guild. Players must relog to see the new name. | `.guild rename "<current name>" "<new name>"` | `.guild rename "Old Name" "New Name"` |
| `.guild showlog` | 3 | yes | Prints a guild's event log: joins, leaves, promotions and demotions, with timestamps. | `.guild showlog "<guild name>"` | `.guild showlog "My Guild"` |

## help

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.help` | 0 | yes | Prints the help text and syntax of a command. | `.help [command]` | `.help 1` |

## hidearea

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.hidearea` | 2 |  | Marks one area unexplored for the selected player. | `.hidearea <area id>` | `.hidearea 12` |

## honor

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.honor` | 3 |  | Container for the honor system commands. | *(sub-commands only)* | |
| `.honor add` | 4 |  | Adds honor points to a player. | `.honor add <honor amount>` | `.honor add 10` |
| `.honor addkill` | 4 |  | Credits the selected unit as an honorable kill. | `.honor addkill` |  |
| `.honor show` | 2 |  | Prints a player's honor standing: rank, rating, this week's and last week's kills and honor. | `.honor show` |  |
| `.honor setrp` | 4 |  | Sets a player's rank points directly, which is what drives the weekly rank calculation. | `.honor setrp <value>` | `.honor setrp 1` |
| `.honor reset` | 4 |  | Clears a player's honor: kills, points and rank. | `.honor reset` |  |

## hover

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.hover` | 2 |  | Toggles hovering for the selected unit. | `.hover [flag]` | `.hover 1` |

## instance

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.instance` | 2 | yes | Container for the instance and map commands. | *(sub-commands only)* | |
| `.instance continents` | 4 | yes | Lists the instances of the continent maps, with player counts and visibility distances. | `.instance continents` |  |
| `.instance getdata` | 3 |  | Reads one entry of the current instance's script data array. | `.instance getdata <index>` | `.instance getdata 10` |
| `.instance setdata` | 3 |  | Writes one entry of the current instance's script data array, to force an encounter state. | `.instance setdata <index> <value>` | `.instance setdata 10 1` |
| `.instance listbinds` | 3 |  | Lists the instances a player and their group are saved to, with expiry. | `.instance listbinds` |  |
| `.instance unbind` | 3 |  | Removes a player's saves, for one map or for all of them. | `.instance unbind all\|<map id>` | `.instance unbind all 1` |
| `.instance groupunbind` | 4 |  | Removes the group's saves and disbands the group. | `.instance groupunbind all\|<map id>` | `.instance groupunbind all 1` |
| `.instance stats` | 4 | yes | Prints global instance counters: instances loaded, players inside, saves stored and players bound. | `.instance stats` |  |
| `.instance savedata` | 4 |  | Forces the current instance to write its script data to the database now. | `.instance savedata` |  |
| `.instance switch` | 4 |  | Moves you to a different instance of the same map by instance id. | `.instance switch <new instance id>` | `.instance switch 1` |
| `.instance perfinfos` | 4 |  | Prints how many objects your client is currently tracking in this instance. | `.instance perfinfos` |  |
| `.instance smartrebind` | 2 |  | Toggles smart rebinding, which reuses an instance you are already saved to instead of creating a new one. | `.instance smartrebind on\|off` | `.instance smartrebind on` |

## itemmove

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.itemmove` | 3 |  | Moves an item between two inventory slots of your own character. | `.itemmove <source slot> <destination slot>` | `.itemmove 1 1` |

## kick

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.kick` | 2 | yes | Disconnects a player, with an optional reason. | `.kick [player]` | `.kick Bobmage` |

## knockback

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.knockback` | 3 |  | Knocks the selected unit back, with the given horizontal and vertical speed. | `.knockback <horizontal speed> <vertical speed>` | `.knockback 2.0 2.0` |

## learn

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.learn` | 5 |  | Teaches a spell to the selected player. | `.learn <spell id> [all]` | `.learn 133 1` |
| `.learn all` | 6 |  | Teaches every spell in the game to a player. | `.learn all` |  |
| `.learn all_gm` | 3 |  | Teaches the GM-only spells. | `.learn all_gm` |  |
| `.learn all_crafts` | 3 |  | Teaches every crafting profession at maximum skill. | `.learn all_crafts` |  |
| `.learn all_default` | 2 |  | Teaches the spells, skills and quests a character of that race and class starts with. | `.learn all_default [player]` | `.learn all_default Bobmage` |
| `.learn all_lang` | 1 |  | Teaches every spoken language. | `.learn all_lang` |  |
| `.learn all_myclass` | 5 |  | Teaches every spell and talent of your own class, and every flight path. | `.learn all_myclass` |  |
| `.learn all_myspells` | 5 |  | Teaches every spell of your own class you are high enough level for. | `.learn all_myspells` |  |
| `.learn all_mytalents` | 5 |  | Teaches every talent spell of your own class. | `.learn all_mytalents` |  |
| `.learn all_mytaxis` | 2 |  | Marks every flight path known, so all taxi nodes are usable. | `.learn all_mytaxis` |  |
| `.learn all_recipes` | 3 |  | Teaches every recipe of one profession, named by its skill. | `.learn all_recipes <profession name>` | `.learn all_recipes blacksmithing` |
| `.learn all_trainer` | 3 |  | Teaches every spell the selected trainer offers. | `.learn all_trainer <trainer id>` | `.learn all_trainer 1` |
| `.learn all_items` | 3 |  | Teaches every spell that any item in the game can teach. | `.learn all_items` |  |

## levelup

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.levelup` | 3 |  | Raises the selected player by the given number of levels, or lowers them for a negative value. | `.levelup [player] <levels>` | `.levelup Bobmage 5` |

## linkgrave

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.linkgrave` | 5 |  | Links the graveyard to the zone you are in, for one faction or both, so players resurrect there. | `.linkgrave <graveyard id> <team>` | `.linkgrave 1 alliance` |

## list

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.list` | 2 | yes | Container for the listing commands. | *(sub-commands only)* | |
| `.list auras` | 2 |  | Lists the auras on the selected unit, marking passives and talents, with stacks and duration. | `.list auras` |  |
| `.list creature` | 2 | yes | Lists the spawns of a creature entry, with their positions and distance from you. | `.list creature <creature id> [count]` | `.list creature 299 5` |
| `.list clicktomove` | 2 | yes | Lists the players currently using click-to-move. | `.list clicktomove` |  |
| `.list exploredareas` | 2 |  | Lists the areas the selected player has explored. | `.list exploredareas` |  |
| `.list item` | 2 | yes | Lists where copies of an item are: player inventories, mailboxes and auctions. | `.list item <item> [count]` | `.list item 2589 5` |
| `.list object` | 2 | yes | Lists the spawns of a gameobject entry, with their positions and distance from you. | `.list object <gameobject id> [count]` | `.list object 3239 5` |
| `.list talents` | 2 |  | Lists the talents the selected player has, and how many points are spent. | `.list talents` |  |
| `.list maps` | 2 | yes | Lists every map instance currently loaded, with its player count and age. | `.list maps` |  |
| `.list movegens` | 2 |  | Lists the selected unit's movement generator stack, innermost first. | `.list movegens` |  |
| `.list hostilerefs` | 2 |  | Lists the units that currently hold a threat reference to the selected unit. | `.list hostilerefs` |  |
| `.list threat` | 2 |  | Lists the selected unit's threat table with each attacker's threat value. | `.list threat` |  |
| `.list visibleguids` | 2 |  | Lists the objects the selected player's client currently knows about. | `.list visibleguids` |  |

## log

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.log` | 3 | yes | Prints one archived server log message by id, if your security level may see it. | `.log <log id>` | `.log 1` |

## lookup

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.lookup` | 1 | yes | Container for the search commands. Most take a name fragment and print clickable links. | *(sub-commands only)* | |
| `.lookup account` | 3 | yes | Container for the account search commands. | *(sub-commands only)* | |
| `.lookup account email` | 4 |  | Finds accounts by email address. | `.lookup account email <email> [limit]` | `.lookup account email 1 10` |
| `.lookup account ip` | 4 |  | Finds accounts by their last known IP address. | `.lookup account ip <ip search string> [limit]` | `.lookup account ip 1 10` |
| `.lookup account iponline` | 4 |  | Finds accounts currently online from a matching IP address. | `.lookup account iponline <ip search string> [limit]` | `.lookup account iponline 1 10` |
| `.lookup account name` | 3 |  | Finds accounts by name. | `.lookup account name <account> [limit]` | `.lookup account name testacc 10` |
| `.lookup area` | 2 | yes | Finds areas by name and prints clickable area links. | `.lookup area <name part>` | `.lookup area linen` |
| `.lookup creature` | 2 | yes | Finds creature templates by name. | `.lookup creature <name part>` | `.lookup creature linen` |
| `.lookup creaturemodel` | 2 | yes | Finds creature templates using a display id, and can export the result as SQL. | `.lookup creaturemodel <display id> [export]` | `.lookup creaturemodel 448 1` |
| `.lookup event` | 2 | yes | Finds game events by name, marking which are active. | `.lookup event <name part>` | `.lookup event linen` |
| `.lookup faction` | 2 | yes | Finds factions by name and shows your standing with them. | `.lookup faction <name part>` | `.lookup faction linen` |
| `.lookup item` | 2 | yes | Finds items by name. | `.lookup item <name part>` | `.lookup item linen` |
| `.lookup itemset` | 2 | yes | Finds item sets by name. | `.lookup itemset <name part>` | `.lookup itemset linen` |
| `.lookup object` | 2 | yes | Finds gameobject templates by name. | `.lookup object <name part>` | `.lookup object linen` |
| `.lookup quest` | 2 | yes | Finds quests by title, and shows their state for the selected player. | `.lookup quest <name part>` | `.lookup quest linen` |
| `.lookup player` | 1 | yes | Container for the commands that find characters through their account. | *(sub-commands only)* | |
| `.lookup player account` | 3 |  | Lists the characters belonging to accounts whose name matches. | `.lookup player account <account> [limit]` | `.lookup player account testacc 10` |
| `.lookup player email` | 4 |  | Lists the characters belonging to accounts with a matching email. | `.lookup player email <email> [limit]` | `.lookup player email 1 10` |
| `.lookup player ip` | 4 |  | Lists the characters belonging to accounts last seen on a matching IP. | `.lookup player ip <ip> [limit]` | `.lookup player ip 192.168.0.10 10` |
| `.lookup player name` | 1 |  | Lists the characters belonging to accounts whose name matches, by account name. | `.lookup player name <name> [limit]` | `.lookup player name 1 10` |
| `.lookup player character` | 2 |  | Finds characters by character name. | `.lookup player character <name> [limit]` | `.lookup player character 1 10` |
| `.lookup pool` | 2 | yes | Finds spawn pools by description. | `.lookup pool <name part>` | `.lookup pool linen` |
| `.lookup skill` | 2 | yes | Finds skills by name and shows the selected player's value in them. | `.lookup skill <name part>` | `.lookup skill linen` |
| `.lookup spell` | 2 | yes | Finds spells by name and shows whether the target knows them. | `.lookup spell <name part>` | `.lookup spell linen` |
| `.lookup sound` | 2 | yes | Finds sound entries by id or name. | `.lookup sound <name part>` | `.lookup sound linen` |
| `.lookup taxinode` | 2 | yes | Finds flight master nodes by name, with their map and coordinates. | `.lookup taxinode <name part>` | `.lookup taxinode linen` |
| `.lookup tele` | 2 | yes | Finds `.tele` locations by name and prints clickable teleport links. | `.lookup tele <name part>` | `.lookup tele linen` |
| `.lookup guild` | 1 | yes | Finds a guild by name and prints its leader, creation date, member count and message of the day. | `.lookup guild "<guild name>"` | `.lookup guild "My Guild"` |

## maxskill

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.maxskill` | 3 |  | Raises every skill the selected player knows to the maximum its level allows. | `.maxskill` |  |

## mmap

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.mmap` | 6 |  | Toggles server-wide movement map (pathfinding) use, or reports its state. | `.mmap on\|off` | `.mmap on` |
| `.mmap path` | 3 |  | Computes a path from you to the target and reports its type, length and points. | `.mmap path [straight]` | `.mmap path 1` |
| `.mmap loc` | 3 |  | Prints the navigation mesh tile and polygon under you, and the area flags there. | `.mmap loc` |  |
| `.mmap loadedtiles` | 3 |  | Lists the navigation mesh tiles loaded for the current map. | `.mmap loadedtiles` |  |
| `.mmap stats` | 3 |  | Prints navigation mesh statistics: maps loaded, tiles loaded and memory used. | `.mmap stats` |  |
| `.mmap testarea` | 3 |  | Generates a path from every creature within range to you, and reports how long it took. | `.mmap testarea <radius>` | `.mmap testarea 2.0` |
| `.mmap connect` | 6 |  | Records two points and writes them as an off-mesh connection, for linking unreachable areas. | `.mmap connect <radius> [cancel]` | `.mmap connect 2.0 1` |
| `.mmap reload` | 6 |  | Loads the navigation mesh tile under the given coordinates. | `.mmap reload` |  |
| `.mmap unload` | 6 |  | Unloads a map's navigation mesh. | `.mmap unload` |  |

## modify

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.modify` | 2 |  | Container for the commands that change a player's or creature's attributes. | *(sub-commands only)* | |
| `.modify hp` | 3 |  | Sets current and maximum health. | `.modify hp <hp> <max hp>` | `.modify hp 5000 5000` |
| `.modify mana` | 3 |  | Sets current and maximum mana. | `.modify mana <mana> <max mana>` | `.modify mana 3000 3000` |
| `.modify rage` | 3 |  | Sets current and maximum rage. | `.modify rage <rage min> <rage max>` | `.modify rage 100 100` |
| `.modify energy` | 3 |  | Sets current and maximum energy. | `.modify energy <energy min> <energy max>` | `.modify energy 100 100` |
| `.modify money` | 4 |  | Adds money, or takes it for a negative value. | `.modify money <copper>` | `.modify money 50` |
| `.modify speed` | 2 |  | Sets the run speed multiplier. | `.modify speed <rate 0.1-10>` | `.modify speed 2.0` |
| `.modify swim` | 2 |  | Sets the swim speed multiplier. | `.modify swim <rate 0.1-10>` | `.modify swim 2.0` |
| `.modify scale` | 3 |  | Sets the model scale. | `.modify scale <scale 0.1-10>` | `.modify scale 2.0` |
| `.modify bwalk` | 2 |  | Sets the backwards walk speed multiplier. | `.modify bwalk <rate 0.1-10>` | `.modify bwalk 2.0` |
| `.modify fly` | 2 |  | Sets the flight speed multiplier. | `.modify fly <rate 0.1-10>` | `.modify fly 2.0` |
| `.modify aspeed` | 2 |  | Sets every movement speed multiplier at once: run, swim, backwards and flight. | `.modify aspeed <rate 0.1-10>` | `.modify aspeed 2.0` |
| `.modify faction` | 3 |  | Sets the unit's faction template, and can print the current one. | `.modify faction <faction id> [flag] [npcflag] [dyflag]` | `.modify faction 72 1 1 1` |
| `.modify tp` | 4 |  | Sets the number of unspent talent points. | `.modify tp <talent points>` | `.modify tp 1` |
| `.modify mount` | 3 |  | Applies a mount display id and its speed to the player. | `.modify mount <mount display id>` | `.modify mount 2410` |
| `.modify honor` | 4 |  | Changes one honor field: points, rank, today's kills or yesterday's kills. | `.modify honor <points\|rank\|todaykills\|yesterdaykills\|yesterdayhonor\|thisweekkills\|thisweekhonor\|lastweekkills\|lastweekhonor\|lastweekstanding\|lifetimedishonorablekills\|lifetimehonorablekills> <amount>` | `.modify honor lifetimehonorablekills 100` |
| `.modify rep` | 4 |  | Sets or adjusts reputation with one faction, by value or by standing name. | `.modify rep <faction id> <amount or rank name> [delta]` | `.modify rep 72 100 1` |
| `.modify drunk` | 2 |  | Sets the drunkenness level. | `.modify drunk <drunk level 0-100>` | `.modify drunk 60` |
| `.modify exhaustion` | 3 |  | Sets the rest state, which drives the rested experience bonus. | `.modify exhaustion <rest state>` | `.modify exhaustion 1` |
| `.modify emotestate` | 3 |  | Sets the looping emote the unit plays. | `.modify emotestate <emote id>` | `.modify emotestate 4` |
| `.modify morph` | 3 |  | Changes the unit's display id. `.demorph` restores it. | `.modify morph <display id>` | `.modify morph 448` |
| `.modify gender` | 3 |  | Changes a character's gender, and its model with it. | `.modify gender male\|female` | `.modify gender male` |
| `.modify strength` | 4 |  | Sets base strength. | `.modify strength <amount>` | `.modify strength 100` |
| `.modify agility` | 4 |  | Sets base agility. | `.modify agility <amount>` | `.modify agility 100` |
| `.modify stamina` | 4 |  | Sets base stamina. | `.modify stamina <amount>` | `.modify stamina 100` |
| `.modify intellect` | 4 |  | Sets base intellect. | `.modify intellect <amount>` | `.modify intellect 100` |
| `.modify spirit` | 4 |  | Sets base spirit. | `.modify spirit <amount>` | `.modify spirit 100` |
| `.modify armor` | 4 |  | Sets the armor value. | `.modify armor <amount>` | `.modify armor 100` |
| `.modify holy` | 4 |  | Sets holy resistance. | `.modify holy <amount>` | `.modify holy 100` |
| `.modify fire` | 4 |  | Sets fire resistance. | `.modify fire <amount>` | `.modify fire 100` |
| `.modify nature` | 4 |  | Sets nature resistance. | `.modify nature <amount>` | `.modify nature 100` |
| `.modify frost` | 4 |  | Sets frost resistance. | `.modify frost <amount>` | `.modify frost 100` |
| `.modify shadow` | 4 |  | Sets shadow resistance. | `.modify shadow <amount>` | `.modify shadow 100` |
| `.modify arcane` | 4 |  | Sets arcane resistance. | `.modify arcane <amount>` | `.modify arcane 100` |
| `.modify ap` | 4 |  | Sets melee attack power. | `.modify ap <amount>` | `.modify ap 100` |
| `.modify rangeap` | 4 |  | Sets ranged attack power. | `.modify rangeap <amount>` | `.modify rangeap 100` |
| `.modify spellpower` | 4 |  | Sets spell damage and healing bonus. | `.modify spellpower <amount>` | `.modify spellpower 100` |
| `.modify crit` | 4 |  | Sets melee critical strike chance, as a percentage. | `.modify crit <amount>` | `.modify crit 100` |
| `.modify rangecrit` | 4 |  | Sets ranged critical strike chance, as a percentage. | `.modify rangecrit <amount>` | `.modify rangecrit 100` |
| `.modify spellcrit` | 4 |  | Sets spell critical strike chance, as a percentage, for every school. | `.modify spellcrit <amount>` | `.modify spellcrit 100` |
| `.modify mainspeed` | 4 |  | Sets the main hand weapon swing time, in seconds. | `.modify mainspeed <amount>` | `.modify mainspeed 100` |
| `.modify offspeed` | 4 |  | Sets the off hand weapon swing time, in seconds. | `.modify offspeed <amount>` | `.modify offspeed 100` |
| `.modify rangespeed` | 4 |  | Sets the ranged weapon swing time, in seconds. | `.modify rangespeed <amount>` | `.modify rangespeed 100` |
| `.modify castspeed` | 4 |  | Sets the casting speed modifier. | `.modify castspeed <amount>` | `.modify castspeed 100` |
| `.modify block` | 4 |  | Sets block chance, as a percentage. | `.modify block <amount>` | `.modify block 100` |
| `.modify dodge` | 4 |  | Sets dodge chance, as a percentage. | `.modify dodge <amount>` | `.modify dodge 100` |
| `.modify parry` | 4 |  | Sets parry chance, as a percentage. | `.modify parry <amount>` | `.modify parry 100` |
| `.modify combreach` | 4 |  | Sets the unit's combat reach, the distance at which it can melee. | `.modify combreach <value>` | `.modify combreach 1` |
| `.modify boundrad` | 4 |  | Sets the unit's bounding radius, its collision size. | `.modify boundrad <value>` | `.modify boundrad 1` |
| `.modify xprate` | 0 |  | Sets a personal experience rate multiplier for the selected player. | `.modify xprate <xp rate>` | `.modify xprate 2.0` |
| `.modify hairstyle` | 4 |  | Changes the character's hair style id. | `.modify hairstyle <hair style id>` | `.modify hairstyle 1` |
| `.modify haircolor` | 4 |  | Changes the character's hair colour id. | `.modify haircolor <hair color id>` | `.modify haircolor 1` |
| `.modify skincolor` | 4 |  | Changes the character's skin colour id. | `.modify skincolor <skin color id>` | `.modify skincolor 1` |
| `.modify accessories` | 4 |  | Changes the character's facial hair, markings or hooves id. | `.modify accessories <facial feature id>` | `.modify accessories 1` |

## mount

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.mount` | 3 |  | Mounts you on the selected creature's mount display, if it has one. | `.mount` |  |

## movegens

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.movegens` | 2 |  | Prints the selected unit's movement generator stack in detail, including each generator's target and state. | `.movegens` |  |

## mute

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.mute` | 1 | yes | Blocks a player from chatting for the given number of minutes. | `.mute [player] <minutes> [reason]` | `.mute Bobmage 30 Exploiting` |

## nameaura

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.nameaura` | 4 |  | Applies a spell's aura to a player by name rather than by selection. | `.nameaura [player] <spell id> [duration ms]` | `.nameaura Bobmage 133 30000` |

## namedie

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.namedie` | 3 |  | Kills a player by name. | `.namedie <player>` | `.namedie Bobmage` |

## namego

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.namego` | 2 |  | Summons a player to you by name, online or offline. | `.namego [player]` | `.namego Bobmage` |

## neargrave

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.neargrave` | 2 |  | Finds the graveyard a player of the given faction would resurrect at from here. | `.neargrave [alliance\|horde]` | `.neargrave alliance` |

## notify

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.notify` | 4 | yes | Sends a message that appears in the middle of every player's screen. | `.notify <message>` | `.notify Server restart in 5 minutes` |

## npc

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.npc` | 1 |  | Container for the creature commands. | *(sub-commands only)* | |
| `.npc additem` | 5 |  | Adds an item to the selected vendor's sell list, in `npc_vendor`. | `.npc additem <item> [maxcount] [incrtime] [itemflags]` | `.npc additem 2589 10 5000 1` |
| `.npc addweapon` | 3 |  | Puts an item into one of the selected creature's three equipment slots. | `.npc addweapon <item id> <slot 0-2: melee, offhand, ranged>` | `.npc addweapon 2589 0` |
| `.npc aiinfo` | 1 |  | Prints the selected creature's AI: script name, react state, movement generator and combat state. | `.npc aiinfo` |  |
| `.npc allowmove` | 3 |  | Toggles whether the selected creature moves during combat. | `.npc allowmove on\|off` | `.npc allowmove on` |
| `.npc allowattack` | 3 |  | Toggles whether the selected creature swings its weapon. | `.npc allowattack on\|off` | `.npc allowattack on` |
| `.npc despawn` | 3 |  | Despawns the selected creature until its respawn timer elapses. | `.npc despawn` |  |
| `.npc delitem` | 5 |  | Removes an item from the selected vendor's sell list. | `.npc delitem <item>` | `.npc delitem 2589` |
| `.npc evade` | 3 |  | Forces the selected creature to break combat and return to its spawn point. | `.npc evade` |  |
| `.npc follow` | 3 |  | Makes the selected creature follow you. | `.npc follow` |  |
| `.npc unfollow` | 3 |  | Stops the selected creature following you. | `.npc unfollow` |  |
| `.npc info` | 1 |  | Prints the selected creature's entry, GUID, level, faction, health, mana, flags and equipment. | `.npc info` |  |
| `.npc move` | 3 |  | Moves the selected creature to your position for this session only; the spawn point is not changed. | `.npc move [creature guid]` | `.npc move 12345` |
| `.npc playemote` | 2 |  | Plays an emote id on the selected creature. | `.npc playemote <emote id>` | `.npc playemote 4` |
| `.npc say` | 2 |  | Makes the selected creature say a message. | `.npc say <text>` | `.npc say Hello there` |
| `.npc summon` | 3 |  | Spawns a temporary creature at your position; it despawns after a time or on death. | `.npc summon <creature id>` | `.npc summon 299` |
| `.npc textemote` | 2 |  | Makes the selected creature perform a text emote. | `.npc textemote <text>` | `.npc textemote Hello there` |
| `.npc whisper` | 2 |  | Makes the selected creature whisper a message to a player. | `.npc whisper [player]` | `.npc whisper Bobmage` |
| `.npc yell` | 2 |  | Makes the selected creature yell a message. | `.npc yell <text>` | `.npc yell Hello there` |
| `.npc tame` | 3 |  | Tames the selected creature as your pet, ignoring the usual requirements. | `.npc tame` |  |
| `.npc spawn` | 1 |  | Container for the commands that change a permanent creature spawn in the database. | *(sub-commands only)* | |
| `.npc spawn add` | 5 |  | Spawns a creature permanently at your position and writes it to the `creature` table. | `.npc spawn add <creature id>` | `.npc spawn add 299` |
| `.npc spawn addentry` | 5 |  | Adds another creature entry to the selected spawn, so the spawn point picks randomly between them. | `.npc spawn addentry <creature id>` | `.npc spawn addentry 299` |
| `.npc spawn delete` | 5 |  | Deletes a creature spawn from the world and the database. Refuses if a script references its GUID. | `.npc spawn delete <creature guid>` | `.npc spawn delete 12345` |
| `.npc spawn info` | 1 |  | Prints the database record of the selected spawn: its entries, position, respawn time and visibility. | `.npc spawn info` |  |
| `.npc spawn set` | 5 |  | Container for the commands that edit one field of a permanent spawn. | *(sub-commands only)* | |
| `.npc spawn set entry` | 5 |  | Changes which creature entry a spawn uses, and saves it. | `.npc spawn set entry <creature id>` | `.npc spawn set entry 299` |
| `.npc spawn set displayid` | 5 |  | Overrides a spawn's display id in `creature_addon`. | `.npc spawn set displayid <display id>` | `.npc spawn set displayid 448` |
| `.npc spawn set emotestate` | 5 |  | Sets the looping emote of a spawn in `creature_addon`. | `.npc spawn set emotestate <emote id>` | `.npc spawn set emotestate 4` |
| `.npc spawn set standstate` | 5 |  | Sets the stand state (standing, sitting, sleeping, kneeling) of a spawn in `creature_addon`. | `.npc spawn set standstate <stand state>` | `.npc spawn set standstate 1` |
| `.npc spawn set sheathstate` | 5 |  | Sets whether a spawn shows its weapons sheathed, in `creature_addon`. | `.npc spawn set sheathstate <sheath state>` | `.npc spawn set sheathstate 1` |
| `.npc spawn set movetype` | 5 |  | Sets a spawn's movement type: idle, random or waypoint, and saves it. | `.npc spawn set movetype idle\|random\|waypoint\|cyclic` | `.npc spawn set movetype idle` |
| `.npc spawn set wanderdistance` | 5 |  | Sets how far a spawn may wander from its spawn point, and saves it. | `.npc spawn set wanderdistance <wander distance>` | `.npc spawn set wanderdistance 2.0` |
| `.npc spawn set respawntime` | 5 |  | Sets a spawn's minimum and maximum respawn time, and saves it. | `.npc spawn set respawntime <min seconds> <max seconds>` | `.npc spawn set respawntime 1 1` |
| `.npc spawn set deathstate` | 5 |  | Marks a spawn as dead or alive on server start, and saves it. | `.npc spawn set deathstate on\|off` | `.npc spawn set deathstate on` |
| `.npc spawn set auras` | 5 |  | Sets the auras a spawn is created with, in `creature_addon`. | `.npc spawn set auras <spell id> [spell id ...]` | `.npc spawn set auras 133 1` |
| `.npc spawn move` | 5 |  | Moves the selected spawn to your position and saves the new coordinates. | `.npc spawn move [creature guid]` | `.npc spawn move 12345` |
| `.npc spawn load` | 3 |  | Loads a creature spawn into the world by GUID, without a server restart. | `.npc spawn load <creature guid>` | `.npc spawn load 12345` |
| `.npc spawn unload` | 3 |  | Removes the selected spawn from the world without deleting it from the database. | `.npc spawn unload <creature guid>` | `.npc spawn unload 12345` |
| `.npc set` | 3 |  | Container for the commands that change the selected creature for this session only. | *(sub-commands only)* | |
| `.npc set entry` | 3 |  | Changes the selected creature's entry in place, without saving. | `.npc set entry <creature id>` | `.npc set entry 299` |
| `.npc set level` | 3 |  | Changes the selected creature's level and rescales its stats, without saving. | `.npc set level <level>` | `.npc set level 60` |
| `.npc set faction` | 3 |  | Changes the selected creature's faction, without saving. | `.npc set faction <faction id>` | `.npc set faction 72` |
| `.npc set flag` | 3 |  | Changes the selected creature's NPC flags (vendor, quest giver, trainer and so on), without saving. | `.npc set flag <npc flags>` | `.npc set flag 1` |
| `.npc set displayid` | 3 |  | Changes the selected creature's display id, without saving. | `.npc set displayid <display id>` | `.npc set displayid 448` |
| `.npc set movetype` | 3 |  | Changes the selected creature's movement type, without saving. | `.npc set movetype idle\|random\|waypoint\|cyclic` | `.npc set movetype idle` |
| `.npc set wanderdistance` | 3 |  | Changes how far the selected creature wanders, without saving. | `.npc set wanderdistance <wander distance>` | `.npc set wanderdistance 2.0` |
| `.npc set respawntime` | 3 |  | Changes the selected creature's respawn time, without saving. | `.npc set respawntime <seconds>` | `.npc set respawntime 1` |
| `.npc set reactstate` | 3 |  | Changes the selected creature's react state: passive, defensive or aggressive. | `.npc set reactstate <react state>` | `.npc set reactstate 1` |
| `.npc group` | 5 |  | Container for the creature formation and linking commands. | *(sub-commands only)* | |
| `.npc group add` | 5 |  | Puts the selected creature into a formation behind a leader, at the given angle and distance. | `.npc group add <leader guid> [options mask]` | `.npc group add 1 1` |
| `.npc group addrel` | 5 |  | Same as `.npc group add`, but takes the angle and distance from the creature's current position relative to the leader. | `.npc group addrel <leader guid> [options mask]` | `.npc group addrel 1 1` |
| `.npc group del` | 5 |  | Removes the selected creature from its formation. | `.npc group del` |  |
| `.npc group link` | 5 |  | Links the selected creature to a leader in `creature_linking`, so it reacts to the leader's aggro, evade and death. | `.npc group link <leader guid> [options mask]` | `.npc group link 1 1` |

## partybot

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.partybot` | 6 |  | Container for the party bot commands. Party bots are temporary group members you control. | *(sub-commands only)* | |
| `.partybot add` | 6 |  | Adds a party bot of the given class and role to your group. | `.partybot add <value> <bot level>` | `.partybot add 1 60` |
| `.partybot clone` | 6 |  | Adds a party bot copied from the selected player's class, level and gear. | `.partybot clone` |  |
| `.partybot load` | 6 |  | Loads an existing offline character into your group as a party bot. | `.partybot load <player name>` | `.partybot load Bobmage` |
| `.partybot setrole` | 6 |  | Changes a party bot's role: tank, melee damage, ranged damage or healer. | `.partybot setrole tank\|healer\|dps\|meleedps\|rangedps` | `.partybot setrole tank` |
| `.partybot attackstart` | 6 |  | Orders every party bot to attack the selected target. | `.partybot attackstart` |  |
| `.partybot attackstop` | 6 |  | Orders every party bot to stop attacking the selected target. | `.partybot attackstop` |  |
| `.partybot pull` | 6 |  | Orders the tank bots to pull the target while the damage bots hold for a few seconds. | `.partybot pull <duration>` | `.partybot pull 10000` |
| `.partybot aoe` | 6 |  | Orders every party bot to use its area spells on the target. | `.partybot aoe` |  |
| `.partybot caststart` | 6 |  | Orders the party bots to start casting the spell you are casting. | `.partybot caststart` |  |
| `.partybot caststop` | 6 |  | Orders the party bots to stop casting. | `.partybot caststop` |  |
| `.partybot ccmark` | 6 |  | Assigns a raid target mark to a party bot as its crowd control target. | `.partybot ccmark star\|circle\|diamond\|triangle\|moon\|square\|cross\|skull` | `.partybot ccmark star` |
| `.partybot focusmark` | 6 |  | Assigns a raid target mark to a party bot as its focus target. | `.partybot focusmark star\|circle\|diamond\|triangle\|moon\|square\|cross\|skull` | `.partybot focusmark star` |
| `.partybot clearmarks` | 6 |  | Clears the mark assignments of one party bot, or of all of them. | `.partybot clearmarks` |  |
| `.partybot cometome` | 6 |  | Orders one party bot, or all of them, to walk to your position. | `.partybot cometome` |  |
| `.partybot usegobject` | 6 |  | Orders the party bots within range to use a gameobject. | `.partybot usegobject` |  |
| `.partybot pause` | 6 |  | Suspends the party bots' AI, leaving them standing. | `.partybot pause` |  |
| `.partybot unpause` | 6 |  | Resumes the party bots' AI. | `.partybot unpause` |  |
| `.partybot unequip` | 6 |  | Removes an item from a party bot's equipment. | `.partybot unequip <item>` | `.partybot unequip 2589` |
| `.partybot remove` | 6 |  | Removes a party bot from your group and the world. | `.partybot remove` |  |

## pbcast

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.pbcast` | 6 | yes | Prints packet broadcaster statistics: thread count, update times and packets sent. | `.pbcast` |  |
| `.pbcast stats` | 6 | yes | Same as `.pbcast`: prints the packet broadcaster statistics. | `.pbcast stats` |  |
| `.pbcast setthreads` | 6 | yes | Changes the number of packet broadcaster threads, or disables broadcasting with zero. | `.pbcast setthreads <num threads after>` | `.pbcast setthreads 10` |

## pdump

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.pdump` | 6 | yes | Container for the character dump commands. | *(sub-commands only)* | |
| `.pdump load` | 6 | yes | Restores a character from a dump file onto an account, optionally under a new name or GUID. | `.pdump load <file name> <account> [new character name] [new guid]` | `.pdump load dump.txt testacc Newname 42` |
| `.pdump write` | 6 | yes | Writes a character to a dump file that `.pdump load` can restore. | `.pdump write <file name> <player name or guid>` | `.pdump write dump.txt Bobmage` |

## pet

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.pet` | 3 | yes | Container for the pet commands. | *(sub-commands only)* | |
| `.pet learnspell` | 5 |  | Teaches a spell to the selected player's pet. | `.pet learnspell [spell id]` | `.pet learnspell 133` |
| `.pet unlearnspell` | 5 |  | Removes a spell from the selected player's pet. | `.pet unlearnspell [spell id]` | `.pet unlearnspell 133` |
| `.pet list` | 3 | yes | Lists a character's pets, marking the active one and the stabled ones. | `.pet list <player name>` | `.pet list Bobmage` |
| `.pet rename` | 3 | yes | Renames a pet by its pet number. | `.pet rename <pet id>` | `.pet rename 1` |
| `.pet delete` | 3 | yes | Deletes a pet by its pet number. | `.pet delete <pet id>` | `.pet delete 1` |
| `.pet loyalty` | 3 |  | Sets the pet's loyalty points, or prints them. | `.pet loyalty [loyalty points]` | `.pet loyalty 1` |
| `.pet info` | 1 |  | Prints a pet's owner, type, loyalty level, happiness and training points. | `.pet info` |  |

## pinfo

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.pinfo` | 2 |  | Prints everything known about a player: account, level, money, IP, played time, guild and last login. | `.pinfo [player]` | `.pinfo Bobmage` |

## pool

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.pool` | 3 | yes | Spawn pool information. On its own, prints one pool's contents and spawn chances. | `.pool <pool id>` | `.pool 1` |
| `.pool list` | 3 |  | Lists the spawn pools active on the map you are on. | `.pool list` |  |
| `.pool update` | 6 |  | Respawns a pool now, picking new members from its candidates. | `.pool update <pool id>` | `.pool update 1` |
| `.pool spawns` | 3 |  | Lists the creatures and gameobjects a pool currently has spawned. | `.pool spawns <pool id>` | `.pool spawns 1` |

## possess

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.possess` | 3 |  | Takes direct control of the selected unit. | `.possess` |  |

## pvp

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.pvp` | 3 |  | Turns the PvP flag on or off for the selected unit. | `.pvp on\|off` | `.pvp on` |

## quest

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.quest` | 3 |  | Container for the quest commands. They act on the selected player. | *(sub-commands only)* | |
| `.quest add` | 4 |  | Adds a quest to the player's log, regardless of its requirements. | `.quest add <quest id> [player]` | `.quest add 45 Bobmage` |
| `.quest complete` | 4 |  | Marks every objective of a quest complete, so it can be turned in. | `.quest complete <quest id> [player]` | `.quest complete 45 Bobmage` |
| `.quest status` | 3 |  | Prints a quest's state for the player: objectives, counts and what was rewarded. | `.quest status <quest id> [player]` | `.quest status 45 Bobmage` |
| `.quest remove` | 3 |  | Removes a quest from the player's log and clears its recorded state. | `.quest remove <quest id> [player]` | `.quest remove 45 Bobmage` |

## quit

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.quit` | 7 | yes | Shuts the server down. Console only, and refuses to run from a chat session. | `.quit` |  |

## recall

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.recall` | 1 |  | Teleports a player back to where they were before their last GM teleport. | `.recall [player]` | `.recall Bobmage` |

## reload

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.reload` | 5 | yes | Container for the commands that re-read a database table without restarting the server. | *(sub-commands only)* | |
| `.reload all` | 6 | yes | Reloads every table these commands cover, except the ones that need a restart. | `.reload all` |  |
| `.reload all_area` | 6 | yes | Reloads the area trigger tables: teleports, taverns and quest triggers. | `.reload all_area` |  |
| `.reload all_gossips` | 6 | yes | Reloads the gossip menu, gossip option and NPC gossip tables. | `.reload all_gossips` |  |
| `.reload all_item` | 6 | yes | Reloads the item templates and the item required target table. | `.reload all_item` |  |
| `.reload all_locales` | 6 | yes | Reloads every `locales_*` translation table. | `.reload all_locales` |  |
| `.reload all_loot` | 6 | yes | Reloads every `*_loot_template` table. | `.reload all_loot` |  |
| `.reload all_npc` | 6 | yes | Reloads the vendor and trainer tables. | `.reload all_npc` |  |
| `.reload all_quest` | 6 | yes | Reloads every quest relation table, for creatures and gameobjects. | `.reload all_quest` |  |
| `.reload all_scripts` | 6 | yes | Reloads every `*_scripts` table. Refuses while a script is running. | `.reload all_scripts` |  |
| `.reload all_spell` | 6 | yes | Reloads the spell definition and spell rule tables. | `.reload all_spell` |  |
| `.reload anticheat` | 6 | yes | Reloads the anticheat configuration and its data. | `.reload anticheat` |  |
| `.reload config` | 6 | yes | Re-reads `mangosd.conf`. Settings read only at startup are not affected. | `.reload config` |  |
| `.reload account_banned` | 6 | yes | Reloads the account ban list from the login database. | `.reload account_banned` |  |
| `.reload areatrigger_involvedrelation` | 5 | yes | Reloads the quest-completing area triggers. | `.reload areatrigger_involvedrelation` |  |
| `.reload areatrigger_tavern` | 5 | yes | Reloads the inn area triggers that grant rested state. | `.reload areatrigger_tavern` |  |
| `.reload areatrigger_teleport` | 5 | yes | Reloads the area triggers that teleport, and their requirements. | `.reload areatrigger_teleport` |  |
| `.reload autobroadcast` | 6 | yes | Reloads the automatic broadcast messages. | `.reload autobroadcast` |  |
| `.reload character_pet` | 6 | yes | Reloads one pet's record from the character database. | `.reload character_pet <pet id>` | `.reload character_pet 1` |
| `.reload cinematic_waypoints` | 5 | yes | Reloads the camera paths used during cinematics. | `.reload cinematic_waypoints` |  |
| `.reload command` | 6 | yes | Marks the `command` table for reload, applied the next time a command is used. | `.reload command` |  |
| `.reload conditions` | 5 | yes | Reloads the `conditions` table used by gossip, loot and scripts. | `.reload conditions` |  |
| `.reload creature` | 5 | yes | Reloads the creature spawn table. | `.reload creature` |  |
| `.reload creature_ai_events` | 5 | yes | Reloads the EventAI event and action tables. | `.reload creature_ai_events` |  |
| `.reload creature_battleground` | 5 | yes | Reloads the battleground creature and gameobject event indexes. | `.reload creature_battleground` |  |
| `.reload creature_display_info_addon` | 5 | yes | Reloads the per-display model data used for scaling and sounds. | `.reload creature_display_info_addon` |  |
| `.reload creature_groups` | 5 | yes | Reloads the creature formation definitions. | `.reload creature_groups` |  |
| `.reload creature_involvedrelation` | 5 | yes | Reloads which creatures accept which quest turn-ins. | `.reload creature_involvedrelation` |  |
| `.reload creature_loot_template` | 5 | yes | Reloads the creature loot tables. | `.reload creature_loot_template` |  |
| `.reload creature_onkill_reputation` | 5 | yes | Reloads the reputation awarded for killing a creature. | `.reload creature_onkill_reputation` |  |
| `.reload creature_questrelation` | 5 | yes | Reloads which creatures offer which quests. | `.reload creature_questrelation` |  |
| `.reload creature_spells` | 5 | yes | Reloads the creature spell lists used by their AI. | `.reload creature_spells` |  |
| `.reload creature_spells_scripts` | 5 | yes | Reloads the scripts creature spells can trigger. Refuses while a script is running. | `.reload creature_spells_scripts` |  |
| `.reload creature_template` | 5 | yes | Reloads every creature template, or just one when an entry is given. | `.reload creature_template <entry id>` | `.reload creature_template 1` |
| `.reload disenchant_loot_template` | 5 | yes | Reloads the disenchanting loot tables. | `.reload disenchant_loot_template` |  |
| `.reload event_scripts` | 5 | yes | Reloads the event scripts. Refuses while a script is running. | `.reload event_scripts` |  |
| `.reload exploration_basexp` | 5 | yes | Reloads the base experience granted for discovering an area. | `.reload exploration_basexp` |  |
| `.reload fishing_loot_template` | 5 | yes | Reloads the fishing loot tables. | `.reload fishing_loot_template` |  |
| `.reload game_graveyard_zone` | 5 | yes | Reloads which graveyard serves which zone. | `.reload game_graveyard_zone` |  |
| `.reload game_tele` | 5 | yes | Reloads the `.tele` location list. | `.reload game_tele` |  |
| `.reload game_weather` | 5 | yes | Reloads the per-zone weather chances. | `.reload game_weather` |  |
| `.reload gameobject` | 5 | yes | Reloads the gameobject spawn table. | `.reload gameobject` |  |
| `.reload gameobject_battleground` | 5 | yes | Reloads the battleground creature and gameobject event indexes. | `.reload gameobject_battleground` |  |
| `.reload gameobject_involvedrelation` | 5 | yes | Reloads which gameobjects accept which quest turn-ins. | `.reload gameobject_involvedrelation` |  |
| `.reload gameobject_loot_template` | 5 | yes | Reloads the gameobject loot tables. | `.reload gameobject_loot_template` |  |
| `.reload gameobject_questrelation` | 5 | yes | Reloads which gameobjects offer which quests. | `.reload gameobject_questrelation` |  |
| `.reload gameobject_requirement` | 5 | yes | Reloads the extra requirements for using a gameobject. | `.reload gameobject_requirement` |  |
| `.reload gameobject_scripts` | 5 | yes | Reloads the gameobject scripts. Refuses while a script is running. | `.reload gameobject_scripts` |  |
| `.reload gameobject_template` | 5 | yes | Reloads every gameobject template, or just one when an entry is given. | `.reload gameobject_template <entry id>` | `.reload gameobject_template 1` |
| `.reload generic_scripts` | 5 | yes | Reloads the generic scripts. Refuses while a script is running. | `.reload generic_scripts` |  |
| `.reload gossip_menu` | 5 | yes | Reloads the gossip menu table. | `.reload gossip_menu` |  |
| `.reload gossip_menu_option` | 5 | yes | Reloads the gossip menu option table. | `.reload gossip_menu_option` |  |
| `.reload gossip_scripts` | 5 | yes | Reloads the gossip scripts. Refuses while a script is running. | `.reload gossip_scripts` |  |
| `.reload instance_buff_removal` | 5 | yes | Reloads the list of auras stripped on entering an instance. | `.reload instance_buff_removal` |  |
| `.reload ip_banned` | 6 | yes | Reloads the IP ban list from the login database. | `.reload ip_banned` |  |
| `.reload item_enchantment_template` | 5 | yes | Reloads the random item enchantment (suffix) tables. | `.reload item_enchantment_template` |  |
| `.reload item_loot_template` | 5 | yes | Reloads the loot tables of containers and lootable items. | `.reload item_loot_template` |  |
| `.reload item_required_target` | 5 | yes | Reloads the target requirements for items that must be used on something. | `.reload item_required_target` |  |
| `.reload item_template` | 5 | yes | Reloads the item templates. | `.reload item_template` |  |
| `.reload locales_creature` | 5 | yes | Reloads the creature name translations. | `.reload locales_creature` |  |
| `.reload locales_gameobject` | 5 | yes | Reloads the gameobject name translations. | `.reload locales_gameobject` |  |
| `.reload locales_gossip_menu_option` | 5 | yes | Reloads the gossip option translations. | `.reload locales_gossip_menu_option` |  |
| `.reload locales_item` | 5 | yes | Reloads the item name and description translations. | `.reload locales_item` |  |
| `.reload locales_page_text` | 5 | yes | Reloads the page text translations. | `.reload locales_page_text` |  |
| `.reload locales_points_of_interest` | 5 | yes | Reloads the point of interest translations. | `.reload locales_points_of_interest` |  |
| `.reload locales_quest` | 5 | yes | Reloads the quest text translations. | `.reload locales_quest` |  |
| `.reload mail_loot_template` | 5 | yes | Reloads the loot tables used for quest and event mail attachments. | `.reload mail_loot_template` |  |
| `.reload mangos_string` | 5 | yes | Reloads the server's own message strings. | `.reload mangos_string` |  |
| `.reload map_loot_disabled` | 5 | yes | Reloads the per-map loot suppression list. | `.reload map_loot_disabled` |  |
| `.reload map_template` | 5 | yes | Reloads the map definitions, including their entry requirements. | `.reload map_template` |  |
| `.reload npc_gossip` | 5 | yes | Reloads the per-creature gossip text assignments. | `.reload npc_gossip` |  |
| `.reload npc_text` | 5 | yes | Reloads the gossip texts creatures speak. | `.reload npc_text` |  |
| `.reload npc_trainer` | 5 | yes | Reloads the trainer spell lists and their templates. | `.reload npc_trainer` |  |
| `.reload npc_vendor` | 5 | yes | Reloads the vendor item lists and their templates. | `.reload npc_vendor` |  |
| `.reload page_text` | 5 | yes | Reloads the page texts shown by books and documents. | `.reload page_text` |  |
| `.reload pet_name_generation` | 5 | yes | Reloads the name fragments used for generated pet names. | `.reload pet_name_generation` |  |
| `.reload petitions` | 6 | yes | Reloads the guild charter (petition) records. | `.reload petitions` |  |
| `.reload pickpocketing_loot_template` | 5 | yes | Reloads the pickpocketing loot tables. | `.reload pickpocketing_loot_template` |  |
| `.reload player_factionchange_items` | 5 | yes | Reloads the item mapping used when a character changes faction. | `.reload player_factionchange_items` |  |
| `.reload player_factionchange_mounts` | 5 | yes | Reloads the mount mapping used when a character changes faction. | `.reload player_factionchange_mounts` |  |
| `.reload player_factionchange_quests` | 5 | yes | Reloads the quest mapping used when a character changes faction. | `.reload player_factionchange_quests` |  |
| `.reload player_factionchange_reputations` | 5 | yes | Reloads the reputation mapping used when a character changes faction. | `.reload player_factionchange_reputations` |  |
| `.reload player_factionchange_spells` | 5 | yes | Reloads the spell mapping used when a character changes faction. | `.reload player_factionchange_spells` |  |
| `.reload points_of_interest` | 5 | yes | Reloads the map markers gossip options can point at. | `.reload points_of_interest` |  |
| `.reload quest_end_scripts` | 5 | yes | Reloads the quest turn-in scripts. Refuses while a script is running. | `.reload quest_end_scripts` |  |
| `.reload quest_greeting` | 5 | yes | Reloads the greeting text quest givers show. | `.reload quest_greeting` |  |
| `.reload quest_start_scripts` | 5 | yes | Reloads the quest accept scripts. Refuses while a script is running. | `.reload quest_start_scripts` |  |
| `.reload quest_template` | 5 | yes | Reloads the quest definitions and rebuilds the quest gameobject relations. | `.reload quest_template` |  |
| `.reload reference_loot_template` | 5 | yes | Reloads the shared loot tables other loot tables refer to. | `.reload reference_loot_template` |  |
| `.reload reputation_reward_rate` | 5 | yes | Reloads the per-faction reputation gain multipliers. | `.reload reputation_reward_rate` |  |
| `.reload reputation_spillover_template` | 5 | yes | Reloads the rules that spread reputation to allied factions. | `.reload reputation_spillover_template` |  |
| `.reload reserved_name` | 6 | yes | Reloads the list of character names players may not use. | `.reload reserved_name` |  |
| `.reload skill_fishing_base_level` | 5 | yes | Reloads the fishing skill required per zone. | `.reload skill_fishing_base_level` |  |
| `.reload skinning_loot_template` | 5 | yes | Reloads the skinning loot tables. | `.reload skinning_loot_template` |  |
| `.reload spell_area` | 5 | yes | Reloads the auras applied or removed by area, quest state or aura state. | `.reload spell_area` |  |
| `.reload spell_chain` | 5 | yes | Reloads the spell rank chains. | `.reload spell_chain` |  |
| `.reload spell_disabled` | 5 | yes | Reloads the list of disabled spells. | `.reload spell_disabled` |  |
| `.reload spell_elixir` | 5 | yes | Reloads the battle/guardian/flask classification of elixirs. | `.reload spell_elixir` |  |
| `.reload spell_group` | 5 | yes | Reloads the spell group membership used for aura stacking. | `.reload spell_group` |  |
| `.reload spell_group_stack_rules` | 5 | yes | Reloads the stacking rule of each spell group. | `.reload spell_group_stack_rules` |  |
| `.reload spell_learn_spell` | 5 | yes | Reloads which spells teach other spells when learned. | `.reload spell_learn_spell` |  |
| `.reload spell_mod` | 5 | yes | Reloads the `spell_mod` overrides applied on top of the DBC spell data. | `.reload spell_mod` |  |
| `.reload spell_pet_auras` | 5 | yes | Reloads the auras a pet inherits from its owner's talents. | `.reload spell_pet_auras` |  |
| `.reload spell_proc_event` | 5 | yes | Reloads the conditions under which spells proc. | `.reload spell_proc_event` |  |
| `.reload spell_proc_item_enchant` | 5 | yes | Reloads the procs-per-minute rates of weapon enchantments. | `.reload spell_proc_item_enchant` |  |
| `.reload spell_script_target` | 5 | yes | Reloads the creature and gameobject targets scripted spells must pick. | `.reload spell_script_target` |  |
| `.reload spell_scripts` | 5 | yes | Reloads the spell scripts. Refuses while a script is running. | `.reload spell_scripts` |  |
| `.reload spell_target_position` | 5 | yes | Reloads the destination coordinates of teleport spells. | `.reload spell_target_position` |  |
| `.reload spell_template` | 5 | yes | Reloads the spell definitions and the `spell_mod` overrides. | `.reload spell_template` |  |
| `.reload spell_threats` | 5 | yes | Reloads the threat values spells generate. | `.reload spell_threats` |  |
| `.reload taxi_path_transitions` | 5 | yes | Reloads the links that let one flight path continue into another. | `.reload taxi_path_transitions` |  |
| `.reload trainer_greeting` | 5 | yes | Reloads the greeting text trainers show. | `.reload trainer_greeting` |  |
| `.reload variables` | 5 | yes | Reloads the saved world variables. | `.reload variables` |  |

## removeriding

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.removeriding` | 3 |  | Removes a riding skill from a player, along with the mounts it enabled. | `.removeriding [player]` | `.removeriding Bobmage` |

## repairitems

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.repairitems` | 3 | yes | Repairs every item the selected player carries and has equipped. | `.repairitems [player]` | `.repairitems Bobmage` |

## replenish

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.replenish` | 3 |  | Restores the selected unit to full health and power. | `.replenish` |  |

## reset

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.reset` | 3 | yes | Container for the commands that put a character back to a default state. | *(sub-commands only)* | |
| `.reset honor` | 5 | yes | Clears a player's honor: kills, points and rank. | `.reset honor [player]` | `.reset honor Bobmage` |
| `.reset level` | 5 | yes | Resets a player to level 1, with the stats, talents and skills of a new character. | `.reset level [player]` | `.reset level Bobmage` |
| `.reset spells` | 5 | yes | Removes every spell a player has learned and reteaches the starting set. | `.reset spells` |  |
| `.reset stats` | 5 | yes | Recalculates a player's stats and talent points for their level, undoing any manual changes. | `.reset stats [player]` | `.reset stats Bobmage` |
| `.reset talents` | 3 | yes | Refunds a player's talent points. | `.reset talents [player]` | `.reset talents Bobmage` |
| `.reset items` | 6 | yes | Deletes every item a player owns, in bags, bank and equipment. | `.reset items [player]` | `.reset items Bobmage` |
| `.reset all` | 6 | yes | Queues a reset of talents or spells for every character on the realm at next login. | `.reset all talents` | `.reset all 1` |

## respawn

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.respawn` | 4 |  | Respawns the selected creature immediately, or every creature nearby. | `.respawn` |  |

## revive

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.revive` | 3 | yes | Resurrects a player at full health, online or offline. | `.revive [player]` | `.revive Bobmage` |

## save

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.save` | 0 |  | Writes a player's state to the database now. | `.save` |  |

## saveall

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.saveall` | 6 | yes | Writes every online player's state to the database now. | `.saveall` |  |

## send

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.send` | 1 | yes | Container for the mail and message commands. | *(sub-commands only)* | |
| `.send mass` | 6 | yes | Container for the mass mail commands, which take a target mask rather than one name. | *(sub-commands only)* | |
| `.send mass items` | 6 | yes | Mails items to every character matching the given mask. | `.send mass items <race mask> "<subject>" "<text>" <item id[:count]> [more item ids]` | `.send mass items 0xFFFFFFFF "Hello" "Mail body" 2589:10 3299` |
| `.send mass mail` | 6 | yes | Mails a message to every character matching the given mask. | `.send mass mail <race mask> "<subject>" "<text>"` | `.send mass mail 0xFFFFFFFF "Hello" "Mail body"` |
| `.send mass money` | 6 | yes | Mails money to every character matching the given mask. | `.send mass money <race mask> "<subject>" "<text>" <copper>` | `.send mass money 0xFFFFFFFF "Hello" "Mail body" 50` |
| `.send items` | 6 | yes | Mails items to one character. | `.send items <player> "<subject>" "<text>" <item id[:count]> [more item ids]` | `.send items Bobmage "Hello" "Mail body" 2589:10 3299` |
| `.send mail` | 1 | yes | Mails a message to one character. | `.send mail <player> "<subject>" "<text>"` | `.send mail Bobmage "Hello" "Mail body"` |
| `.send message` | 6 | yes | Sends an on-screen administrator message to one online player. | `.send message <player> <message>` | `.send message Bobmage Server restart in 5 minutes` |
| `.send money` | 6 | yes | Mails money to one character. | `.send money <player> "<subject>" "<text>" <copper>` | `.send money Bobmage "Hello" "Mail body" 50` |

## server

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.server` | 0 | yes | Container for the server control commands. | *(sub-commands only)* | |
| `.server corpses` | 6 | yes | Removes the expired corpses still held in memory. | `.server corpses` |  |
| `.server exit` | 7 | yes | Stops the server immediately, without a countdown. Console only. | `.server exit` |  |
| `.server idlerestart` | 6 | yes | Restarts the server once no players are online, after the given delay. | `.server idlerestart <delay seconds> [exit code]` | `.server idlerestart 300 0` |
| `.server idlerestart cancel` | 6 | yes | Cancels a pending idle restart. | `.server idlerestart cancel` |  |
| `.server idleshutdown` | 6 | yes | Shuts the server down once no players are online, after the given delay. | `.server idleshutdown <delay seconds> [exit code]` | `.server idleshutdown 300 0` |
| `.server idleshutdown cancel` | 6 | yes | Cancels a pending idle shutdown. | `.server idleshutdown cancel` |  |
| `.server info` | 0 | yes | Prints the core revision, uptime, and current and peak player counts. | `.server info` |  |
| `.server log` | 7 | yes | Container for the logging commands. | *(sub-commands only)* | |
| `.server log filter` | 7 | yes | Lists the log filters and their state, or turns one on or off. | `.server log filter [name filter] on\|off` | `.server log filter bob on` |
| `.server log level` | 7 | yes | Prints or sets the console and file log levels. | `.server log level <console level 0-4> [file level 0-4]` | `.server log level 2 3` |
| `.server motd` | 0 | yes | Prints the current message of the day. | `.server motd` |  |
| `.server plimit` | 6 | yes | Sets or reports the player limit and the minimum security level allowed to log in. | `.server plimit [<max players>\|player\|moderator\|gamemaster\|administrator\|reset]` | `.server plimit max players>` |
| `.server resetallraids` | 6 | yes | Resets every raid instance globally and sends the players inside to their home bind. | `.server resetallraids` |  |
| `.server restart` | 6 | yes | Restarts the server after a countdown, with a reason announced to players. | `.server restart <delay seconds> [exit code]` | `.server restart 300 0` |
| `.server restart cancel` | 6 | yes | Cancels a pending restart. | `.server restart cancel` |  |
| `.server shutdown` | 6 | yes | Shuts the server down after a countdown, with a reason announced to players. | `.server shutdown <delay seconds> [exit code]` | `.server shutdown 300 0` |
| `.server shutdown cancel` | 6 | yes | Cancels a pending shutdown. | `.server shutdown cancel` |  |
| `.server set` | 6 | yes | Container for the commands that change a server setting at runtime. | *(sub-commands only)* | |
| `.server set motd` | 6 | yes | Sets the message of the day. | `.server set motd <message>` | `.server set motd Server restart in 5 minutes` |

## service

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.service` | 6 | yes | Container for the bulk maintenance commands. | *(sub-commands only)* | |
| `.service del_characters` | 6 | yes | Deletes characters in bulk by the given thresholds: level, money, item count, played time and time since last logout. Skips banned and GM accounts. | `.service del_characters <flags> <max level> <max money> <max items> <max played time> <logout time>` | `.service del_characters 1 60 10000 1 5000 5000` |

## setskill

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.setskill` | 3 |  | Sets a skill's current and maximum value on the selected player. | `.setskill <skill id> <level> [maxskill]` | `.setskill 164 60 1` |

## showarea

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.showarea` | 2 |  | Marks one area explored for the selected player. | `.showarea <area id>` | `.showarea 12` |

## sniff

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.sniff` | 6 |  | Starts or stops writing a packet dump of a player's session. | `.sniff on\|off` | `.sniff on` |

## spamer

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.spamer` | 1 | yes | Container for the spam mute commands, which act through the antispam system. | *(sub-commands only)* | |
| `.spamer mute` | 1 | yes | Mutes a player through the antispam system. | `.spamer mute <player name>` | `.spamer mute Bobmage` |
| `.spamer unmute` | 2 | yes | Unmutes a player the antispam system had muted. | `.spamer unmute <player name>` | `.spamer unmute Bobmage` |
| `.spamer list` | 2 | yes | Lists the players the antispam system currently has muted. | `.spamer list` |  |

## spell

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.spell` | 3 | yes | Container for the spell inspection commands. | *(sub-commands only)* | |
| `.spell effects` | 3 | yes | Prints each effect of a spell: type, base points, targets, radius, aura and trigger. | `.spell effects <spell id>` | `.spell effects 133` |
| `.spell info` | 3 | yes | Prints a spell's header data: school, category, dispel type, mechanic, attributes and stacking. | `.spell info <spell id>` | `.spell info 133` |
| `.spell search` | 3 | yes | Finds spells by their spell family and family flags. | `.spell search <spell family name> <spell family flags, hex>` | `.spell search 1 1` |
| `.spell iconfix` | 5 | yes | Prints the `spell_mod` statement that would set a spell's icon id, for spells the client cannot display. | `.spell iconfix <spell id>` | `.spell iconfix 133` |

## stable

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.stable` | 2 |  | Opens your own stable window from wherever you are. | `.stable` |  |

## start

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.start` | 0 |  | Teleports you to your race's starting area. | `.start` |  |

## taxicheat

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.taxicheat` | 2 |  | Grants or removes every flight path for the selected player. | `.taxicheat on\|off` | `.taxicheat on` |

## tele

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.tele` | 2 |  | Teleports you to a saved location by name. | `.tele <location name>` | `.tele ironforge` |
| `.tele add` | 5 |  | Saves your current position as a named `.tele` location. | `.tele add <location name>` | `.tele add ironforge` |
| `.tele del` | 5 | yes | Deletes a saved `.tele` location. | `.tele del <location name>` | `.tele del ironforge` |
| `.tele name` | 2 | yes | Teleports a named player to a saved location, online or offline. | `.tele name [player] <location name>` | `.tele name Bobmage ironforge` |
| `.tele group` | 2 |  | Teleports your whole group to a saved location. | `.tele group <location name>` | `.tele group ironforge` |

## ticket

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.ticket` | 2 | yes | GM ticket handling. On its own, shows a ticket by id or by the player's name. | `.ticket <ticket id or player name>` | `.ticket 1` |
| `.ticket assign` | 2 | yes | Assigns a ticket to a GM. | `.ticket assign <ticket id> <gm name>` | `.ticket assign 1 1` |
| `.ticket close` | 2 | yes | Closes a ticket by id. | `.ticket close <ticket id>` | `.ticket close 1` |
| `.ticket closedlist` | 2 | yes | Lists the recently closed tickets. | `.ticket closedlist` |  |
| `.ticket counter` | 2 |  | Sets the ticket counter shown to GMs. | `.ticket counter <counter>` | `.ticket counter 0` |
| `.ticket comment` | 2 | yes | Adds a GM-only comment to a ticket. | `.ticket comment <ticket id> <comment>` | `.ticket comment 1 start of scene` |
| `.ticket complete` | 2 | yes | Marks a ticket resolved and notifies the player. | `.ticket complete <ticket id> <response>` | `.ticket complete 1 1` |
| `.ticket delete` | 3 | yes | Permanently deletes a ticket. It must be closed first. | `.ticket delete <ticket id>` | `.ticket delete 1` |
| `.ticket escalate` | 2 |  | Raises a ticket's escalation level so a higher rank picks it up. | `.ticket escalate <ticket id>` | `.ticket escalate 1` |
| `.ticket escalatedlist` | 3 | yes | Lists the escalated tickets. | `.ticket escalatedlist` |  |
| `.ticket list` | 2 | yes | Lists the open tickets, with their category and age. | `.ticket list [category]` | `.ticket list 1` |
| `.ticket next` | 2 |  | Shows the next ticket after the one you are viewing. | `.ticket next` |  |
| `.ticket notify` | 2 |  | Toggles whether you are told when a new ticket arrives. | `.ticket notify on\|off` | `.ticket notify on` |
| `.ticket onlinelist` | 2 | yes | Lists the open tickets whose author is online. | `.ticket onlinelist [category]` | `.ticket onlinelist 1` |
| `.ticket previous` | 2 |  | Shows the ticket before the one you are viewing. | `.ticket previous` |  |
| `.ticket reload` | 2 | yes | Queues a ticket to be re-read from the database. | `.ticket reload <ticket id>` | `.ticket reload 1` |
| `.ticket reset` | 6 | yes | Deletes every ticket. Refuses while any ticket is still pending. | `.ticket reset` |  |
| `.ticket response` | 2 | yes | Container for the commands that compose the reply text sent to the player. | *(sub-commands only)* | |
| `.ticket response reset` | 3 | yes | Clears the reply text being composed for a ticket. | `.ticket response reset <ticket id>` | `.ticket response reset 1` |
| `.ticket response append` | 2 | yes | Appends text to a ticket's reply. | `.ticket response append <ticket id> <text>` | `.ticket response append 1 Hello there` |
| `.ticket response appendln` | 2 | yes | Appends text and a line break to a ticket's reply. | `.ticket response appendln <ticket id> <text>` | `.ticket response appendln 1 Hello there` |
| `.ticket togglesystem` | 6 | yes | Turns ticket submission on or off for the whole realm. | `.ticket togglesystem` |  |
| `.ticket unassign` | 2 | yes | Takes a ticket back from the GM it was assigned to. | `.ticket unassign <ticket id>` | `.ticket unassign 1` |
| `.ticket viewid` | 2 | yes | Shows a ticket by its id. | `.ticket viewid <ticket id>` | `.ticket viewid 1` |
| `.ticket viewname` | 2 | yes | Shows a ticket by the name of the player who opened it. | `.ticket viewname <player name>` | `.ticket viewname Bobmage` |

## trigger

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.trigger` | 2 | yes | Shows an area trigger's data and its requirements. Without an id, uses the one you are standing in. | `.trigger <area trigger id>` | `.trigger 1` |
| `.trigger active` | 2 |  | Lists the area triggers you currently satisfy the requirements of. | `.trigger active` |  |
| `.trigger near` | 2 |  | Lists the area triggers within the given distance of you. | `.trigger near [distance]` | `.trigger near 2.0` |

## unaura

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.unaura` | 3 |  | Removes one aura from the selected unit, or all of them. | `.unaura <spell id>\|all` | `.unaura 133 ` |

## unban

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.unban` | 6 | yes | Container for the unban commands. | *(sub-commands only)* | |
| `.unban account` | 6 | yes | Lifts an account ban. | `.unban account <account> <reason>` | `.unban account testacc Exploiting` |
| `.unban character` | 6 | yes | Lifts the ban on the account behind a character. | `.unban character <player> <reason>` | `.unban character Bobmage Exploiting` |
| `.unban ip` | 6 | yes | Lifts an IP ban. | `.unban ip <ip> <reason>` | `.unban ip 192.168.0.10 Exploiting` |

## unfreeze

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.unfreeze` | 2 |  | Removes the freeze aura applied by `.freeze`. | `.unfreeze` |  |

## unit

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.unit` | 1 |  | Container for the commands that inspect a live unit, player or creature. | *(sub-commands only)* | |
| `.unit aiinfo` | 1 |  | Prints which AI the selected unit is running. | `.unit aiinfo` |  |
| `.unit info` | 1 |  | Prints the selected unit's combat state: victim, charmer, summoner, owner and target. | `.unit info` |  |
| `.unit moveinfo` | 1 |  | Prints the selected unit's movement packet state: server and client time, flags, position and transport. | `.unit moveinfo` |  |
| `.unit speedinfo` | 1 |  | Prints every movement speed of the selected unit. | `.unit speedinfo` |  |
| `.unit statinfo` | 1 |  | Prints the selected unit's full stat block: health, power, attributes, resistances, attack power and ratings. | `.unit statinfo` |  |
| `.unit ufinfo` | 5 |  | Prints the raw update fields of the selected unit. | `.unit ufinfo` |  |
| `.unit factioninfo` | 1 |  | Prints the selected unit's faction and faction template, and who it is hostile to. | `.unit factioninfo` |  |
| `.unit show` | 1 |  | Container for the commands that print one field of the selected unit. | *(sub-commands only)* | |
| `.unit show race` | 1 |  | Prints the selected unit's race. | `.unit show race` |  |
| `.unit show class` | 1 |  | Prints the selected unit's class. | `.unit show class` |  |
| `.unit show gender` | 1 |  | Prints the selected unit's gender. | `.unit show gender` |  |
| `.unit show powertype` | 1 |  | Prints whether the selected unit uses mana, rage, focus or energy. | `.unit show powertype` |  |
| `.unit show form` | 1 |  | Prints the selected unit's shapeshift form. | `.unit show form` |  |
| `.unit show visflags` | 1 |  | Prints the selected unit's visibility flags. | `.unit show visflags` |  |
| `.unit show miscflags` | 1 |  | Prints the selected unit's miscellaneous byte flags. | `.unit show miscflags` |  |
| `.unit show emotestate` | 1 |  | Prints the looping emote the selected unit is playing. | `.unit show emotestate` |  |
| `.unit show standstate` | 1 |  | Prints whether the selected unit is standing, sitting, sleeping or kneeling. | `.unit show standstate` |  |
| `.unit show sheathstate` | 1 |  | Prints whether the selected unit has its weapons drawn. | `.unit show sheathstate` |  |
| `.unit show unitstate` | 1 |  | Prints the selected unit's internal `UnitState` flags: rooted, fleeing, stunned and so on. | `.unit show unitstate` |  |
| `.unit show unitflags` | 1 |  | Prints the selected unit's `UNIT_FIELD_FLAGS`. | `.unit show unitflags` |  |
| `.unit show npcflags` | 1 |  | Prints the selected unit's NPC flags: vendor, quest giver, trainer and so on. | `.unit show npcflags` |  |
| `.unit show moveflags` | 1 |  | Prints the selected unit's movement flags. | `.unit show moveflags` |  |
| `.unit show createspell` | 1 |  | Prints the spell that summoned the selected unit, if any. | `.unit show createspell` |  |
| `.unit show combattimer` | 1 |  | Prints how long the selected unit will stay in combat after its last action. | `.unit show combattimer` |  |

## unlearn

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.unlearn` | 3 |  | Removes a spell from the selected player. | `.unlearn <spell id> [all]` | `.unlearn 133 1` |
| `.unlearn all_gm` | 3 |  | Removes the GM-only spells from you. | `.unlearn all_gm` |  |
| `.unlearn all_crafts` | 3 |  | Removes every crafting profession from you. | `.unlearn all_crafts` |  |
| `.unlearn all_recipes` | 3 |  | Removes every recipe of one profession from a player. | `.unlearn all_recipes <profession name>` | `.unlearn all_recipes blacksmithing` |

## unmute

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.unmute` | 2 | yes | Lifts a chat mute early. | `.unmute [player]` | `.unmute Bobmage` |

## unstuck

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.unstuck` | 0 |  | Teleports a player out of a stuck position, to their bind point or their corpse. Availability is controlled by a config option. | `.unstuck` |  |

## variable

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.variable` | 5 | yes | Sets a saved world variable, or reads it back when no value is given. | `.variable <index> [value]` | `.variable 10 1` |

## video

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.video` | 3 |  | Camera path helpers used for recording. On its own, runs the expendables fly-through. | `.video` (also a sub-command group) | |
| `.video expendables` | 3 |  | Flies the camera through the creatures around the target, for recording. | `.video expendables` |  |
| `.video turn` | 3 |  | Orbits the camera around the target, closing in as it goes. | `.video turn` |  |

## wareffort

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.wareffort` | 5 | yes | Container for the Ahn'Qiraj war effort commands. | *(sub-commands only)* | |
| `.wareffort info` | 5 | yes | Prints the war effort state: stage, transition times, gong ring time and resource progress. | `.wareffort info` |  |
| `.wareffort setgongtime` | 5 | yes | Sets the time the Scarab Gong was rung, which drives the ten hour war. | `.wareffort setgongtime <gong time>` | `.wareffort setgongtime 5000` |
| `.wareffort setstage` | 5 | yes | Sets the war effort stage directly. | `.wareffort setstage <stage>` | `.wareffort setstage 1` |
| `.wareffort getresource` | 5 | yes | Prints how much of one war effort resource has been collected, and how much is needed. | `.wareffort getresource <resource id> <team>` | `.wareffort getresource 1 alliance` |
| `.wareffort setresource` | 5 | yes | Sets how much of one war effort resource has been collected. | `.wareffort setresource <resource id> <resource amount> <team>` | `.wareffort setresource 1 10 alliance` |

## wchange

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.wchange` | 4 |  | Sets the weather type and intensity in the zone you are in. | `.wchange <type> <grade>` | `.wchange 1 1` |

## whispers

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.whispers` | 1 |  | Toggles whether you accept whispers from players. | `.whispers on\|off` | `.whispers on` |

## world

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.world` | 6 |  | Container for the world mask commands, which control which parallel world a unit belongs to. | *(sub-commands only)* | |
| `.world update` | 6 |  | Prints the selected unit's world mask, or sets it. | `.world update <world mask>` | `.world update 1` |
| `.world cansee` | 6 |  | Reports whether you and the selected unit can see each other under their world masks. | `.world cansee` |  |
| `.world detail` | 6 |  | Prints the selected unit's world mask broken down into the individual worlds it belongs to. | `.world detail` |  |

## wp

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.wp` | 2 |  | Container for the creature waypoint path commands (`creature_movement`). | *(sub-commands only)* | |
| `.wp show` | 2 |  | Draws a creature's waypoints in the world, or prints the details of one waypoint. | `.wp show on\|off\|info\|first\|last [db guid] [path id] [path source]` | `.wp show on 12345 1 0` |
| `.wp add` | 5 |  | Appends your current position as a waypoint of a creature's path. | `.wp add [db guid] [path id] [path source]` | `.wp add 12345 1 0` |
| `.wp modify` | 5 |  | Changes one waypoint: its position, wait time, script id, emote, model or orientation. | `.wp modify waittime\|scriptid\|orientation\|del\|move [db guid] [waypoint id] [value]` | `.wp modify waittime 12345 3 1` |
| `.wp export` | 6 |  | Writes a creature's waypoint path out as SQL. | `.wp export <file name> [db guid] [path id] [path source]` | `.wp export dump.txt 12345 1 0` |

## wr

| Command | Lvl | C | Description | Syntax | Example |
|---|---|---|---|---|---|
| `.wr` | 0 |  | Toggles whisper restriction, which blocks whispers from players you have not spoken to. | `.wr on\|off` | `.wr on` |