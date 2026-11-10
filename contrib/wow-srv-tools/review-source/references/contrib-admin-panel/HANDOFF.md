# Referencja contrib — osobny, historyczny komponent

Pochodzenie:13nieśledzonych plików z `vmangos-core/contrib/admin-panel` zachowanych bez commitowania/clean/reset. Archiwum `contrib/admin-panel.zip`, SHA256 8788BD62FE368BF520DD0D8C477CF0ACAD2AE644FB282A20B5D5E6B88F4C00A7, pozostaje na hoście i nie stanowi źródła obecnego IIS. Samodzielny config w nowej kopii ma bezpieczne placeholdery; reszta kodu referencji pozostaje identyczna.

Rozbieżność: dawne README/ARCHITECTURE opisują etap read-only, lecz Program.cs i TaskControlService implementują trzy fixed POST uruchamiające schtasks. To nie dowód, że są obecnie wyłączone lub że cała aplikacja jest RO. Nie usunięto kodu ani historycznych opisów; ta nota koryguje interpretację. Aktualny IIS ma inną, późniejszą ścieżkę źródłową i reader telemetrii — patrz control-center/HANDOFF.md.

Dołączono oryginalną licencję nadrzędnego repo jako referencję pochodzenia; nie dopisano nowej licencji ani autorstwa nieobecnego w źródłach. Przed publikacją ustalić licencjonowanie naszego samodzielnego panelu. Ta dostawa jest do review, nie nową deklaracją licencji.