import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createSoapClient } from '../server/soap.js';

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

const SUCCESS = (text) => `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
<SOAP-ENV:Body><ns1:executeCommandResponse><result>${text}</result></ns1:executeCommandResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

const FAULT = (text) => `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
<SOAP-ENV:Body><SOAP-ENV:Fault><faultstring>${text}</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

test('sends the command and returns its output', async (t) => {
  let seenBody = '';
  let seenAuth = '';
  const { server, port } = await startServer((req, res) => {
    seenAuth = req.headers.authorization ?? '';
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seenBody = body;
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(SUCCESS('Players online: 3'));
    });
  });
  t.after(() => server.close());

  const client = createSoapClient({ host: '127.0.0.1', port, user: 'ops', pass: 'secret' });
  const result = await client.execute('.server info');

  assert.equal(result.ok, true);
  assert.equal(result.status, 'ok');
  assert.equal(result.output, 'Players online: 3');
  assert.match(seenBody, /<command>\.server info<\/command>/);
  assert.equal(seenAuth, 'Basic ' + Buffer.from('ops:secret').toString('base64'));
});

test('reports a failed command as failed, keeping its message', async (t) => {
  const { server, port } = await startServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(500, { 'Content-Type': 'text/xml' });
      res.end(FAULT('There is no such account.'));
    });
  });
  t.after(() => server.close());

  const client = createSoapClient({ host: '127.0.0.1', port, user: 'ops', pass: 'secret' });
  const result = await client.execute('.account delete Nobody');

  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.output, 'There is no such account.');
});

test('reports bad credentials distinctly', async (t) => {
  const { server, port } = await startServer((req, res) => {
    req.resume();
    req.on('end', () => { res.writeHead(401).end(); });
  });
  t.after(() => server.close());

  const client = createSoapClient({ host: '127.0.0.1', port, user: 'ops', pass: 'wrong' });
  const result = await client.execute('.server info');

  assert.equal(result.ok, false);
  assert.equal(result.status, 'unauthorized');
  assert.match(result.output, /SEC_ADMINISTRATOR/);
});

test('reports an unreachable server without throwing', async () => {
  // Port 1 is not listening.
  const client = createSoapClient({ host: '127.0.0.1', port: 1, user: 'ops', pass: 'secret' });
  const result = await client.execute('.server info');

  assert.equal(result.ok, false);
  assert.equal(result.status, 'unreachable');
  assert.match(result.output, /is the server running/i);
});

test('classifies a connection lost after the command was sent as an unknown outcome, not unreachable', async (t) => {
  const { server, port } = await startServer((req, res) => {
    req.resume();
    req.on('end', () => {
      // The command has fully arrived at this point; drop the connection
      // without ever sending a response.
      res.destroy();
    });
  });
  t.after(() => server.close());

  const client = createSoapClient({ host: '127.0.0.1', port, user: 'ops', pass: 'secret' });
  const result = await client.execute('.saveall');

  assert.equal(result.ok, false);
  assert.notEqual(result.status, 'unreachable');
  assert.match(result.output, /may still have run/i);
  assert.match(result.output, /not retried/i);
});

test('times out without retrying', async (t) => {
  let requestCount = 0;
  const { server, port } = await startServer((req, res) => {
    requestCount += 1;
    req.resume();
    // Never respond.
  });
  t.after(() => server.close());

  const client = createSoapClient({ host: '127.0.0.1', port, user: 'ops', pass: 'secret', timeoutMs: 150 });
  const result = await client.execute('.saveall');

  assert.equal(result.ok, false);
  assert.equal(result.status, 'timeout');
  assert.match(result.output, /no response/i);
  assert.equal(requestCount, 1, 'a timed-out command must never be retried');
});

test('runs one command at a time', async (t) => {
  let inFlight = 0;
  let maxInFlight = 0;
  const { server, port } = await startServer((req, res) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    req.resume();
    req.on('end', () => {
      setTimeout(() => {
        inFlight -= 1;
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(SUCCESS('done'));
      }, 40);
    });
  });
  t.after(() => server.close());

  const client = createSoapClient({ host: '127.0.0.1', port, user: 'ops', pass: 'secret' });
  const results = await Promise.all([
    client.execute('.one'), client.execute('.two'), client.execute('.three')
  ]);

  assert.equal(maxInFlight, 1, 'the queue must hold exactly one command in flight');
  assert.deepEqual(results.map((r) => r.status), ['ok', 'ok', 'ok']);
  assert.equal(client.queueDepth(), 0);
});

test('a command that throws synchronously fails without wedging the queue', async (t) => {
  const { server, port } = await startServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(SUCCESS('fine'));
    });
  });
  t.after(() => server.close());

  const client = createSoapClient({ host: '127.0.0.1', port, user: 'ops', pass: 'secret' });
  // A command whose toString() throws makes buildEnvelope() throw
  // synchronously inside post()'s executor.
  const poison = { toString() { throw new Error('poisoned command'); } };

  const badResult = await client.execute(poison);
  assert.equal(badResult.ok, false);
  assert.equal(badResult.status, 'failed');
  assert.match(badResult.output, /poisoned command/);

  // The queue must still be usable afterwards.
  const goodResult = await client.execute('.server info');
  assert.equal(goodResult.ok, true);
  assert.equal(goodResult.status, 'ok');
  assert.equal(goodResult.output, 'fine');

  assert.equal(client.queueDepth(), 0);
});
