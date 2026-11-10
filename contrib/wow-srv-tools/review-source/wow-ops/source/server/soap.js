import http from 'node:http';
import { buildEnvelope, parseEnvelope } from './soap-envelope.js';

// The server's own accept loop is single-threaded and each command is queued
// onto the world thread and waited on (MaNGOSsoap.cpp:36 and :120), so the
// client holds a queue of depth one. Concurrency here would only add
// world-tick pressure.

export function createSoapClient({ host, port, user, pass, timeoutMs = 10000 }) {
  const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  const queue = [];
  let running = false;

  function post(command) {
    return new Promise((resolve) => {
      const started = Date.now();
      let settled = false;
      let flushed = false;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve({ ...result, durationMs: Date.now() - started });
      };

      // Nothing below may let this executor throw synchronously -- e.g.
      // buildEnvelope() on a command with a hostile toString(), or a future
      // change to the http.request() call. A synchronous throw here would
      // reject the promise; drain() awaits post() without its own guard
      // against that, which would wedge the queue forever and crash the
      // process on the resulting unhandled rejection. Route every failure,
      // sync or async, through finish() instead.
      try {
        const body = Buffer.from(buildEnvelope(command), 'utf8');

        const req = http.request({
          host, port, method: 'POST', path: '/',
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'Content-Length': body.length,
            'SOAPAction': '""',
            'Authorization': auth
          }
        }, (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { text += chunk; });
          res.on('end', () => {
            if (res.statusCode === 401 || res.statusCode === 403) {
              finish({
                ok: false,
                status: 'unauthorized',
                output: `The server rejected the panel's credentials (HTTP ${res.statusCode}). ` +
                        `The SOAP account must exist and hold SEC_ADMINISTRATOR.`
              });
              return;
            }
            try {
              const parsed = parseEnvelope(text);
              finish({ ok: parsed.ok, status: parsed.ok ? 'ok' : 'failed', output: parsed.output });
            } catch (err) {
              finish({ ok: false, status: 'failed', output: `${err.message} (HTTP ${res.statusCode})` });
            }
          });
        });

        // Whether the full request body ever left this process is the one
        // fact that tells us whether the command could possibly have reached
        // the server. Nothing flushed => it certainly did not run, so it is
        // safe to say the server looks unreachable. Once flushed, it may
        // have run, so the caller must be told plainly and never retried --
        // whether the failure that follows is a timeout or a dropped
        // connection.
        req.on('finish', () => { flushed = true; });

        req.setTimeout(timeoutMs, () => {
          req.destroy();
          if (!flushed) {
            finish({
              ok: false,
              status: 'unreachable',
              output: `Cannot reach mangosd at ${host}:${port}. No response within ${timeoutMs} ms while ` +
                      `connecting. Is the server running, and is SOAP.Enabled = 1?`
            });
            return;
          }
          // Deliberately not retried: the command may already have executed.
          finish({
            ok: false,
            status: 'timeout',
            output: `No response within ${timeoutMs} ms. The command may still have run on the server; it was not retried.`
          });
        });

        req.on('error', (err) => {
          if (settled) return;
          if (!flushed) {
            finish({
              ok: false,
              status: 'unreachable',
              output: `Cannot reach mangosd at ${host}:${port} (${err.code}). Is the server running, and is SOAP.Enabled = 1?`
            });
            return;
          }
          // Deliberately not retried: the command may already have executed
          // on the server before the connection was lost.
          finish({
            ok: false,
            status: 'timeout',
            output: `The connection was lost after the command was sent (${err.code}). ` +
                    `The command may still have run on the server; it was not retried.`
          });
        });

        req.end(body);
      } catch (err) {
        finish({ ok: false, status: 'failed', output: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const job = queue.shift();
        let result;
        try {
          result = await post(job.command);
        } catch (err) {
          // Belt and braces: post() is written so it can never reject, but a
          // future change must not be able to escape this loop, wedge the
          // queue, or crash the process on an unhandled rejection.
          result = { ok: false, status: 'failed', output: err instanceof Error ? err.message : String(err) };
        }
        job.resolve(result);
      }
    } finally {
      running = false;
    }
  }

  return {
    execute(command) {
      return new Promise((resolve) => {
        queue.push({ command, resolve });
        drain();
      });
    },
    queueDepth() {
      return queue.length + (running ? 1 : 0);
    }
  };
}
