# Kontrakt i ograniczenia implementacji A136

## Zakres źródeł

Nowy launcher jest zamkniętym programem fixture. Akceptuje wyłącznie `--fixture-launch`, chroniony absolutny root i publiczny SHA256 spec. Worker ma dwa stałe tryby inicjalizacji/serwera, a klient dwa syntetyczne żądania tej samej operacji: sukces i duplikat. Oczekiwane wyniki to trzy własne dzieci, dwie sesje i jedno syntetyczne wywołanie backendu. Nie ma dowolnej komendy, dynamicznego backendu, odbiorcy sieciowego ani hasła w argv/env/spec/receipt/journal/audit/stdout/stderr.

Spec ma ścisły zestaw pól: `schema,generation,clientSid,operatorSid,sessionLimit,worker,client,launcher,runtime,processAccessPolicy,limits`. Stałe: `A135-FIXTURE-1`, `A135-PRIVATE-TOKEN-QUERY-1`, dokładny SID puli, dwie sesje, budżet launchera 300 s, do trzech jednoczesnych dzieci i capture do 65536 B na stdout/stderr. Root/generacja/nazwy apphostów i trzy zestawy plików są wiązane ze sobą; wspólne DLL Core/Windows muszą mieć zgodne piny. Inna wersja spec lub nieznane pole powoduje odmowę.

## Tokeny i procesy

Źródłowy SYSTEM token pochodzi z własnego procesu launchera, a token puli z unikalnego żywego w3wp z dokładną ścieżką i SID. Nie aktywuje się/recyklinguje puli. Uchwyty źródeł są utrzymywane; odczytywane są primary TokenUser/TokenId, deskryptory, default DACL oraz grupy/uprawnienia/session. Snapshot przed i po musi być zgodny. Nie ma `SetTokenInformation`, `AdjustTokenPrivileges`, zmiany grup ani zapisu do źródeł.

`DuplicateTokenEx` tworzy osobne primary tokeny initializer/worker/client. Nowy TokenId musi być inny od źródła, AuthenticationId i TokenUser zgodne, default DACL niezmieniona. Deskryptory nowych obiektów mają wyłącznie SYSTEM/Administrators full oraz dokładny SID puli z odczytem: proces `PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE=0x00101000`, token `TOKEN_QUERY=8`. Uprawnienia owner/group/SACL nie są żądane jako część tworzonego deskryptora. Późniejszy odczyt kontroluje ochronę DACL, właściciela oraz dokładne ACE; nie ma automatycznej naprawy deskryptora.

Dzieci startują przez CreateProcessAsUserW jako suspended, z jawnymi process/thread security attributes, jawnym Unicode environment i whitelistą tylko trzech uchwytów standardowego I/O. Własny nienazwany Job ma kill-on-close i limit trzech aktywnych procesów. Przed resume muszą zgadzać się Job/PID/creation time/image/process DACL/primary TokenId/TokenUser/token DACL. Błąd zabija wyłącznie dziecko przez utrzymany własny uchwyt; brak PID-based kill obcych procesów. Po sukcesie uchwyt procesu zostaje zamknięty przed końcowym sprawdzeniem Job. Błąd cleanup nie jest sukcesem.

Klient jest przygotowany suspended jeszcze przed startem workera, aby kontrole launchera nie zużyły jego krótkiego connect deadline. Resume klienta wymaga ready receipt zgodnego z zachowanym PID i native FILETIME workera. Rozszerzone źródła zachowują dotychczasowy dowód peer z rzeczywistego tokenu/procesu po obu stronach pipe. Po impersonacji wymagany jest RevertToSelf oraz brak thread tokenu; błąd kończy tylko własny worker kodem 74.

## Desktop klienta

Windows wymaga dostępu uruchamianego użytkownika do wskazanego desktopu/window station. Implementacja tworzy prywatne obiekty `A135-Client-<generation>\\Fixture`; station używa create-only. Początkowo dostęp mają tylko SYSTEM/Administrators. Skojarzenie procesu/wątku zmienia się wyłącznie synchronicznie we własnym launcherze podczas tworzenia; powrót jest sprawdzany przed przyznaniem puli praw do nowych obiektów. Nieudany powrót kończy wyłącznie launcher kodem 77. Dzieci SYSTEM pozostają na pierwotnym desktopie SYSTEM; tylko klient używa nowego.

Istniejące user objects i ich ACL nie są zmieniane. Nowe obiekty mają jawne prawa SYSTEM/Administrators/puli oraz sprawdzenie deskryptora. Natywne tworzenie, powrót, otwarcie przez klienta i cleanup pozostają NOT_RUN; cztery testy modelu dotyczą wyłącznie nazwy/generacji/SID/maski polityki. Nie traktować ich jako testu user32.

## Payload i runtime

Trzy bundle i runtime są otwierane bez współdzielenia write/delete; weryfikacja hashy/rozmiarów/ACL powtarza się podczas pracy. Root i jego istniejące katalogi nadrzędne są sprawdzane na reparse/niezaufanych właścicieli/prawa zapisu oraz utrzymywane bez share-delete. Nie ma repair/relax ACL.

Runtime jest stały: Registry32 `InstalledVersions\\x64`, REG_SZ `C:\Program Files\dotnet` z opcjonalnym końcowym backslashem, wyłącznie hostfxr i Microsoft.NETCore.App 10.0.12 oraz `rollForward=Disable`. Inwentarz wszystkich plików obu wersjonowanych poddrzew musi odpowiadać chronionej liście. Właściciele/prawa runtime i przodków są ograniczone do zaufanych SYSTEM/Administrators/TrustedInstaller. Nie jest to attestation całej pamięci procesu lub bibliotek systemu operacyjnego.

Dzieci dostają wyłącznie SystemRoot/windir/SystemDrive, PATH do System32, prywatne TEMP/TMP i wyłączoną diagnostykę .NET. Nie dziedziczą środowiska launchera. Dotychczasowa odmowa znanych hooks/profilerów w workerze pozostaje dodatkową kontrolą. Samo wykonanie Main launchera nie jest dowodem czystego jego pre-Main: przyszły bootstrap musi to zapewnić przed startem .NET.

## Weryfikacja i granice

Linux/SDK10.0.401: wszystkie siedem projektów Release bez warnings/errors; 118 modeli, w tym 37 dodanych w A136, oraz 121 regresji Core PASS. Próby launchera/workera na Linux odmawiają przed Win32. Nowych testów natywnych nie wykonano. A133 potwierdził starsze sześć projektów/81 modeli na Windows; nie przenosimy tego wyniku na nowy kod.

Przed rzeczywistym fixture wymagane są osobne buildy Windows i chroniony bootstrap/root/spec/seal runtime, a następnie natywne próby pozytywne i negatywne z A135. Szczególnie sprawdzić: wymagane prawa CreateProcessAsUserW bez zmiany źródeł, zachowanie TokenId po tworzeniu procesu, dokładne maski/owner nowych obiektów, dostęp procesu puli do procesu/tokenu nowego SYSTEM workera, deskop klienta i powrót, Job/no-orphans oraz timeout/failed-resume cleanup. Odmowa któregokolwiek warunku zatrzymuje test. Brak fallback do collectora, poszerzenia ACL lub dowodu deklarowanego przez klienta.

A136 PS1 wykonuje wyłącznie source staging. Nie konstruuje spec, runtime seal ani chronionego fixture root, nie buduje/uruchamia kandydata i nie tworzy taska/pipe/desktopu. Wszystkie 15 luk live pozostaje otwartych; nie ma zgody na realne CreateAccount/reset hasła.
