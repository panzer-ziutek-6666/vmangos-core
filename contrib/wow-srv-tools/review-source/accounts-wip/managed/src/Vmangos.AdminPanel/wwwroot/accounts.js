'use strict';
(() => {
  const byId = id => document.getElementById(id);
  const form = byId('accountForm');
  const button = byId('createAccount');
  const fields = byId('accountFields');
  const submit = byId('accountSubmit');
  const poll = byId('accountCheck');
  const reset = byId('accountReset');
  let enabled = false, busy = false, operationId = null, locked = false;
  const messages = {
    succeeded: 'Konto GM0 zostało utworzone i zweryfikowane.',
    already_exists: 'Konto już istnieje. Jego hasło i uprawnienia nie zostały zmienione.',
    failed_before_dispatch: 'Operacja zakończyła się przed wysłaniem komendy. Wymagana analiza wyniku.',
    rejected: 'Żądanie odrzucone przed wykonaniem.',
    running: 'Operacja trwa. Sprawdź status; nie wysyłaj jej ponownie.',
    unknown: 'Wynik niepewny. Konto mogło powstać. Wymagane uzgodnienie wyniku.',
    reconciliation_required: 'Wymagane uzgodnienie wyniku. Nie ponawiaj tworzenia konta.',
    succeeded_audit_incomplete: 'Efekt potwierdzony, zapis audytu niepełny. Wymagane uzgodnienie; nie ponawiaj.'
  };
  function status(text, kind = 'wait') {
    byId('accountResult').textContent = text;
    byId('accountResult').className = 'account-result ' + kind;
  }
  function clearPasswords() {
    byId('accountPassword').value = '';
    byId('accountRepeat').value = '';
    byId('accountShow').checked = false;
    byId('accountPassword').type = 'password';
    byId('accountRepeat').type = 'password';
  }
  function controls() {
    fields.disabled = !enabled || busy || locked;
    submit.disabled = !enabled || busy || locked;
    poll.disabled = !operationId || busy;
    reset.disabled = busy || locked;
  }
  function showResult(body) {
    if (!body || body.operationId !== operationId || !Object.hasOwn(messages, body.state)) {
      locked = true;
      status('Brak wiarygodnego wyniku. Sprawdź status operacji; nie ponawiaj.');
      return;
    }
    locked = !['succeeded', 'already_exists', 'rejected', 'failed_before_dispatch'].includes(body.state);
    status(messages[body.state] + ' ID: ' + operationId, body.state === 'succeeded' ? 'ok' : 'wait');
    // Starting another operation always requires an explicit reset; never resubmit a completed ID.
    fields.disabled = true;
    submit.disabled = true;
  }
  async function csrfToken() {
    const response = await fetch('/api/csrf', {cache: 'no-store', credentials: 'same-origin'});
    if (!response.ok) throw new Error('CSRF_UNAVAILABLE');
    const token = await response.json();
    if (typeof token.requestToken !== 'string' || token.requestToken.length === 0) throw new Error('CSRF_UNAVAILABLE');
    return token.requestToken;
  }
  async function init() {
    if (location.protocol !== 'https:') {
      byId('accountNote').textContent = 'Tworzenie kont wymaga wejścia do panelu przez HTTPS.';
      return;
    }
    try {
      const response = await fetch('/api/accounts/capabilities', {cache: 'no-store', credentials: 'same-origin'});
      if (!response.ok) throw new Error('UNAVAILABLE');
      const cap = await response.json();
      enabled = cap.enabled === true;
      button.disabled = !enabled;
      button.textContent = enabled ? 'Utwórz konto' : 'Tworzenie kont wyłączone';
      byId('accountNote').textContent = enabled ? 'Jedno nowe konto GM0. Zapisz wybrane hasło przed wysłaniem.' : 'Funkcja oczekuje na przygotowanie i sprawdzenie backendu.';
    } catch {
      byId('accountNote').textContent = 'Tworzenie kont niedostępne.';
    }
    controls();
  }
  button.addEventListener('click', () => {
    if (!enabled || location.protocol !== 'https:') return;
    form.hidden = false;
    controls();
    byId('accountName').focus();
  });
  byId('accountShow').addEventListener('change', () => {
    const type = byId('accountShow').checked ? 'text' : 'password';
    byId('accountPassword').type = type;
    byId('accountRepeat').type = type;
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!enabled || busy || locked || operationId || location.protocol !== 'https:') return;
    const name = byId('accountName').value;
    const password = byId('accountPassword').value;
    if (!/^[A-Za-z0-9]{3,16}$/.test(name) || !/^[A-Z0-9]{12,16}$/.test(password) || password !== byId('accountRepeat').value || password === name.toUpperCase()) {
      status('Sprawdź nazwę (3–16 liter/cyfr), hasło (12–16 wielkich liter/cyfr) i jego powtórzenie. Hasło musi różnić się od loginu.', 'bad');
      return;
    }
    busy = true; controls();
    let dispatched = false;
    try {
      const token = await csrfToken();
      operationId = crypto.randomUUID();
      locked = true;
      status('Wysyłanie żądania. ID: ' + operationId);
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 10000);
      let response;
      try {
        dispatched = true;
        response = await fetch('/api/accounts/create', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: abort.signal,
          headers: {'Content-Type': 'application/json', 'X-VMANGOS-CSRF': token},
          body: JSON.stringify({operationId, accountName: name, password})
        });
        const body = await response.json();
        const refusedBeforeDispatch = ['HTTPS_REQUIRED','FORBIDDEN','FEATURE_DISABLED','JSON_REQUIRED','CSRF_INVALID','BODY_TOO_LARGE','INVALID_REQUEST'].includes(body.errorCode);
        if (!response.ok && refusedBeforeDispatch && !body.operationId && [400,403,413,415,503].includes(response.status)) {
          locked = false;
          status('Żądanie odrzucone. Kod: ' + ({HTTPS_REQUIRED:'HTTPS_REQUIRED',FORBIDDEN:'FORBIDDEN',FEATURE_DISABLED:'FEATURE_DISABLED',JSON_REQUIRED:'JSON_REQUIRED',CSRF_INVALID:'CSRF_INVALID',BODY_TOO_LARGE:'BODY_TOO_LARGE',INVALID_REQUEST:'INVALID_REQUEST'}[body.errorCode] || 'UNAVAILABLE') + '. ID: ' + operationId, 'bad');
        } else showResult(body);
      } finally { clearTimeout(timer); }
    } catch {
      if (dispatched) status('Brak potwierdzenia. Konto mogło powstać. Sprawdź status; nie wysyłaj ponownie. ID: ' + operationId);
      else { operationId = null; locked = false; status('Nie udało się przygotować żądania; nie wysłano komendy.', 'bad'); }
    } finally {
      clearPasswords(); busy = false; controls();
      if (operationId) { fields.disabled = true; submit.disabled = true; }
    }
  });
  poll.addEventListener('click', async () => {
    if (!operationId || busy) return;
    busy = true; controls();
    try {
      const response = await fetch('/api/accounts/operations/' + operationId, {cache:'no-store',credentials:'same-origin'});
      if (!response.ok) throw new Error('STATUS_UNAVAILABLE');
      showResult(await response.json());
    } catch { locked = true; status('Status niedostępny. Zachowaj ID: ' + operationId + '. Nie ponawiaj tworzenia konta.'); }
    finally { busy = false; controls(); if (operationId) { fields.disabled = true; submit.disabled = true; } }
  });
  reset.addEventListener('click', () => {
    if (busy || locked) return;
    clearPasswords(); operationId = null; byId('accountName').value = ''; status(''); controls();
  });
  window.addEventListener('pagehide', clearPasswords);
  init();
})();
