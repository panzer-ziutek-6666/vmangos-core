import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildEnvelope, parseEnvelope } from '../server/soap-envelope.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('builds an envelope carrying the command', () => {
  const xml = buildEnvelope('.server info');
  assert.match(xml, /<ns1:executeCommand>/);
  assert.match(xml, /<command>\.server info<\/command>/);
  assert.match(xml, /xmlns:ns1="urn:MaNGOS"/);
  assert.match(xml, /xmlns:SOAP-ENV="http:\/\/schemas\.xmlsoap\.org\/soap\/envelope\/"/);
});

test('escapes XML metacharacters in the command', () => {
  const xml = buildEnvelope('.announce a & b < c > d');
  assert.match(xml, /<command>\.announce a &amp; b &lt; c &gt; d<\/command>/);
});

test('reads the result out of a success response', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:MaNGOS">
 <SOAP-ENV:Body>
  <ns1:executeCommandResponse>
   <result>Account created: Jaina</result>
  </ns1:executeCommandResponse>
 </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
  assert.deepEqual(parseEnvelope(xml), { ok: true, output: 'Account created: Jaina' });
});

test('unescapes entities in the result', () => {
  const xml = `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
 <SOAP-ENV:Body><ns1:executeCommandResponse><result>a &amp; b &lt; c</result></ns1:executeCommandResponse></SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
  assert.equal(parseEnvelope(xml).output, 'a & b < c');
});

test('preserves newlines in multi-line command output', () => {
  const xml = `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
 <SOAP-ENV:Body><ns1:executeCommandResponse><result>line one
line two</result></ns1:executeCommandResponse></SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
  assert.equal(parseEnvelope(xml).output, 'line one\nline two');
});

test('returns a fault as a failed command, not an exception', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
 <SOAP-ENV:Body>
  <SOAP-ENV:Fault>
   <faultcode>SOAP-ENV:Client</faultcode>
   <faultstring>There is no such account.</faultstring>
   <detail>There is no such account.</detail>
  </SOAP-ENV:Fault>
 </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
  assert.deepEqual(parseEnvelope(xml), { ok: false, output: 'There is no such account.' });
});

test('handles an unprefixed Fault element', () => {
  const xml = `<Envelope><Body><Fault><faultstring>nope</faultstring></Fault></Body></Envelope>`;
  assert.deepEqual(parseEnvelope(xml), { ok: false, output: 'nope' });
});

test('accepts an empty result element', () => {
  const xml = `<SOAP-ENV:Envelope><SOAP-ENV:Body><ns1:executeCommandResponse><result></result></ns1:executeCommandResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  assert.deepEqual(parseEnvelope(xml), { ok: true, output: '' });
});

test('accepts a self-closing result element (gSOAP empty string serialisation)', () => {
  const xml = `<SOAP-ENV:Envelope><SOAP-ENV:Body><ns1:executeCommandResponse><result/></ns1:executeCommandResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  assert.deepEqual(parseEnvelope(xml), { ok: true, output: '' });
});

test('accepts a self-closing faultstring element', () => {
  const xml = `<SOAP-ENV:Envelope><SOAP-ENV:Body><SOAP-ENV:Fault><faultstring/></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  assert.deepEqual(parseEnvelope(xml), { ok: false, output: '' });
});

test('unescapes &gt; correctly', () => {
  const xml = `<SOAP-ENV:Envelope><SOAP-ENV:Body><ns1:executeCommandResponse><result>a &gt; b</result></ns1:executeCommandResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  assert.equal(parseEnvelope(xml).output, 'a > b');
});

test('unescapes &quot; correctly', () => {
  const xml = `<SOAP-ENV:Envelope><SOAP-ENV:Body><ns1:executeCommandResponse><result>say &quot;hello&quot;</result></ns1:executeCommandResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  assert.equal(parseEnvelope(xml).output, 'say "hello"');
});

test('unescapes &apos; correctly', () => {
  const xml = `<SOAP-ENV:Envelope><SOAP-ENV:Body><ns1:executeCommandResponse><result>it&apos;s</result></ns1:executeCommandResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  assert.equal(parseEnvelope(xml).output, "it's");
});

