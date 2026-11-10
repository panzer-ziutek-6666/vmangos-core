import { listCharacters, getCharacter, listDeletedCharacters } from '../queries/characters.js';
import { assertCharacterName } from '../commands/validate.js';
import {
  buildFlagRename, buildSetLevel, buildRevive, buildRepairItems, buildKick,
  buildMute, buildUnmute, buildBanCharacter, buildUnbanCharacter, buildHasItem,
  buildReputation, buildErase, buildSendMessage, buildSendMail, buildSendItems,
  buildSendMoney, buildSendMassMail, buildSendMassItems, buildSendMassMoney,
  buildDeletedRestore, buildDeletedDelete, buildDeletedOld
} from '../commands/characters.js';
import { readStatus } from '../status.js';
import { renderPage } from '../views/layout.js';
import { renderCharactersBody, renderCharacterBody, renderDeletedBody, renderResult, renderError } from '../views/characters.js';

// A form field submitted twice arrives as an array, and Number.parseInt
// coerces an array through toString() (['60','1'] -> "60,1" -> 60) instead of
// failing. Every field read as a number is therefore required to be a string
// first, so malformed input is rejected rather than silently reinterpreted.
function requireString(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} is required`);
  return value;
}

// Enforced here rather than in the browser so that posting directly cannot
// skip it. Two kinds of action need it: .character erase, which destroys one
// character irreversibly, and the commands that act on every row a search
// matches (the deleted pair, and the three mass sends, which reach every
// character of a race on the realm - bots included).
function requireConfirmation(typed, expected, message) {
  if (typeof typed !== 'string' || typeof expected !== 'string' || typed !== expected) {
    throw new Error(message);
  }
}

const ACTIONS = {
  rename: (b) => buildFlagRename(b.name),
  level: (b) => buildSetLevel(b.name, Number.parseInt(requireString(b.level, 'level'), 10)),
  revive: (b) => buildRevive(b.name),
  repairitems: (b) => buildRepairItems(b.name),
  kick: (b) => buildKick(b.name),
  mute: (b) => buildMute(b.name, requireString(b.minutes, 'mute duration'), b.reason),
  unmute: (b) => buildUnmute(b.name),
  ban: (b) => buildBanCharacter(b.name, requireString(b.duration, 'duration'), b.reason),
  unban: (b) => buildUnbanCharacter(b.name, b.reason),
  hasitem: (b) => buildHasItem(b.name, requireString(b.itemId, 'item id')),
  reputation: (b) => buildReputation(b.name),
  erase: (b) => {
    requireConfirmation(b.confirm, b.name, 'To erase a character you must type its name to confirm. This cannot be undone.');
    return buildErase(b.name);
  },
  message: (b) => buildSendMessage(b.name, b.text),
  mail: (b) => buildSendMail(b.name, b.subject, b.body),
  items: (b) => buildSendItems(b.name, b.subject, b.body, requireString(b.itemId, 'item id'), requireString(b.count, 'item count')),
  money: (b) => buildSendMoney(b.name, b.subject, b.body, requireString(b.copper, 'money')),
  massmail: (b) => {
    requireConfirmation(b.confirm, b.raceMask, 'To send mail to every character of a race you must type the race back to confirm.');
    return buildSendMassMail(b.raceMask, b.subject, b.body);
  },
  massitems: (b) => {
    requireConfirmation(b.confirm, b.raceMask, 'To send an item to every character of a race you must type the race back to confirm.');
    return buildSendMassItems(b.raceMask, b.subject, b.body, requireString(b.itemId, 'item id'), requireString(b.count, 'item count'));
  },
  massmoney: (b) => {
    requireConfirmation(b.confirm, b.raceMask, 'To send money to every character of a race you must type the race back to confirm.');
    return buildSendMassMoney(b.raceMask, b.subject, b.body, requireString(b.copper, 'money'));
  },
  deletedrestore: (b) => {
    requireConfirmation(b.confirm, b.search, 'To restore every match you must type the search text back to confirm.');
    return buildDeletedRestore(b.search);
  },
  deleteddelete: (b) => {
    requireConfirmation(b.confirm, b.search, 'To permanently delete every match you must type the search text back to confirm.');
    return buildDeletedDelete(b.search);
  },
  deletedold: (b) => {
    const keepDays = requireString(b.keepDays, 'keep days');
    // Zero keeps nothing: Player::DeleteOldCharacters(0) purges every deleted
    // character on the realm, not the old ones. That is the same blast radius
    // as the bulk delete above, so it gets the same typed confirmation; any
    // other day count is an ordinary maintenance purge and does not.
    if (keepDays.trim() === '0') {
      requireConfirmation(b.confirm, '0', 'Keeping zero days deletes every deleted character. Type 0 in the confirm box to send it.');
    }
    return buildDeletedOld(keepDays);
  }
};

export function registerCharacters(app) {
  const { soap, pools, audit, config } = app.deps;

  app.get('/characters', async (req, reply) => {
    const includeBots = req.query.bots === '1';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const [status, rows] = await Promise.all([
      readStatus({ soap, pools, config }),
      listCharacters(pools, config, { search, includeBots })
    ]);
    const body = renderCharactersBody({ rows, search, includeBots, result: null, reachable: status.reachable });
    reply.type('text/html').send(renderPage({ title: 'Characters', active: 'characters', body, status }));
  });

  // Registered before /characters/:name so the literal path is not captured
  // by the parameterised one.
  app.get('/characters/deleted', async (req, reply) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const [status, rows] = await Promise.all([
      readStatus({ soap, pools, config }),
      listDeletedCharacters(pools, config, { search })
    ]);
    const body = renderDeletedBody({
      rows, search, result: null, reachable: status.reachable,
      charDeleteMethod: config.characters?.charDeleteMethod
    });
    reply.type('text/html').send(renderPage({ title: 'Deleted characters', active: 'characters', body, status }));
  });

  app.get('/characters/:name', async (req, reply) => {
    const status = await readStatus({ soap, pools, config });

    // Validated with the same rule the commands use, before it reaches SQL: a
    // name the panel could never act on must not produce a page either. The
    // answer is a whole page rather than the bare fragment an action returns,
    // because this route is reached by following a link or typing a URL, not
    // by htmx swapping a result into a page that already exists.
    try {
      assertCharacterName(req.params.name);
    } catch (err) {
      return reply.code(400).type('text/html').send(renderPage({
        title: 'Characters', active: 'characters', status,
        body: renderError(err.message)
      }));
    }

    const character = await getCharacter(pools, config, req.params.name);
    if (!character) {
      return reply.code(404).type('text/html').send(renderPage({
        title: 'Characters', active: 'characters', status,
        body: renderError(`No character named "${req.params.name}".`)
      }));
    }
    const body = renderCharacterBody({ character, result: null, reachable: status.reachable });
    reply.type('text/html').send(renderPage({ title: character.name, active: 'characters', body, status }));
  });

  app.post('/characters/:action', async (req, reply) => {
    // ACTIONS is a plain object literal, so a lookup by an attacker-chosen key
    // ("constructor", "toString", ...) would otherwise resolve through
    // Object.prototype and send [object Object] to the live server.
    const build = Object.hasOwn(ACTIONS, req.params.action) ? ACTIONS[req.params.action] : null;
    if (!build) {
      return reply.code(404).type('text/html').send(renderError(`Unknown action "${req.params.action}".`));
    }

    // Checked before anything is built or sent: a stale reachability read must
    // never let an action through while the panel says commands are disabled.
    const status = await readStatus({ soap, pools, config });
    if (!status.reachable) {
      return reply.code(503).type('text/html').send(
        renderError('mangosd is not reachable. Commands are disabled until the connection recovers.')
      );
    }

    let command;
    try {
      command = build(req.body ?? {});
    } catch (err) {
      return reply.code(400).type('text/html').send(renderError(err.message));
    }

    // No redaction step here, unlike the Accounts section: no character
    // command carries a password, so the command sent, the command audited
    // and the command shown are the same string.
    const result = await soap.execute(command);
    const auditId = audit.record({
      section: 'characters',
      action: req.params.action,
      command,
      status: result.status,
      ok: result.ok,
      output: result.output,
      durationMs: result.durationMs
    });

    reply.type('text/html').send(renderResult({ ...result, command, auditFailed: auditId === null }));
  });
}
