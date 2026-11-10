# A132 — kontrakt implementacji i przyszłego fixture Windows

To dokument odczytu kodu. Pierwszy skrypt A132 jedynie zapisuje te źródła; poniższe tryby nie są uruchamiane przez niego i nie są gotową instrukcją instalacji.

## Zaufany spec

Stały root: C:\GRY\wow\dev\fixture-accounts-windows-A132-<generationN>, dokładnie 32 małe znaki hex bez innych segmentów. Plik run-spec.json do 32768 B. Oczekiwany SHA256 spec pochodzi z chronionego fixed argv przygotowanego osobnym etapem. Ze spec nie wolno wybrać backendu innego niż syntetyczny, dowolnej operacji/path/SQL/URL/command ani profilu dotnet.exe/w3wp.exe.

Dokładne pola: schema=A132-FIXTURE-1, generation GUID D, clientSid (prawdziwy SID puli S-1-5-82 + 5 subauthorities), operatorSid (SID fixture S-1-5-21...), sessionLimit 1–16, worker oraz client. Każdy bundle ma image i files. Wpis pliku: path, length, sha256 uppercase. Duplikaty/nieznane pola/niezgodność generacji rootu są odmową.

worker/image musi być worker/Vmangos.Accounts.Worker.exe; client/image musi być client/Vmangos.Accounts.Windows.Tests.exe. Dla każdej roli wymagane apphost exe, własne dll/deps.json/runtimeconfig.json, Vmangos.Accounts.Core.dll oraz Vmangos.Accounts.Windows.dll. Opcjonalne są tylko trzy odpowiednie PDB. Wymagane zgodne hashe wspólnych DLL w obu kopiach. Maks. 12 plików/rola, 8 MiB/plik, 16 MiB/bundle. Tych wartości nie traktować jako manifestu już istniejącego fixture — powstanie dopiero po Windows buildzie.

Runtime .NET jest zaufaną, osobno weryfikowaną zależnością hosta; nie kopiujemy całego SDK do bundle. Profile środowiska i wersja runtime muszą zostać przypięte przez launcher przyszłego etapu. Odczyt procesowego TokenUser i bundle jest wymagany po obu stronach; niepowodzenie zapytań z tokenu AppPool pozostawia odmowę, bez automatycznej zmiany DACL.

## ACL i własność

Root/public spec, bundle files i ready.json: właściciel SYSTEM lub Administrators, DACL protected, dokładnie SYSTEM i Administrators FullControl oraz dokładny clientSid ReadAndExecute (0x001200A9). Dla katalogów dopuszczalne OI/CI; dla plików jawne ACE bez inheritance. Private katalog i journal/audit/INITIALIZED.json: protected, tylko SYSTEM i Administrators FullControl. Reparse/niestandardowe ścieżki/niezgodna własność/ACL nie są naprawiane przy okazji; są odmową.

Te wymagania dotyczą **przyszłego fixture root**, nie katalogu źródeł A132. Skrypt zapisujący źródła używa dotychczasowej prywatnej DACL SYSTEM/Administrators i nie dodaje AppPool do żadnego istniejącego katalogu.

Pipe ma odrębny descriptor: owner/group SYSTEM, protected, SYSTEM FullControl i dokładny clientSid 0x00120083. Maska klienta obejmuje ReadData, WriteData, ReadAttributes, ReadControl, Synchronize. Nie obejmuje 0x4 AppendData/CreatePipeInstance ani generic write. Taką samą maską klient otwiera pipe; nie wywołuje SetNamedPipeHandleState wymagającego dodatkowych praw. Obie strony ponownie odczytują descriptor z uchwytu. Brak Everyone/Anonymous i brak dynamicznego rozszerzania praw.

## Role procesu

Worker apphost ma wyłącznie dwa jawne tryby: --initialize-fixture oraz --fixture-worker; oba przyjmują root i publiczny expectedSpecSha256, wymagają SYSTEM, własnego przypiętego apphost i pustego środowiska injection overrides. Bez domyślnego startu, shell, credential reader lub task installer. --initialize-fixture CreateNew zapisuje pusty journal/audit i na końcu INITIALIZED.json. Częściowa inicjalizacja wymaga analizy; niczego nie nadpisuje. Worker nigdy nie wywołuje inicjalizacji samodzielnie.

