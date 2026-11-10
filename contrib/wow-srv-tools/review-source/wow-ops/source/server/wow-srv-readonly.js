// WOW-SRV fork: deliberately non-networked SOAP and non-persistent audit for read-only phase.
// No real SOAP client is constructed in the executable WOW-SRV entrypoint.
export function createDisabledSoapClient() {
  return Object.freeze({
    execute: async () => ({
      ok: false,
      status: 'disabled',
      output: 'SOAP is disabled in the WOW-SRV read-only deployment.',
      durationMs: 0
    }),
    queueDepth: () => 0
  });
}

export function createReadOnlyAudit() {
  return Object.freeze({
    recent: () => [],
    record: () => { throw new Error('Audit writes are disabled in WOW-SRV read-only mode.'); },
    close: () => {}
  });
}
