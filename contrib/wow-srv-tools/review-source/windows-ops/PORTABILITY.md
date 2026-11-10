# Przenośność i wiązania hosta

To źródła do review. Zachowano ścisłe guardy i istniejące nazwy. Kopia nie jest nową przypiętą paczką wykonawczą.

| Warstwa | Ogólna logika | Wymaga projektu wiązań dla innego hosta |
|---|---|---|
| Sequencer / process capture | Kolejność zależności, ograniczony wait, pomiar przed Dispose, jawne UNKNOWN, brak retry niepotwierdzonych zapisów | Usługi, ścieżki EXE, generacje i porty; realne granice SCM/CIM |
| Maintenance i task control | Blokada operacji, własna bariera, dokładny powrót Enabled, odrębna intencja ręcznego STOP i planowanego rebootu | SYSTEM/AppPool/SID/SDDL, akcje i XML zadań, magazyny stanu |
| Release / collector | Transakcja release, manifesty i dwie naturalne zdrowe próbki | Registry root, publiczne piny kodu/polityki, DPAPI path i prywatne sekrety provisionowane osobno |
| Backup / migration / DEV | Logic dump, endpoint guard, preimages, pełne PK i all-column/set proof, brak automatycznego restore | Źródłowy UUID/datadir, nazwy baz, schema i konta z minimalnymi prawami, izolowane usługi/porty DEV |
| Weryfikacja R3 | Stała granica czasu i 180 s, rygor integralności i generacji | Dokładny receipt i PROCESS_RECORD operacji; nie akceptować dowolnego starego planu |
| Build | Łączny budżet do 12 prac, pomiar RAM/paging i faktycznych parametrów kompilatora | Toolchain, pamięć hosta, przypięte zależności i osobny output |

`deployment/r2` zawiera bieżący kontroler produkcyjny oraz generator preimages. `dev/full-candidate` ma komplet bezpośrednich modułów i kontynuację DEV; `dev/fix5` jest jego historycznie przypiętą bazą, nie alternatywnym aktywnym kontrolerem. `verification/r3` jest aktualnym odbiorem, oryginalny verifier R2 zachowuje swój FAIL.

Przed przyszłym uruchomieniem poza WOW-SRV: opracować nowe manifesty/seal, odtworzyć minimalne prywatne wejścia poza dostawą, wykonać testy izolowane, zatwierdzić oddzielnie instalację i aktywację. Nie przepisywać pinów lub usuwać host guardów jedynie w celu uzyskania PASS. Bezpośredni shutdown Windows/PRESHUTDOWN i SCM recovery nadal są odrębnymi niepotwierdzonymi zakresami.