test('handles double-escaped content (unescapes &amp; last)', () => {
  const xml = `<SOAP-ENV:Envelope><SOAP-ENV:Body><ns1:executeCommandResponse><result>&amp;lt;</result></ns1:executeCommandResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  // &amp;lt; should unescape to &lt; (the literal text), not to <
  assert.equal(parseEnvelope(xml).output, '&lt;');
});

// gSOAP cannot put a raw carriage return in XML text - it survives the wire
// only as a numeric character reference, decimal &#13; or hex &#xD;. The
// core's own output is CRLF-terminated, so every real response carries
// these.
test('decodes numeric character references for a carriage return', () => {
  const xml = `<SOAP-ENV:Envelope><SOAP-ENV:Body><ns1:executeCommandResponse><result>line one&#xD;
line two&#13;
line three</result></ns1:executeCommandResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  assert.equal(parseEnvelope(xml).output, 'line one\nline two\nline three');
});

// This is the test that fails if numeric decoding is ever reordered to run
// after the named-entity replacements. A literal "&#xD;" typed by a human
// arrives on the wire double-escaped as "&amp;#xD;". Decoding numerics
// first cannot touch it (the "&" there is followed by "a", not "#"), and it
// must still come back as the five literal characters "&#xD;", never as an
// actual carriage return.
test('does not turn a double-escaped numeric reference into a real carriage return', () => {
  const xml = `<SOAP-ENV:Envelope><SOAP-ENV:Body><ns1:executeCommandResponse><result>&amp;#xD;</result></ns1:executeCommandResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  assert.equal(parseEnvelope(xml).output, '&#xD;');
});

test('a realistic .server info body round-trips to clean LF-separated lines', () => {
  // Captured through server/soap.js against a running mangosd.
  const xml = `<SOAP-ENV:Envelope><SOAP-ENV:Body><ns1:executeCommandResponse><result>Core revision: 58b858214dabf5bb4c0a / 2026-09-01 07:38:49 +0200 / Win64 (little-endian)&#xD;
Players online: 0 (0 queued). Max online: 0 (0 queued).&#xD;
Server uptime: 2 Minutes 24 Seconds.&#xD;
</result></ns1:executeCommandResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  assert.equal(
    parseEnvelope(xml).output,
    'Core revision: 58b858214dabf5bb4c0a / 2026-09-01 07:38:49 +0200 / Win64 (little-endian)\n' +
    'Players online: 0 (0 queued). Max online: 0 (0 queued).\n' +
    'Server uptime: 2 Minutes 24 Seconds.\n'
  );
});

test('throws on a document that is neither a result nor a fault', () => {
  assert.throws(() => parseEnvelope('<html>404 Not Found</html>'), /unrecognised SOAP response/);
});

// This is the only pair of tests in the suite that exercises genuine server
// output rather than hand-written XML: both files were captured from a
// running mangosd through server/soap.js (see
// docs/plans/2026-09-01-skeleton-and-accounts.md, Task 10).
test('parses a real success response captured from mangosd', () => {
  const xml = readFileSync(path.join(__dirname, 'fixtures', 'server-info-success.xml'), 'utf8');
  const result = parseEnvelope(xml);
  assert.equal(result.ok, true);
  assert.match(result.output, /Core revision:/);
});

test('parses a real SOAP fault captured from mangosd (HTTP 500, unknown account)', () => {
  const xml = readFileSync(path.join(__dirname, 'fixtures', 'account-delete-fault.xml'), 'utf8');
  const result = parseEnvelope(xml);
  assert.equal(result.ok, false);
  assert.match(result.output, /Account not exist/);
});
