# Architecture

## Trust boundaries

The browser authenticates through IIS Windows Authentication.

The ASP.NET Core application runs under the existing IIS Application Pool identity and initially exposes read-only status only.

The read-only backend uses:
- Windows SCM query APIs for the fixed service names `VMANGOS-MySQL`, `realmd`, and `mangosd`;
- .NET TCP listener inspection for ports 3306, 3724, 8085, and 7878.

It intentionally does not invoke PowerShell or `VMANGOS-Control.ps1` in Phase 3.

## Later control layer

Mutating operations must use a separate allowlisted control boundary. The web application must never accept:
- arbitrary executable paths;
- arbitrary PowerShell;
- arbitrary shell command lines;
- unrestricted VMaNGOS SOAP commands.

SOAP remains bound to `127.0.0.1:7878`.