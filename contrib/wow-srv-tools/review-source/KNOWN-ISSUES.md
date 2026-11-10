# Braki i granice gotowości

1. CreateAccount/ResetPassword są WIP, CREATEACCOUNT_LIVE_READY=False, RESET_PASSWORD_LIVE_READY=False. Ostatnia niezaliczona bramka NativeVerify R3: REGISTER_NEW_DISABLED_TASK, STATUS_INVALID_OWNER. R4 przygotowuje poprawkę ownera BA; rzeczywisty NativeVerify R4 pod SYSTEM, Fixture oraz pipeline AppPool nadal niewykonane. Nie znosić wstrzymań.
2. Ops są źródłami związanymi z WOW-SRV i konkretnymi pinami/receiptem. Kopia jest kompletna do review, lecz nie jest gotowym przenośnym instalatorem. Nowy host wymaga osobnych kontraktów, testów, sekretów i zgód; guardy pozostają zachowane.
3. wow-ops: historyczny Step34 HTTP_SMOKE pozostaje niezaliczony; brakuje dowodów live, grantu do referencyjnych tabel DBC i art assets. Nowe testy offline nie zamykają tych pozycji. Nie utożsamiać wow-ops z IIS Control Center.
4. Zachowano istniejące licencje i autorstwo. Dla własnych samodzielnych komponentów bez deklaracji licencyjnej nie wymyślono nowej licencji. Przed publicznym udostępnieniem ustalić licencję i prawa; ta dostawa służy review.
5. Windows reboot/PRESHUTDOWN/SCM recovery oraz wznowienie Codexa po rzeczywistym reboocie nadal niepotwierdzone. Sam deployment i STOP starego/START nowego core nie dowodzą tych funkcji.
6. Restore backupu i produkcyjny STOP nowego pełnego core nie zostały wykonane. Wdrożenie i odbiór R3 pozostają PASS, ClientSmoke jest wynikiem zgłoszonym przez użytkownika.
7. SDK, binaria, node_modules, prywatne konfiguracje i aktywacje nie są dołączone. Oryginalne piny są referencją pochodzenia, a MANIFEST-SHA256 opisuje bajty nowej kopii po bezpiecznych zmianach szablonów.

Aktualne źródła wszystkich głównych komponentów znaleziono i dołączono. Nie ma ukrytego blokera MISSING_SOURCE. Wstępne dwie błędnie nazwane pozycje selektora rozwiązano do istniejącego testu i bridge; nie zastąpiono ich pustymi plikami.