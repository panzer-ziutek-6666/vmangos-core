R2: minimalna poprawka CREATE DATABASE → USE w tym samym programie preimages. Cały program wykonano na odizolowanym MySQL DEV, od DATABASE()=NULL, także na sesyjnych TEMPORARY fixtures z niezerowymi efektami7UPDATE/2DELETE. Dane i wcześniejsze preimages DEV zachowane, MySQL DEV graceful stopped/native0 obu procesów. Produkcja odzyskana na starym R3; nowego deploymentu NIE wykonywano. Historyczny nieaktywny staging v1 i częściowy audit zachowano. Nowe wejścia/approval r2 nie są wystawione; Approved=false/NoDDLWindow=false.

# Pełny core — produkcyjny plan wykonawczy R2

Stan przygotowania: DEPLOYMENT=NOT_RUN, Approved=false, NoDDLWindow=false. Publikacja pełnego PR18 jest zakończona: bb71dfc8c5b7e19664d8633801e362aa234aa51c. Nie jest to dowód merge ani CI PASS. Obecna produkcja nadal core-b1c0e16e-shutdown1053-r3.

Jedyny kandydat: core-e8160a07-full-local-r1; CANDIDATE-MANIFEST SHA256 D3FD840BFDC65D5852612DA64005F2945689D3A66308525CD8B7B059878A4DBB. Embedded revision e8160a07e67708f75597 wskazuje bazę buildu, nie późniejszy commit publikacji PR. Pełny Release/link i EXE/PDB oraz 24 testy C++ wykorzystano z odebranych dowodów, bez ponownego buildu. DevMigrations 7ddeb3c13abd4ca48f8b4e795e80bcc6 i DevAccept e56bd2d4340e412a82b9a5c4b65abb3e mają osobne dokładne receipt/verifier hashes w KIT-PLAN.FullCandidate; stare zgody DEV nie upoważniają wdrożenia.

## Cele plikowe i ochrona

