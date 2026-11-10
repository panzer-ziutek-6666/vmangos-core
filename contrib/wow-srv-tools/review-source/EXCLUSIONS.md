# Wyłączenia z dostawy

- Core C++ i testy: 15 plików produkcyjnych oraz 7 testowych już w PR #18, commit bb71dfc8c5b7e19664d8633801e362aa234aa51c. Obejmuje SQL/workery/shutdown i wynik usługi, cztery poprawki loggerów oraz F1 w Player z zachowaniem obu zmian kolegi. Źródła nie są tu duplikowane. Lista w validation/PR18-SCOPE.tsv.
- Migracje world20261025125310 i characters20261025125408 są kodem kolegi. Podano referencje, hashe i zaakceptowane dowody skutków, bez publikowania danych i preimages.
- contrib/admin-panel.zip jest historycznym artefaktem; zastępują go w dostawie 13 rzeczywistych plików referencyjnych. Nie jest źródłem aktualnego panelu IIS.
- Prywatne konfiguracje, credentials/SourceDefaults, DPAPI/soap.bin, aktywne approvals/capabilities/receipts, claims, journale, state/pointers, dane graczy, dumpy, backupy i surowe logi nie są dołączone. Publiczne szablony pozostają nieoperacyjne, Approved=false. Niesekretna ścieżka do sekretu w źródle/polityce nie jest eksportem sekretu.
- EXE/DLL/PDB/apphost, bin/obj/node_modules/.git, cache i build outputs pozostają poza ZIP. Zależności są przypięte, ale nie dołączane jako binaria. Istniejące licencje są zachowane.
- Znany upstream test db-accounts.test.js mutujący żywą DB jest pominięty. Pozostałe historyczne testy upstream służą przeglądowi; nie wykonywać ich hurtem. Domyślne npm test w nowej kopii obejmuje tylko trzy jawne testy adaptacji.
- Historyczne FIX1–FIX4 i dawne paczki nie są kopiowane w całości. Pochodzenie rozlicza inwentarz. FIX5 stanowi aktualną wymaganą bazę zależności DEV; R2/R3 są aktualnymi warstwami produkcyjnymi. Nieaktywny staging v1 oraz historyczne FAIL/recovery pozostają na hoście.

LOCAL-CHANGE-INVENTORY.tsv przypisuje każdy rozliczany element do jednej z sześciu żądanych klas. Zmiany dokumentacji i publicznych konfiguracji dotyczą wyłącznie nowej kopii. Oryginalne checkouty oraz ich lokalne zmiany są zachowane.