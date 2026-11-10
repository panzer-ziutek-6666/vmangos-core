# Zmiany i pochodzenie

- A129 (2026-10-16): eksport źródeł panelu A73/A71 i wcześniejszego bridge. Baza historyczna, później uzupełniona.
- A140/A139-R5: formularz, backend, worker, IPC i modele Windows kont. Nie aktywowano ich w IIS.
- A154: native bootstrap/policy i korekta OWNER_RIGHTS READ_CONTROL; build, 961 testów i protokół PASS, bez dowodu gotowości live.
- 2026-10-25: późniejsza poprawka TelemetryContract akceptująca rewizje 20/40 hex. Aktywny IIS odpowiada temu publish. Collector R4-R2 obsługuje manifesty release, integralność i generacje.
- Boundary R4: owner BA po historycznym NativeVerify FAIL; 74 regresje i QA security, bez wykonania NativeVerify pod SYSTEM.
- FIX5: pomiar wyników zachowanych uchwytów przed Dispose, następnie świeże SCM/CIM; kontrakt STOP, bariery/rollback, ścisłe Enabled zadań i porównanie XML bez wyłącznie elementu Enabled.
- Full production R2: CREATE DATABASE oraz jawne USE w tym samym programie mysql.exe, pełne klucze i dowody wszystkich kolumn/zbiorów. Odebrane wdrożenie pełnego kandydata.
- Verifier R3: stała granica oczekiwania i budżet 180 s; starsze/duplikaty nie zaliczają się. Dwie naturalne zdrowe próbki, ścisłe release/SHA/generacja/czas/integralność. Odbiór PASS/native0, ClientSmoke=PASS_USER_CONFIRMED.
- Profil przyszłego buildu 1×12: MSBuild jeden węzeł, do 12 prac CL łącznie; pomiar parametrów /MP12 i workerów. Nie przebudowano zaakceptowanego core dla samego profilu.
- Nowa kopia handoff: bezpieczne placeholdery konfiguracji, całkowicie syntetyczny fixture telemetrii i poprawiona etykieta testu, bezpieczna domyślna lista npm test oraz wyjaśnienia dokumentacji read-only kontra trzy POST. Zmiany są wykazane osobno od oryginalnych hashy. Oryginały pozostają zachowane.