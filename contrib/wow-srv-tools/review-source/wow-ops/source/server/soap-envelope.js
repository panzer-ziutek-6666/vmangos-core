// The core's SOAP interface is a single function
// (vmangos-core/dep/gsoap/gsoap.stub):
//     int ns1__executeCommand(char* command, char** result);
// Namespaces are declared in src/mangosd/remote/soap/MaNGOSsoap.cpp:136.
// One method does not justify a SOAP library.

function escapeXml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

// gSOAP encodes a literal carriage return as a numeric character reference
// (decimal &#13; or hex &#xD;, case-insensitive) rather than as a raw byte,
// because XML text normalizes a literal CR to LF on parse - a numeric
// reference is the only way to carry one through untouched. The core's own
// command output is CRLF-terminated, so every line of real output ends in
// one of these.
//
// This must run BEFORE the named-entity replacements below. A literal
// "&#xD;" typed by a human arrives on the wire double-escaped as
// "&amp;#xD;" - while the "&amp;" part is still encoded, that string does
// not contain the substring "&#xD;" (the "&" is followed by "a", not "#"),
// so decoding numeric references first cannot touch it. The existing rule
// that "&amp;" is unescaped last then still protects it. Reversing the
// order would let that later "&amp;" -> "&" step manufacture a brand new
// "&#xD;" substring that this function would never see - but if numeric
// decoding ran second, the human's literal reference would already have
// been wrongly turned into a live carriage return by the first pass.
function decodeNumericEntities(text) {
  return text.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, ref) => {
    const codePoint = ref[0].toLowerCase() === 'x' ? parseInt(ref.slice(1), 16) : parseInt(ref, 10);
    return String.fromCodePoint(codePoint);
  });
}

// Display-only normalization: fold CRLF and lone CR down to LF so a <pre>
// renders clean lines instead of stray carriage returns.
function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function unescapeXml(text) {
  const decoded = decodeNumericEntities(text)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', `'`)
    .replaceAll('&amp;', '&');
  return normalizeLineEndings(decoded);
}

export function buildEnvelope(command) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/" xmlns:xsi="http://www.w3.org/1999/XMLSchema-instance" xmlns:xsd="http://www.w3.org/1999/XMLSchema" xmlns:ns1="urn:MaNGOS">
 <SOAP-ENV:Body>
  <ns1:executeCommand>
   <command>${escapeXml(command)}</command>
  </ns1:executeCommand>
 </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

// Matches an element by local name, ignoring whatever namespace prefix is used.
// Handles both paired elements <tag>content</tag> and self-closing <tag/>.
// Returns unescaped content for paired, empty string for self-closing, null if not found.
// WARNING: If an element ever contained child elements, this would return raw markup.
// That is acceptable here because parseEnvelope checks Fault (flat string) before result,
// and the server always sends faultstring and detail as flat strings (soap_sender_fault in
// MaNGOSsoap.cpp:127). A future maintainer changing that order must verify nested content
// is not possible.
function extract(xml, localName) {
  const re = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${localName}\\b[^>]*?(?:/>|>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${localName}>)`);
  const match = xml.match(re);
  if (!match) return null;
  // For self-closing elements, match[1] is undefined; normalize to empty string
  const content = match[1] ?? '';
  return unescapeXml(content);
}

function hasElement(xml, localName) {
  return new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${localName}\\b`).test(xml);
}

export function parseEnvelope(xml) {
  if (hasElement(xml, 'Fault')) {
    // A failed command arrives as a fault carrying its own message
    // (MaNGOSsoap.cpp:127). That is a command failure, not a transport failure.
    const output = extract(xml, 'faultstring') ?? extract(xml, 'detail') ?? '';
    return { ok: false, output };
  }
  const result = extract(xml, 'result');
  if (result !== null) {
    return { ok: true, output: result };
  }
  throw new Error('unrecognised SOAP response: no <result> element and no <Fault>');
}
