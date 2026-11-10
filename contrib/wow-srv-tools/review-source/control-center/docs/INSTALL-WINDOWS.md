# Windows / IIS prerequisites

Expected host: `WOW-SRV`.

Required baseline:
- Windows Server 2022;
- IIS installed;
- Windows Authentication enabled for site `VMANGOS-AdminPanel`;
- Anonymous Authentication disabled;
- .NET 10 Hosting Bundle installed;
- ASP.NET Core Module v2 installed;
- .NET 10 SDK installed for local builds.

Existing IIS runtime path:

```text
C:\GRY\wow\admin-panel
```

Build and publish must use a fresh staging directory. Deployment is a separate controlled stage.