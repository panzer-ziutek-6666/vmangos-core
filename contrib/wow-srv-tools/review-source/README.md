# WOW Server WIN/LINUX — źródła poza core PR #18

Status: **SOURCE_REVIEW_READY_WITH_EXPLICIT_WIP**. To materiały do przeglądu, nie instalator ani zgoda wykonawcza. Oryginalne checkouty, produkcja i PR pozostają zachowane.

Czytaj kolejno: `COMPONENTS.tsv`, `VALIDATION.md`, `KNOWN-ISSUES.md`, `EXCLUSIONS.md`, pliki `HANDOFF.md` komponentów, następnie `LOCAL-CHANGE-INVENTORY.tsv`. `MANIFEST-SHA256.tsv` zawiera hashe finalnych plików, poza samym manifestem. Inwentarz rozróżnia oryginalny hash i hash kopii po zmianie publicznych szablonów lub dokumentacji.

| Katalog | Zawartość i status |
|---|---|
| control-center/ | Aktualne źródła panelu IIS, frontend, telemetria i trzy akcje sterowania; aktywny publish powiązany ze źródłami. |
| references/contrib-admin-panel/ | 13 nieśledzonych plików referencyjnych, odrębnych od aktualnego IIS. Historyczny ZIP nie jest źródłem aplikacji. |
| windows-ops/ | Kontroler i Maintenance z produkcyjnego R2/FIX5, routing, zadania, collector/registry, backup/deploy/rollback/DEV, generator preimages R2, verifier R3 i profil przyszłego buildu 1×12. |
| wow-ops/ | Odrębna adaptacja read-only: źródła upstream, siedmioplikowy patch, testy, baza i licencja MIT. |
| accounts-wip/ | Formularz/backend/worker/IPC/launcher A140, native bootstrap A154 i boundary R4. Kandydat niedokończony, bez gotowości live. |
| validation/ | Sprawdzone podsumowania istniejących dowodów i nowej walidacji offline; bez surowej diagnostyki. |

Wymagania źródeł: Windows PowerShell 5.1 Desktop x64 dla skryptów hostowych; SDK .NET 10.0.401 i ASP.NET/.NET 10.0.12 dla managed; Node 24.21.0 oraz zależności przypięte przez package-lock dla wow-ops. Narzędzia, binaria i node_modules nie są dołączone. C++ core i bootstrapu nie przebudowywano. Profil następnej koniecznej kompilacji: jeden węzeł MSBuild, do 12 prac CL łącznie, z pomiarem RAM i paging.

Ta kopia ma bezpieczne, nieoperacyjne szablony konfiguracji. Nie uruchamiaj hurtowo PS1, workerów, NativeVerify, Fixture ani historycznych testów wymagających SQL/SOAP/IIS/SYSTEM. W kopii wow-ops domyślne testy ograniczono do trzech jawnych testów adaptacji; nie oznacza to zgody na npm start lub pełny legacy suite.

Przeniesienie na inny host wymaga osobnego projektu wiązań: host guard, ścieżki, usługi/porty, konta/SID, Windows Auth/TLS, Task Scheduler/SDDL, DPAPI, seal bootstrapu, manifesty, release/capability/bundle i źródła baz. Nie usuwać guardów dla uruchomienia kopii. Historyczne piny operacyjne opisują pochodzenie; ta paczka nie jest nową aktywacją. Szczegóły w `windows-ops/PORTABILITY.md`.

Core jest już w PR #18 na commicie bb71dfc8c5b7e19664d8633801e362aa234aa51c. Nie duplikujemy jego źródeł. Publikacja, push i wysłanie tej paczki koledze wymagają osobnego kroku po odbiorze.