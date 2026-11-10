# Profil następnej koniecznej kompilacji — WOW-SRV, 2026-11-09 23:32 CET

Profil przygotowany poza przypiętym R2. Nie uruchamiać ponownie zaakceptowanego kandydata dla samego strojenia. Nowy build dopiero po rzeczywistej zmianie źródeł/zależności lub nowym błędzie. Zachować źródła, CMakeCache, pełny configure command i piny narzędzi przyszłego etapu. Poniższy katalog musi należeć do nowej izolacji i mieć poprawny, wcześniej zweryfikowany configure; polecenie nie konfiguruje projektu samodzielnie.

Dokładne polecenie PS5.1 dla tego przyszłego, skonfigurowanego drzewa:

```powershell
& 'C:\Program Files\CMake\bin\cmake.exe' --build 'C:\Scripts\WOW-NEXT-CORE-BUILD-12\build' --config Release --target mangosd realmd --parallel 1 -- /m:1 /p:CL_MPCount=12 /p:PreferredToolArchitecture=x64 /p:UseMultiToolTask=false /nodeReuse:false /v:normal '/bl:C:\GRY\wow\diagnostics\NEXT-NECESSARY-CORE-BUILD\build.binlog'
$buildNativeExit = $LASTEXITCODE
```

Katalog logów należy utworzyć jako nowy katalog etapu przed wywołaniem. To dokument polecenia, nie uruchomiony build. Zachować stdout/stderr oraz native exit procesu przed Dispose. Timeout nadzoru nie uruchamia drugiego buildu. Brak native exit to UNKNOWN.

Graf istniejącego kandydata: playerbots438, game243, scripts218 zadeklarowanych jednostek translacji; scripts zależy od game. PCH i link mają odcinki sekwencyjne. Wariant3×4 ogranicza duży pojedynczy gotowy projekt do4 prac, gdy nie ma3 niezależnych ciężkich projektów. Wariant1×12 daje do12 prac także w game/playerbots/scripts, a wspólny limit pozostaje12. Krótki odcinek PCH/link nie musi używać wszystkichCPU. Nie pomnożyć tego przez dodatkowe /m lub równoległy drugi build.

CMake dodaje /MP w cmake/compiler/msvc/settings.cmake:91. Generator VS zamienia je na metadane ClCompile.MultiProcessorCompilation=true. Microsoft.Cl.Common.props przenosi CL_MPCount do ClCompile.ProcessorNumber, a Microsoft.CppCommon.targets przekazuje oba do zadaniaCL. Nie wystarcza samo /p:MultiProcessorCompilation=true: jest to właściwość globalna, a kompilator korzysta z metadanych elementu. Globalne CL_MPCount=12 nadpisuje istniejące wygenerowane Globals CL_MPCount=2.

Rzeczywisty test dwóch12-TU projektów: CMake /MP + globalne MultiProcessorCompilation=false dały /MP12, native0 i13 równoczesnych cl.exe:1koordynator+12workerów. Bez CMake /MP, globalne MultiProcessorCompilation=true i CL_MPCount12 nie dały /MP; native0, jedencl.exe. Surowe polecenia, tożsamości i procesy w dowodach. Niezależna pierwsza próba syntetyczna miała C1202/native1; zachowana, przyczyna: zbyt głęboki szablon testowy. Nowa próba zmieniła tylko syntetyczny test, nie core.

Przed następnym buildem sprawdzić rzeczywiste poleceniaCL: /MP12, brak późniejszego nieograniczonego /MP ani równoległych wywołań. Budżet12 oznacza12 prac kompilujących; koordynator nie kompiluje trzynastej jednostki. Na tym hoście6rdzeni/12LP, około31.3GiBRAM, dostępne w pomiarze15.5GiB. Peak pamięci ciężkiej TU core nie był teraz mierzony. Profil to uzasadniony punkt startu, nie dowód szybkości całego core.

Przy kolejnym koniecznym buildzie mierzyć co1s CPU12LP/cały host i drzewo procesu, pamięć cl/link/MSBuild, Available/Committed RAM, paging, IO, elapsed, pełny proces/natywne wyniki i liczbę jednoczesnych workerów. Zmniejszenie budżetu uzasadnić trwałą presją pamięci (np.Available<4GiB przez30s i wzrost odczytów stron) lub pomiarem czasu. Nie mylić krótkich Pages/sec z samym wyczerpaniemRAM. Nie zmniejszać limitu tylko dlatego, że link/PCH lub niewielki projekt używa mniejCPU.