EXACT-FILES.tsv zawiera 17 dokładnych celów ze źródłami i hashami. Runtime: wyłącznie mangosd.exe i realmd.exe w C:\GRY\wow\serwer-dev. Cztery zgodne APPLOCAL_DLL pozostają bez podmiany (DLL-PINS.tsv). Wszystkie *.conf/*.ini oraz DLL mają ochronne piny i SDDL; konfiguracja MySQL, aplikacji i AutoHonor bez zmian. Pasujące PDB kopiowane wyłącznie do C:\Scripts\Symbols\core-e8160a07-full-local-r1, poza runtime. Nowy kontroler trafia do C:\ProgramData\VMANGOS\AdminPanelBridge\core-e8160a07-full-local-r1-v2, bez nadpisania poprzednich wersji.

Kontroler to odebrany FIX5 z jedyną zmianą guarda lokalizacji instalacji. Wrappery/dispatcher pozostają identyczne, zapis jest pomijany przy zgodnych bajtach. Aktywna zmiana routingu następuje przez r3-bundle-current.json dopiero po gotowości i naturalnym commit registry. Definicje/SDDL/harmonogramy zadań nie są przepisywane. Gate wyłącza pięć istniejących zadań; po pełnym odbiorze odtwarza dokładne wcześniejsze Enabled: cztery true i AUTO-START false. Maintenance i blokady uniemożliwiają konkurencyjne sterowanie. Collector pozostaje uruchomiony i na tym samym kodzie D92D2F...; nie jest reinstalowany. Nowy manifest, build-proof, capability, activation i bundle są teraz materiałami nieaktywnymi.

## Przyszła zgoda i wejścia

Wymagana nowa zgoda Scope=MigrateFull, ważność maksymalnie24h (generator wydaje4h), związana z finalnym KIT-PLAN i EXECUTION-PINS. Musi obejmować: wyciszenie pięciu zadań i Maintenance, backup plików, final-write logical backup czterech baz AllInnoDB/single-transaction, świeże okno bez DDL, dwa dokładne SQL, prywatny schemat preimages vmangos_migration_audit_<operation>, podmianę2EXE, symbole poza runtime, instalację kontrolera, registry/release/capability/bundle, start/gotowość i odtworzenie Enabled. Bez global read lock, restore DB lub rebootu Windows.

SourceDefaults i SourceMigrationDefaults wskazują istniejący C:\ProgramData\VMANGOS\R3Approvals\source-backup-candidate.ini. Odczyt SHOW GRANTS potwierdził wymagane bezpośrednie globalne uprawnienia istniejącego konta; nie wykonywano DML dla ich sprawdzenia. Sekret nie trafia do argumentów, konsoli lub ZIP. Gdy plik lub granty ulegną zmianie, Execute odmawia przed Gate. Nie tworzy kont/grantów. Nowe prywatne pliki będą: inputs-core-full-production-r2.json i MigrateFull-core-full-production-r2.json. Teraz ich nie wystawiono; szablony w paczce są false.

Wolne miejsce sprawdzane ponownie przed Gate: więcej niż max(20GiB, 6x przybliżony rozmiar baz+1GiB). Dump może być większy niż oszacowanie; błąd miejsca lub kompletności zatrzymuje operację. Nie kopiować działającego MySQL Data.

## Sekwencja i niezależny odbiór

Domyślny tryb Deploy-FullCandidate i Invoke-Deployment to Plan. Get-FullSteps w FullProduction.ps1 jest autorytatywną sekwencją34etapów:
1. Fresh guards/pins/DEV/stable registry+Maintenance/lock/NoDDL/SQL sets/grants/space; żaden nieukończony claim nie może być wznowiony w ciemno.
2. Gate, backup wszystkich celów wraz z hashami/SDDL/fileID i beforeRegistry; nowy kontroler staging z Approved=false; rejestracja i BeginTransition dokładnego release.
3. Graceful STOP mangosd, dopiero po native0 i świeżym SCM/CIM zakończenia STOP realmd. FIX5 mierzy uchwyty przed Dispose, potem potwierdza brak procesów, nie czeka z otwartym uchwytem na zniknięcie rekordu CIM. Nonzero/UNKNOWN/timeout/evidence/cleanup blokuje dalszą zależność.
4. Przy działającym, ponownie przypisanym MySQL3306: świeży logiczny backup4baz po finalnych zapisach core. Native0, znacznik kompletności,4USE, liczby tabel oraz SHA256. To nie dump DevSetup. Restore test tego przyszłego dumpa jest NOT_RUN.
5. Prywatne preimages LIKE z pełnymi PK i zgodnym schematem wszystkich kolumn. World: entry,patch. Queststatus: guid,quest. Kopie world_before/world_expected/queststatus_before/queststatus_expected/characters_before/expected_deleted. Oczekiwane skutki wyliczane z tego konkretnego snapshotu, nie ze stałych126/15.
6. Dokładnie world20261025125310 (2C6E753AB488ABCCA1FB3B651466B66B0D0E024BDAB38BFE7CD4374FD4E834A9), odbiór wszystkich kolumn/missing0/extra0; potem characters20261025125408 (8F9F649F5573388E9BD6962EE57776DEC466F4D7540574366635B2C914A235A9), dokładny zbiór usunięć oraz identyczność pozostałych wierszy i wszystkich kolumn. Cztery pełne zbiory migrations bez rozbieżności.
7. Eksport prywatnych preimages i niezależny proces Verify-QuiescentSQL przy wciąż zatrzymanych world/realm. Dopiero jego native0/PASS dopuszcza STOP MySQL; oba procesy MySQL muszą mieć zmierzone native0.
8. Symbole poza runtime,2EXE, Test-ReleaseSet, aktywacyjne receipty; START MySQL→realmd→mangosd, własność3306/3724/8085 i loopbackSOAP7878, świeży World initialized właściwej nowej generacji. Timeout gotowości nie zabija procesu.
9. RequestCommit, dwie różne świeże zdrowe naturalne próbki collectora z właściwego release/generacji, publish bundle, dokładne przywrócenie Enabled i ochrona plików/SCM/DEV.
10. Osobny Verify-Deployment sprawdza rzeczywisty native głównego procesu (PID+pełny API CreatedUtc), wszystkie34etapy, backupy, niezależny quiescent SQL proof, native0 world/realm/obuMySQL, pliki/PDB/routing, nową generację/porty/markery, Stable Maintenance+registry, dwie kolejne świeże próbki i zadania. Pełnych danych queststatus nie porównuje się ponownie po wpuszczeniu graczy: autorytatywny all-column proof powstaje przed startem świata. Świeżo odczytywane są pełne zbiory migracji.

Każda próba SQL jest trwale zapisana PRZED wywołaniem klienta. SQL zawiera DDL procedury i wpisuje marker przed DML; nie jest atomowy. Native0/marker sam nie stanowi odbioru danych. Nie ma automatycznego replay.

## Ryzyko i czas przerwy

Dzisiejszy read-only stan: dokładnie2brakujące migracje, extra0,4bazy InnoDB, brak aktywnego DDL. Świeże produkcyjne predykaty dają126zmian masek i15usunięć queststatus; to obserwacja, nie kontrakt przyszłej liczby. Wśród15 jest13wierszy status3 przy rewarded0 oraz2 status0. Kod usuwa także ukończone, ale nieodebrane questy, mimo komentarza o pozostawianiu completed. Nie zmieniono przypiętego SQL — ten skutek wymaga świadomego odbioru zakresu przyszłej zgody. Rewarded!=0 pozostaje. Identyfikatory graczy nie są eksportowane do paczki.

Start starego świata do pełnej gotowości zmierzono około5min; poprzednia migracjaR3 miała przerwę312.578s. Ciepły DEV nowego kandydata nie jest miarą produkcji. Rezerwacja organizacyjna10–20min PLUS nieograniczona z góry nadwyżka faktycznego dumpa/SQL/startu/odmowy, a nie obietnica SLA lub limit kill. Przerwę mierzyć od braku dostępności8085 do pełnej potwierdzonej gotowości nowej generacji; obecny etap nie miał przerwy. Aktualne dane fizyczne+indeksy około2GiB; właściwy dump powstanie dopiero podczas wdrożenia.

Po FAIL/UNKNOWN zostaje bieżący stan i blokada sterowania. Bez drugiego Execute/START, force-kill, automatycznego rollbacku/restore, restartu Windows. Odczytać pełny receipt i procesy; dostępność może wymagać osobno zatwierdzonego odzyskania.

ClientSmoke=NOT_RUN. Rzeczywisty Windows reboot/PRESHUTDOWN/SCM recovery i Codex PENDING_REAL_REBOOT nie są dowiedzione przez build/DEV/deployment. AutoHonor i harmonogram pozostają bez zmian i nie są wiązane z rebootem Windows. Panel/Windowsops mają osobną kolejkę.