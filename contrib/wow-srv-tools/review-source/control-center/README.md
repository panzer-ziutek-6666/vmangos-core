> NOTA HANDOFF: poniżej zachowana dokumentacja historyczna. Kod zawiera trzy fixed akcje POST; nie jest w całości read-only. Aktualny zakres i pochodzenie opisuje HANDOFF.md. Ta kopia nie jest instalatorem ani zgodą na uruchomienie.

# VMaNGOS Admin Panel

Local IIS-hosted administration panel for the VMaNGOS server on `WOW-SRV`.

Current implementation stage: **read-only backend source scaffold**.

## Runtime architecture

```text
LAN browser
  -> IIS / Windows Authentication
  -> ASP.NET Core
  -> fixed read-only status providers
```

The current backend does **not**:
- execute PowerShell;
- call VMaNGOS SOAP;
- change Windows services;
- mutate databases;
- expose arbitrary command execution.

## Current endpoints

```text
GET /api/status
GET /api/identity
```

`/api/status` reads only:
- allowlisted Windows service state/PID through the Windows Service Control Manager API;
- TCP listener state through .NET network APIs;
- SOAP exposure state for port 7878;
- system uptime.

## Source

```text
src/Vmangos.AdminPanel/
```

Target framework: `net10.0`.

## Runtime deployment

Repository source and runtime deployment are intentionally separate.

Repository:

```text
C:\GRY\wow\dev\vmangos-core\contrib\admin-panel
```

Runtime:

```text
C:\GRY\wow\admin-panel
```

Do not build directly into the IIS runtime directory.

## Planned later phases

- build/test/publish;
- deployment behind the existing `VMANGOS-AdminPanel` IIS site;
- `server info` and player/bot data through a controlled local backend;
- whitelisted service control operations;
- whitelisted account / GM / announce operations.

No generic `/exec`, `/powershell`, `/run-command`, or unrestricted SOAP endpoint is permitted.