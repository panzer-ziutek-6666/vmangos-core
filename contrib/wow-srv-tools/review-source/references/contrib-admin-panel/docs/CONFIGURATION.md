# Configuration

Current Phase 3 source requires no secrets.

Runtime constants are intentionally fixed to the WOW-SRV deployment model:
- VMaNGOS service names: `VMANGOS-MySQL`, `realmd`, `mangosd`;
- ports: 3306, 3724, 8085, 7878.

Future SOAP credentials must not be committed to Git and must not be placed under `wwwroot`.