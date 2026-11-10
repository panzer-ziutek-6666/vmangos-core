# Walidacja — fakty, modele i zakres niewykonany

## Wykonane teraz

- Potwierdzono WOW-SRV, Administratora i PS5.1 Desktop x64. Odczyty/hashowanie korzystają z poolu do trzech workerów; każdy wynik i błąd jest zbierany.
- Aktualny panel IIS: wszystkie 10 plików publish odpowiadają zaakceptowanemu manifestowi PANEL-CORE-MANIFEST-R1. Znaleziono aktualne źródła, nie tylko spis artefaktów. Eksport A129 jest dowodem wcześniejszej bazy A73/A71.
- Pełny nowy build/publish panelu w izolacji, SDK 10.0.401, NuGet z wyczyszczonymi źródłami: native0. Tester rzeczywistej nowej DLL/PDB: 34/34 PASS, native0. Zmieniony fixture jest całkowicie syntetyczny. Nie uruchamiano IIS ani HTTP, Windows Auth lub zadań SYSTEM.
- wow-ops: siedmioplikowy patch przeszedł --check i apply w izolacji. Wynik jest zgodny treściowo; normalizowano jedynie CRLF/LF/BOM. Trzy testy adaptacji: 12/12 PASS, native0, z zastępczymi poolami/transports i in-memory inject, bez SQL/SOAP i nasłuchu. Zależności nie były pobierane ani aktualizowane; przypięto wersje oraz lokalne bajty 2899 plików 83 pakietów poza dostawą.
- Parser PS5.1: 135 plików źródłowych bez błędów. Sprawdzono struktury JSON, zależności względnych importów i odwołania projektów. Nie wykonywano operacyjnych wejść tych skryptów.
- Kontrola zawartości: jawna lista źródeł, wykluczenia plików/stanu/binarii, sygnatury kluczy/tokenów/DPAPI, struktury konfiguracji i połączeń oraz przegląd kontekstu wszystkich zgłoszonych literałów. Publiczne domyślne hasła zastąpiono placeholderami wyłącznie w kopii. Dane historycznego fixture zastąpiono syntetycznymi. Nie wyświetlano wartości sekretów.
- Finalny manifest i weryfikacja ZIP po rozpakowaniu obejmują kompletność, rozmiary, SHA256, parser i wyłączenia. Szczegółowy wynik zostaje na hoście.

## Odebrane dowody wykorzystane przy zgodnych wejściach

Pełny core-e8160a07-full-local-r1: zaakceptowany Release/link EXE/PDB i 24 testy C++. DevMigrations 7ddeb3c13abd4ca48f8b4e795e80bcc6 oraz DevAccept e56bd2d4340e412a82b9a5c4b65abb3e mają niezależny PASS. Testy C++ miały jawne zastępstwa granic SQL/SCM; rzeczywisty lifecycle DEV i migracje klona stanowią osobne dowody. Nie powtarzano buildu core ani DEV.

MigrateFull R2 f6b5458df54f445e978f35479e7c8798: rzeczywiste 34 etapy, native0; backup czterech baz i plików, dwie migracje, dwa EXE, PDB poza runtime, controller/bundle oraz graceful STOP i START. Receipt SHA256: 7319312BECC2CD707CF67747932AEEE4D5A366800E2A5C497AF3D993EF92EAD2.

Dowód danych powstał po finalnych zapisach core, przed dopuszczeniem graczy. Pełne PK i wszystkie kolumny, missing0/extra0: potwierdzone w odebranym SQL proof. Wyniki 126 zmian masek i 15 usunięć dotyczą tamtych preimages; nie są stałymi dla następnej migracji. Nie porównywano żywych danych graczy ponownie do dawnych kopii.

SQL kolegi: world20261025125310 (maski ras questów), SHA256 2C6E753AB488ABCCA1FB3B651466B66B0D0E024BDAB38BFE7CD4374FD4E834A9; characters20261025125408 (kwalifikujące queststatus rewarded=0), SHA256 8F9F649F5573388E9BD6962EE57776DEC466F4D7540574366635B2C914A235A9. To referencje upstream, bez dumpów i danych w dostawie.

Oryginalny verifier R2 pozostaje FAIL/native1. Odrębny verifier R3: 17/17 testów rzeczywistego oczekiwania z kontrolowanym IO/zegarem, następnie rzeczywisty ReadCollector i pełny odbiór PASS/native0. Dwie naturalne zdrowe próbki w 24,9 s; dowód SHA256 B98D595518F85AD4317E39B0FC633E9AE5B2D81306BB63DC024425A428A2CFEF.

**ClientSmoke=PASS_USER_CONFIRMED** — jawne potwierdzenie użytkownika w rozmowie. Nie jest to własna obserwacja narzędziowa Codexa.

Konta: managed A140 odpowiada wszystkim 65 pinom źródłowym; odebrane 121 testów domenowych i 153 modele granicy Windows PASS. Native A154: 9 pinów, build/961 testów polityki i protokół C++→PowerShell PASS. Boundary R4: 74 izolowane regresje PASS i historyczny TaskSecurityQA obejmujący wyłącznie zadanie Disabled, zero Run. Niezmienionych źródeł kont nie przebudowywano.

## Ograniczenia i NOT_RUN

NativeVerify R4 pod SYSTEM, live Fixture, operacje kont, rzeczywisty pipeline IIS WIP i browser Playwright: NOT_RUN. Nowy live smoke wow-ops, restore backupu i produkcyjny STOP nowego pełnego core: niewykonane. Windows reboot/PRESHUTDOWN oraz SCM recovery pozostają niepotwierdzone. Codex=PENDING_REAL_REBOOT; Collect-NaturalAutoHonor=NOT_RUN. Rozwiązany środowy AutoHonor pozostaje zamknięty. Brak push, publikacji i zmian PR.

## Błędy przygotowania — zachowane i rozliczone

Nieudane próby przygotowania patcha/parsera i finalizacji pozostają w lokalnej diagnostyce. Skorygowano ucięcie końcowej linii patcha, kolizję nazw zmiennych PowerShell, interpretację formatu spec zamiast TAP oraz odczyt pustego klucza package-lock w PS5.1. Siedmioplikowy patch został następnie rzeczywiście sprawdzony. Wszystkie buildy/testy aplikacyjne miały native0; błąd parsera podsumowania nie został przedstawiony jako błąd testu ani ukryty. Nie ponawiano poprawnych testów dla kosmetyki. Własne wygenerowane bin/obj i zależności pozostają poza paczką.