Tests apphost w trybie --fixture-client przyjmuje ten sam chroniony root/hash, wymaga dokładnego tokenu clientSid i zgodnego apphost/bundle. Generuje w pamięci syntetyczny request, wysyła jedno create, a tylko po jednoznacznym sukcesie sprawdza drugi identyczny operationId przez nowe połączenie. Nie ponawia unknown. W spec dla tego pozytywnego scenariusza potrzebne są dwie sesje. Nie używać tego trybu jako klienta produkcyjnego lub rzeczywistej autoryzacji operatora.

Odrębny --model-tests nie używa Win32 i nie startuje pipe. Jego 81 PASS to modele/strumienie/kontrakty i syntetyczny backend; footer jawnie utrzymuje NOT_RUN dla SYSTEM/AppPool/ACL/remote/IIS. ModelData i ModelPeer są w assembly testowym; friend assembly nie służy jako granica przed Administratorem lub wykonaniem dowolnego lokalnego kodu. Bezpieczeństwo danych procesu opiera się na prawdziwym tokenie, chronionym kodzie i polityce uruchomienia.

## Kolejność i błędy

Serwer tworzy first instance zanim opublikuje ready.json. Uchwyt pozostaje ten sam przy poprawnym disconnect/connect. Każdy błąd protokołu/probe/timeoutu zamyka własny pipe i kończy ten run; nie usuwa receipt lub journal i nie tworzy nowej generacji automatycznie. Duplikat ready.json jest odmową. Tylko nowy, osobno przygotowany run może zacząć od nowego rootu/generacji.

Klient: połączenie lokalne → rzeczywisty server PID/token/image/bundle + receipt FILETIME → niesekretne hello → ack nonce/generacji → ponowny probe → dopiero frame z hasłem. Worker: odczyt samego hello → synchroniczna impersonacja identyfikacyjna i natywny probe klienta → ack → ścisły DTO/operator → ponowny probe → OperationEngine na backendzie syntetycznym. Żaden PeerProof/FirstInstance/token dostarczony w JSON nie jest pomiarem OS.

Read/write otrzymuje cancellation token do bazowego PipeStream I/O; brak samego Task.WaitAsync bez anulowania operacji OS. Sesja błędna nie jest ponownie używana; Abort próbuje CancelIoEx i zwalnia własny stream/uchwyt. RevertToSelf failure ma osobny own-worker exit 74 po uprzednim own image/SYSTEM guardzie. Nie wywołujemy FailFast, nie drukujemy raw exception i nie zabijamy procesów według PID znalezionego po nazwie.

Po rozpoczęciu zapisu requestu każda niepewność odpowiedzi to unknown. Lokalny outcome attempts=1 nie jest pomiarem liczby realnych wywołań; to konserwatywny status możliwej próby. Worker przechowuje rzeczywistą liczbę syntetycznych dispatches. Brak identycznego wyniku duplikatu lub niezgodność protokołu przerywa test; bez ponownego create.

## Odbiór wymagający osobnego etapu Windows

Nadal NOT_RUN: prawdziwe tokeny SYSTEM i docelowego AppPool, query tokenu SYSTEM przez klienta, odczyt rzeczywistej DACL i próby access denied, server precreation/spoofing, próba drugiego instance z tokenu klienta, remote client, restart/crash procesu/generacji oraz anulowanie prawdziwego overlapped I/O. Potrzebny będzie manifest/backup dla ewentualnych nowych zasobów fixture, jawny własny task/launcher i weryfikacja final cleanup, bez zmiany istniejących control tasks lub collectora.

Rzeczywisty IIS/operator/CSRF/HTTPS-before-body jest odrębny: ten kandydat nie podłącza klienta do panelu i nie zmienia trzech działających akcji. Global control/pending gate w każdej ścieżce, realny SOAP/SELECT verifier, obserwacja sekretów i 15 luk live nie są zamknięte przez niniejszy kod.

## Dokumentacja pierwotna

- [CreateNamedPipe](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createnamedpipea)
- [Named pipe security](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)
- [CreateFileW i SQOS](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
- [ImpersonateNamedPipeClient](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-impersonatenamedpipeclient)
- [NamedPipeServerStream constructors](https://learn.microsoft.com/en-us/dotnet/api/system.io.pipes.namedpipeserverstream.-ctor?view=net-10.0)
- [NamedPipeClientStream constructors](https://learn.microsoft.com/en-us/dotnet/api/system.io.pipes.namedpipeclientstream.-ctor?view=net-10.0)

Dokumentacja potwierdza kontrakty API, nie wynik nieuruchomionego testu Windows. Dawny projekt A132 z 2026-10-17 00:47 pozostaje historią decyzji; bieżący stan implementacji i granice opisano tutaj.
