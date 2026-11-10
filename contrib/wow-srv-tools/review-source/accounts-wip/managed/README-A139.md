# A139 — osobny kandydat lokalizacji fixture

Ten kandydat wywodzi się z przypiętych 83 plików A136 (419945 B, archiwum SHA256 97449003E35D44BCC1C30FF1768E2AD901379280B28D70CEAD1D1697F1F449FE). Zachowuje bazowe 30 plików A130 byte-exact, DisabledAccountGateway i wszystkie 15 luk live. Nie zawiera adaptera tworzącego konta ani resetującego hasła.

Aktualny kontrakt spec to `A139-FIXTURE-1`, z jedynym dozwolonym rootem `C:\VMANGOS-Accounts-Fixture-A139-<32 małe cyfry hex generacji>`. Starsze rooty pod dev i spec A135 są odrzucane. Historyczne README, docs i evidence A132/A136 pozostają dowodami tamtych rewizji; bieżącą zmianę opisuje `docs/WINDOWS-LOCATION-A139.md` i provenance A139.

PS1 A139 zapisuje wyłącznie nowy prywatny katalog źródeł pod dev, własny log, manifest i receipt. Nie tworzy wskazanego finalnego rootu ani pakietu i nie wykonuje tego kodu na WOW-SRV. Po pełnym logu PASS osobny A140 wykona Windows Release/build/model tests. Poprzednie DLL A137 nie obsługują nowego kontraktu i nie mogą być użyte do pakietu A139.

Linux build i modele są ograniczonym QA. Natywne ACL, tożsamości SYSTEM/AppPool, bootstrap pre-Main, pipe, desktop, Job i pipeline IIS nadal wymagają osobnych dowodów. Nie uruchamiać fixture na podstawie samego source/build PASS.
