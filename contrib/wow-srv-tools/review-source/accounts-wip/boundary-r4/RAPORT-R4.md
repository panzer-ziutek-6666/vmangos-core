# ACCOUNTS-BOUNDARY-PREP R4 — przygotowanie i QA PASS

Zakres wykonany na WOW-SRV: przygotowanie kodu i izolowane QA w Windows PowerShell 5.1.20348.5756 Desktop x64/Admin. Utworzono dokładnie jedno nowe zadanie QA, cały czas Disabled, bez triggerów i restartów. Nie wywołano Run/RunEx ani Enabled=True. Zainstalowany bootstrap A154, sealed FixtureRoot, dotychczasowe zadania, runtime, konfiguracje, usługi, IIS, collector, repo i DB pozostały bez zmian.

## Przyczyna i wybór właściciela

Historyczny NativeVerify R3 pozostaje FAIL w RegisterTaskDefinition, linia 72, HRESULT 0xD000005A / NT 0xC000005A STATUS_INVALID_OWNER. R3 żądał właściciela SYSTEM przez O:SYG:SY. Nie ponawiano tej próby. Katalog C:\VMANGOS-Accounts-Boundary-R3-20261027-1555-Verify, claim 4bbc3f2aa5bd403b9e9095284e802af1 i wszystkie dowody zachowane; ich piny porównano przed/po. Podmiana A154 i jej verifier zachowują historyczny PASS, bez powtórzenia.

Nowy Task.Token.cs otwiera wyłącznie bieżący token procesu z TOKEN_QUERY=8. Odczytuje użytkownika, właściciela domyślnego, grupę podstawową, SID-y i atrybuty grup, przywileje, typ tokenu, podwyższenie i sesję. Nie ma API zmiany tokenu ani włączania przywilejów. Bieżący token: użytkownik Administrator, domyślny OwnerSid S-1-5-32-544 (BA), BA Attributes=15 (Mandatory, EnabledByDefault, Enabled, Owner), Elevated=1, TokenType=Primary. SYSTEM nie występuje jako grupa tego tokenu. SeRestorePrivilege i SeTakeOwnershipPrivilege pozostają Disabled. Token przed/po jest identyczny. Sesja 2 w tych dowodach dotyczy Administratora prowadzącego QA, nie uruchomionego workera SYSTEM.

Przed KAŻDYM utworzeniem/aktualizacją helper wymaga BA obecnego dokładnie raz, enabled, SE_GROUP_OWNER, bez deny-only oraz podwyższonego primary tokenu. Następnie używa O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA). Legalność BA potwierdzono właściwościami bieżącego tokenu i rzeczywistą akceptacją API. Nie uruchamiano ponownego eksperymentu z O:SY i nie używano SeRestorePrivilege jako obejścia. Nie wyciągamy dalej idącego wniosku o wszystkich możliwych kontekstach powodujących historyczny błąd; guard tokenu ma być sprawdzany świeżo przy przyszłym wykonaniu.

Dokumentacja Microsoft rozdziela właściciela obiektu, prawa do obiektu i konto wykonania zadania. Zob. [Owner of a New Object](https://learn.microsoft.com/en-us/windows/win32/secauthz/owner-of-a-new-object), [Access Tokens](https://learn.microsoft.com/en-us/windows/win32/secauthz/access-tokens), [SID Attributes](https://learn.microsoft.com/en-us/windows/win32/secauthz/sid-attributes-in-an-access-token) oraz [RegisterTaskDefinition](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/nf-taskschd-itaskfolder-registertaskdefinition). Właściciel BA nie zmienia principal: pozostaje S-1-5-18 / TASK_LOGON_SERVICE_ACCOUNT=5 / RunLevel=HighestAvailable. Przyszły worker nadal musi sam potwierdzić SYSTEM i session 0. Tego wykonania teraz nie testowano.

## Wspólny kod i rzeczywisty dowód

Task.Security.ps1 jest wspólną implementacją dla obu miejsc parenta: Create (flagi 58) oraz Lock (60). Zachowuje wyłączenie i ignorowanie registration triggers; nie dodaje ACE principal automatycznie. Dla Create wymaga braku zadania; Lock wymaga istniejącego zadania o dokładnym nowym R4 Name i RunId, wyłączonego i bez instancji. Przy każdym zapisie sprawdza definicję, właściciela i chronioną DACL przez COM, a niezależnie właściciela i DACL pliku w System32\Tasks. Wymaga dokładnie dwóch jawnych ACE FullControl, wyłącznie SY i BA; odrzuca obce, dziedziczone, ograniczone lub dodatkowe ACE oraz błędnego właściciela. Weryfikator wyniku używa tej samej kontroli przed wypisaniem PASS. Nowe moduły kopiowane są również do prywatnego katalogu przyszłego workera.

Rzeczywisty test Test-TaskSecurity.RealAPI.ps1 wykonał się dokładnie raz 27.10.2026 około 23:54:53–23:54:59 CET. Użył tych samych niezmienionych funkcji rejestracji, a nie modelu COM. Pełny transcript: C:\GRY\wow\diagnostics\ACCOUNTS-BOUNDARY-PREP-R4-TASK-QA-20261027-235452-593604.log. Dowody oryginalne: C:\VMANGOS-Accounts-Boundary-R4-TaskSecurity-QA-20261027-2355. W paczce wierne kopie w evidence/real-api/ wraz z XML, TOKEN-BEFORE/AFTER, PRE/POST, deskryptorami i HRESULT.

| Kontrola | Wynik |
|---|---|
| Nazwa QA | VMANGOS-BOUNDARY-R4-20261027-2355-SECURITY-QA |
| Identyfikator/Description | bb6ee9fd11f74347b28d5ab140b1f825 |
| Create, odczyt, COM i ACL pliku | PASS, HRESULT 0x00000000 |
| Lock/update, ponowny odczyt COM i ACL pliku | PASS, HRESULT 0x00000000 |
| Właściciel / grupa / principal | BA / BA / SYSTEM |
| COM SDDL | O:BAG:BAD:PAI(A;;FA;;;SY)(A;;FA;;;BA) |
| Plik SDDL | O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA) |
| Stan przez cały test | Disabled; brak triggerów; RestartCount=0; Instances=0 |
| Końcowy AllowDemandStart | False |
| LastTaskResult / LastRunTime | 267011 (0x41303, nigdy nie uruchomiono) / data sentinel 1999-11-30 |
| Akcja | cmd.exe /d /c exit 0; nigdy niewykonana |

