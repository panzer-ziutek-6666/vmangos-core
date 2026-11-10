import { countOnlineBots, countBotAccounts, listBotLocations, listSuspendedBotAccounts } from '../queries/bots.js';
import { readStatus } from '../status.js';
import { renderPage } from '../views/layout.js';
import { renderBotsBody } from '../views/bots.js';

// Each read is caught on its own. app.js's error handler turns a MySQL
// failure into a 503 for the whole page, which is right for a page that is
// one query but wrong here: three independent databases feed this page, and
// one being down must not hide the two that answered. A caught failure
// becomes { error } and renders as a note inside its own panel.
//
// The view (server/views/bots.js) discriminates the error state on
// `typeof value.error === 'string'`. A rejection is not guaranteed to be an
// Error with a string .message - a thrown string, a thrown plain object, or
// an Error with no message would all produce a non-string .error, which
// isError() then classifies as neither an error nor null. That falls
// through every branch in renderBreakdown/renderSuspended into the "here is
// the data" path, which throws on a value that is not an array - right back
// into the whole-page 503 this function exists to prevent. Coercing here
// keeps the { error: string } contract closed at its one production site.
function settle(promise) {
  return promise.then(
    (value) => value,
    // `||`, not `??`: an Error with an empty string message (`new Error('')`)
    // must still fall through to `err` and then to the 'unknown error'
    // fallback, because `??` only catches null/undefined and would let the
    // empty string through as-is, rendering a blank, unexplained error note.
    (err) => ({ error: String(err?.message || err || 'unknown error') })
  );
}

export function registerBots(app) {
  const { soap, pools, config } = app.deps;

  app.get('/bots', async (req, reply) => {
    // readStatus() already runs countOnlineBots() internally for the status
    // strip, so this fires a second, identical COUNT(*) join over the same
    // 1000+ row table concurrently - a known duplication, left in place
    // rather than threaded through as a shared value, because the strip
    // re-polls on its own 5s timer regardless: even a de-duplicated first
    // paint would drift out of sync with the panel on the very next poll, so
    // sharing the one-time result would buy correctness only until then.
    const [status, accounts, online, locations, suspended] = await Promise.all([
      readStatus({ soap, pools, config }),
      settle(countBotAccounts(pools, config)),
      settle(countOnlineBots(pools, config)),
      settle(listBotLocations(pools, config)),
      settle(listSuspendedBotAccounts(pools, config))
    ]);

    const body = renderBotsBody({
      accounts, online, locations, suspended,
      // Optional chaining to match the rest of this route: loadConfig always
      // supplies this field in production, but a hand-built config (as in
      // some tests) may carry a `bots` object without it, or no `bots` at
      // all - the view falls back to a sane default rather than printing NaN.
      playerSaveIntervalMs: config.bots?.playerSaveIntervalMs
    });
    reply.type('text/html').send(renderPage({ title: 'Bots', active: 'bots', body, status }));
  });
}
