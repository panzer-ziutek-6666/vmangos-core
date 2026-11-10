# A139 — lokalizacja po diagnostyce ACL A138-R1

## Dowód

A138-R1, WOW-SRV, 2026-10-20 22:04:33–22:04:57 Europe/Warsaw: OK=True / ACL_DIAGNOSTIC_COMPLETE=True. 589 pinów, stan hosta i 20 deskryptorów zgodne przed/po. 166 ACE, sześć ścieżek odrzuconych przez dotychczasową ścisłą politykę. PACKAGE_CREATION_APPROVED=False. Oryginalny A138 pozostaje FAIL; brak pakietu lub fixture.

Na C:\GRY\wow\dev, C:\GRY\wow, C:\GRY i C:\scripts wspólny odziedziczony ACE Allow dla S-1-5-32-545 ma maskę 0x00000002, ContainerInherit, Inherited, bez InheritOnly. Dla katalogu bit ten oznacza FILE_ADD_FILE. Nie oznacza FullControl, skutecznej podmiany istniejącego pliku lub przeprowadzonej próby dostępu. C:\ProgramData i C:\ProgramData\VMANGOS mają też Allow tego SID z maską 0x00000116. R1 nie liczył efektywnego dostępu i nie ustalał pełnej historii pochodzenia ACE.

C:\ przechodzi dotychczasowy profil przodka: zaufany owner TrustedInstaller, protected DACL, zero odrzuconych allow-write ACE. InheritOnly nie grantuje bieżącemu obiektowi. Dopuszczenie FILE_ADD_SUBDIRECTORY na przodku pozostaje dotychczasową zasadą; tworzenie losowej generacji musi odmawiać istniejącego obiektu zamiast przejmować go lub zmieniać jego ACL.

## Zmiana kontraktu

1. FixtureSpec przyjmuje tylko `C:\VMANGOS-Accounts-Fixture-A139-<generation N, lowercase>`, bez dodatkowego rodzica. Root musi nadal odpowiadać generacji w JSON.
2. Schema zmienia się na `A139-FIXTURE-1`. Stare spec A135/A132 i stare rooty nie są kompatybilne. Nie ma fallbacku, wyboru dysku, relokacji w runtime ani przejęcia istniejącego katalogu.
3. ProcessAccessPolicy pozostaje `A135-PRIVATE-TOKEN-QUERY-1`. Runtime, trzy bundle, piny, limity, klient, operator, maski, owner/DACL i uchwyty nie zmieniają się. RuntimeLease.AssertRuntimeDescriptor i FixtureDirectoryLease są byte-exact z A136.
4. Zmieniony jest jeden plik produkcyjny FixtureSpec.cs i dwa istniejące pliki testów. Dodano odrębne testy lokalizacji/schema. 30 plików A130 zachowano byte-exact. Nowe binarki trzeba zbudować osobno na Windows; poprzednie A137 zachowują swój stary kontrakt.

## Granice bieżącego etapu

A139 na WOW-SRV jest source-only: nowy prywatny katalog pod C:\GRY\wow\dev i log, manifest oraz wynik. Przygotowuje kod do późniejszego buildu. Ten katalog źródeł nie staje się finalnym SYSTEM fixture. Żaden istniejący ACL lub plik nie jest zmieniany.

Nie ma instalacji, finalnego rootu, taska SYSTEM, bootstrapu, uruchomienia launchera/worker/client/pipe/desktop/Job, zmiany praw puli lub startu IIS. Nie ma SQL, SOAP, RA, HTTP do aplikacji, poświadczeń lub odczytu ciał logów runtime. Live CreateAccount i reset hasła pozostają wyłączone.

Przed finalnym fixture potrzebne są nowe Windows binarki, osobny pakiet w zgodnej prywatnej lokalizacji oraz chroniony SYSTEM bootstrap przed załadowaniem CLR/Main. Bootstrap musi świeżo sprawdzić C:\ i runtime, odmówić istniejącego rootu/reparse, atomowo utworzyć generację z wymaganym owner/DACL, sprawdzić i utrzymywać bundle/runtime oraz środowisko. Sam ten dokument lub zmiana regexu nie implementuje bootstrapu ani nie dowodzi ochrony pre-Main.

Chroniony pakiet przygotowawczy powinien również powstać w odrębnej losowej generacji bezpośrednio pod C:\, z prywatnym SYSTEM/Administrators DACL, zamiast pod dev/ProgramData. Dokładne nazwy, zakres, piny i wykonanie zostaną dostarczone w osobnym etapie po Windows build PASS. A138 nie jest automatycznie ponawiany, jego polityka nie jest rozluźniana.

## Sprawdzenia

Modele weryfikują nowy root i aktualne schema, odrzucają dev/ProgramData, inne dyski, UNC/device/relative/traversal, błędny format generacji, suffixy, ADS, białe znaki, stare schema, niespójną i zerową generację. Pozostałe modele launchera i regresje Core pozostają wykonywane. To test parsera/kontraktu, nie Win32 efektywnych ACL lub startu procesu.

Backup istniejących danych nie jest potrzebny do zapisu nowego kandydata. Rollback: zachować go nieużywanego; bez automatycznego kasowania lub odtwarzania. Jeden następny krok po pełnym logu A139 PASS: osobny A140 Windows Release i modele. Przy FAIL oddzielne A139-R1 po analizie, bez retry w ciemno.

Źródła semantyki Win32: [File Access Rights Constants](https://learn.microsoft.com/en-us/windows/win32/fileio/file-access-rights-constants), [Well-known SIDs](https://learn.microsoft.com/en-us/windows/win32/secauthz/well-known-sids). Stan i ACE pochodzą wyłącznie z przypiętego pełnego logu R1; semantyka nie jest dowodem skutecznego dostępu.