Flaga AI zwracana przez COM jest akceptowana przy nadal chronionej DACL i dwóch ACE bez dziedziczenia; nie pomija kontroli praw. Zadanie QA zachowano wyłączone z AllowDemandStart=False jako dowód. Nie wykonywano sprzątania, zmiany uprawnień innego zadania ani startu jakiegokolwiek zadania. Późniejszy ewentualny cleanup może dotyczyć wyłącznie tej dokładnej nazwy po sprawdzeniu RunId.

## Regresje, piny i ograniczenia

Test-R4.Regression.ps1: 74 przypadki, Failed=0, PS5.1. Testowane rzeczywiste funkcje obejmują sprawdzanie tokenu, odmowę nielegalnego BA i deskryptorów, kontrakt/piny, parser, protokół na jawnie syntetycznym capture, Snapshot z kolektorem i ACL w nowym izolowanym katalogu, normalną publikację próbki/diagnostyki i wyłączną blokadę registry.lock, odmowę zmian state/manifest/proof/approval, profile BootstrapUpdate/NativeVerify bez AppPool, Fixture z wymaganiem właściwej generacji AppPool, chronioną konfigurację/ACL, ponowny PID i nowe generacje gry/collectora oraz trwałe claim/result także po błędzie guarda. Modelowe claimy leżą wyłącznie w katalogu *-SOURCE-REGRESSION, nie są próbami NativeVerify/Fixture.

Zastąpiono tylko odczyty hosta/AppPool syntetycznymi danymi podczas regresji; registry/kod/ACL/Snapshot i journal to rzeczywiste funkcje na syntetycznych plikach. Nie odtwarzano transportu kont, nie uruchamiano A154, CLR fixture lub bootstrapu. Rzeczywiste API zadania ma oddzielny dowód powyżej. Source regression oraz wszystkie diagnostyki znajdują się w evidence/REGRESSION-*. Poprawienie po QA kolejności wypisywania PASS w osobnym verifierze nie zmieniło wspólnych modułów użytych w rzeczywistym teście; REAL-API-INPUT-CONTRACT.json i REAL-QA-TESTED-CODE-PINS.tsv jawnie pokazują tę różnicę. Task.Security.ps1, Task.Token.cs, Boundary.Common.ps1, OwnedCapture.cs i Release.Native.cs w dostawie mają te same hashe co podczas rzeczywistego QA. Finalny kontrakt przypina aktualny verifier i komplet 12 wejść operacyjnych.

Snapshot/Get-RegistryPins i ochrona collectora zachowane z R3: chronione state.json, manifests/, proofs/, approvals/, kod/policy/pointer/ACL; zmienne last-sample/diagnostic/lock nie powodują fałszywej niezmienności. Obserwacje AppPool są oddzielone od niezmienników BootstrapUpdate/NativeVerify, a Fixture nadal wymaga świeżej tożsamości/generacji. Nie wybudzano puli HTTP i nie sterowano IIS.

R3-R4-CHANGES.diff i R3-R4-FILE-CHANGES.tsv pokazują dokładny zakres zmian. R4 jest paczką następnej granicy Verify/Fixture: nie zawiera ponownie operacyjnych skryptów Update-FixtureBootstrap, starego Read-PreparationInputs oczekującego OLD, edytora bootstrapu ani ich kontraktu. Pozostają w niezmienionych historycznych paczkach R3. Nowe próby mają nazwy C:\VMANGOS-Accounts-Boundary-R4-20261027-2355-Verify/Fixture oraz odpowiadające zadania; żaden z tych katalogów lub zadań nie powstał. Sealed FixtureRoot i 20 plików/27 rekordów ACL instalacji pozostają przypięte do istniejącego A154. Piny historycznych archiwów, dowodów i źródłowego R3 sprawdzono ponownie. Brak zmian chronionych niezmienników hosta potwierdzają PRE/POST i końcowy odczyt.

PREPARATION=PASS; REAL_TASK_SECURITY_QA=PASS; REGRESSION_TESTS=74/74 PASS. NATIVE_VERIFY=NOT_RUN; FIXTURE=NOT_RUN; ACCOUNT_OPERATIONS=NOT_RUN; SYSTEM_SESSION0_EXECUTION=NOT_RUN. CREATEACCOUNT_LIVE_READY=False; RESET_PASSWORD_LIVE_READY=False. R4 QA potwierdza utworzenie/aktualizację zabezpieczeń zadania, nie uruchomienie natywnej granicy lub gotowość kont. Następny krok po przeglądzie i odrębnym zleceniu: pojedynczy NativeVerify R4. Brak automatycznej kontynuacji po QA.
