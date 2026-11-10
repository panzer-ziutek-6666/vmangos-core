# A130 — kandydat CreateAccount GM0

To izolowany kod kandydata na źródłach panelu z A129. Nie jest zainstalowany na IIS, nie tworzy konta na WOW-SRV i nie zawiera klienta HTTP SOAP, klienta SQL ani czytnika credentials.

## Zaimplementowany zakres

- Istniejąca aplikacja net10.0: nowe trasy POST `/api/accounts/create`, GET `/api/accounts/capabilities` i GET `/api/accounts/operations/{operationId}`; sprawdzenie HTTPS przed body/model binding, dotychczasowa granica WindowsIdentity/Administrators SID i jawna walidacja antiforgery.
- Ścisły JSON do 2048 B: operationId GUID, accountName i password; odmowa dodatkowych/powtórzonych pól, zagnieżdżeń, Unicode i niedozwolonego alfabetu. Nazwa 3–16 ASCII alnum, canonical uppercase; RNDBOT i tymczasowa lista nazw technicznych odrzucone. Hasło 12–16 A–Z/0–9 bez trim/truncation; różne od jawnego loginu, aby audyt nazwy nie stał się zapisem hasła. Dokładną listę technicznych tożsamości trzeba potwierdzić przed live.
- Osobny formularz, powtórzenie hasła, opcjonalne pokazanie go przed wysłaniem, czyszczenie pól po próbie/pagehide. Brak localStorage/sessionStorage, hasła w statusie/URL i automatycznego retry. Niepewny wynik blokuje nowy formularz; polling tylko po operationId.
- Silnik operacji niezależny od IIS: powtórna walidacja, pre-audit, journal intent/dispatching/terminal, jedno wywołanie backendu na ID, konflikt celu/operatora, pending/unknown po crash/timeout oraz blokada kolejnych operacji do uzgodnienia. HTTP disconnect po przyjęciu nie ponawia operacji.
- Ograniczone pliki journal/audit z WriteThrough i flushToDisk, wyłącznym uchwytem i odmową niepełnego/uszkodzonego rekordu. Nowy pusty plik tylko przez jawne CreateNew; brak istniejącego pliku nie resetuje historii. 512 rekordów, plik 1 MiB, rekord 4096 B; brak automatycznej rotacji/usuwania. Produkcyjna archiwizacja i instalacja prywatnego rootu są dalszym zakresem.
- Kod ramki IPC do 4096 B, ścisłe DTO/generation i logiczna weryfikacja dowodu peer. Stałe mapowanie XML wyłącznie na account create i bounded parser struktury odpowiedzi z zakazem DTD. Sam poprawny XML nie dowodzi sukcesu core; live klasyfikator odpowiedzi nie jest zaimplementowany.

## Domyślna odmowa i atrapy

`Program.cs` rejestruje wyłącznie `DisabledAccountGateway`. Capabilities ma enabled=false/liveReady=false. Nie ma opcji konfiguracyjnej podłączającej fake lub rzeczywisty backend. Kod silnika i plików journal nie jest uruchamiany przez IIS w tym kandydacie.

Fake gateway/backend/control gate oraz wstrzyknięcie operator SID są w testach. Produkcyjne mapowanie trasy zawsze używa `WindowsOperatorSid`, nigdy parametru z body/header/query. Testy z atrapą nie potwierdzają rzeczywistego tokenu Windows lub ACL.

Wynik succeeded w testach oznacza potwierdzenie przez atrapę core, pełną atrapę verifiera i trwały terminalny zapis w badanym modelu. Nie jest dowodem utworzenia konta w realmd_dev. Testy verifiera osobno odrzucają stare ID, inną nazwę, GM>0, elevated account_access, złe defaulty, brak realmcharacters, niepotwierdzony szerszy REPLACE i niepełność obserwacji.

## Stan granicy Windows

Brak rzeczywistego named pipe, hosta workera SYSTEM, taska, instalacji ACL/credentials i podłączenia SOAP/SQL. `PeerProof` musi pochodzić w przyszłości z zaufanych lokalnych pomiarów tokenu/procesu, nie z JSON. Obecne testy sprawdzają wyłącznie logikę dopasowania dowodu i ramkę. Ich PASS nie jest testem pipe spoofingu na Windows.

Wspólny gate silnika jest interfejsem; testy używają współdzielonej atrapy. Nie zmieniono istniejącego bridge/controller. Wymagania trwałego pending gate dla service-control i ścieżek boot/manual opisuje WINDOWS-BOUNDARY-A130.md. Nie podłączać hasła do obecnego schtasks/PowerShell/stdout/stderr.

## Testy i build

Zależności C#: wyłącznie framework net10.0/ASP.NET Core, bez dodatkowych pakietów NuGet. NuGet.Config nie zawiera zewnętrznych źródeł. Build/test na innym systemie nie zastępuje odbioru na WOW-SRV. Skrypt etapu A130 tylko zapisuje źródła; nie wykonuje tych komend na Windows.

Przykładowe osobne polecenia dla późniejszego, izolowanego etapu builda po preflight toolchain:

```text
dotnet build tests/Vmangos.Accounts.Tests/Vmangos.Accounts.Tests.csproj -c Release -m:1 -p:BuildInParallel=false -nr:false
dotnet tests/Vmangos.Accounts.Tests/bin/Release/net10.0/Vmangos.Accounts.Tests.dll
```

Opcjonalne BrowserTests.cjs wymaga Node oraz Playwright/Chromium. Przechwytuje wszystkie żądania w pamięci; nie łączy się z WOW-SRV. Skrypt A130 nie instaluje Node, SDK lub przeglądarki. Dowód lokalnych wyników znajduje się w evidence/QA-RESULT.json i osobnych logach bez sekretów.

## Ograniczenia

Nie obiecujemy exactly-once transportu SOAP ani wyzerowania każdej kopii immutable string/XML w pamięci .NET. Kontrolowane bufory są czyszczone; hasło nie jest typem record, nie ma go w serializacji DTO/status/audit/journal. At-most-one dotyczy wywołania interfejsu backendu na operationId w badanym modelu; backend live nie może sam ponawiać HTTP. Timeout może pozostawić wywołanie w toku, dlatego trwały pending blokuje dalsze działanie. Nie ma automatycznego replay/reconciliation, delete konta lub restore.

Wszystkie 15 luk live z checkpointu 02 pozostaje otwartych. CREATEACCOUNT_LIVE_READY=False; RESET_PASSWORD_LIVE_READY=False. Reset hasła, SetGM i Announce są poza zakresem.

Dokumentacje odniesienia sprawdzone 2026-10-16: [Microsoft antiforgery](https://learn.microsoft.com/aspnet/core/security/anti-request-forgery?view=aspnetcore-10.0), [middleware](https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis/middleware?view=aspnetcore-10.0), [oficjalny SDK](https://dotnet.microsoft.com/en-us/download/dotnet/10.0). Fakty o kandydacie i wyniki testów pochodzą z jego kodu, nie z samej dokumentacji.
