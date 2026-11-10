using System.Runtime.Versioning;
using Microsoft.Win32.SafeHandles;

namespace Vmangos.Accounts.Windows;

[SupportedOSPlatform("windows")]
internal sealed class FixtureDirectoryLease : IDisposable
{
    private readonly List<SafeFileHandle> _held = [];
    internal FixtureDirectoryLease(string root)
    {
        try
        {
            DirectoryInfo? current = new(root);
            while (current is not null)
            {
                BoundaryLimits.Check(current.Exists && (current.Attributes & FileAttributes.ReparsePoint) == 0, BoundaryError.InvalidPath);
                var handle = NativeMethods.OpenFile(current.FullName, NativeMethods.ReadControl, 3, IntPtr.Zero, 3,
                    NativeMethods.BackupSemantics | NativeMethods.OpenReparse, IntPtr.Zero);
                _held.Add(handle);
                BoundaryLimits.Check(!handle.IsInvalid && ProtectedFiles.FinalPath(handle).Equals(current.FullName, StringComparison.OrdinalIgnoreCase), BoundaryError.InvalidPath);
                // Parent add-file/add-directory rights cannot replace an already
                // held child. Delete-child/owner/DACL rights remain forbidden.
                RuntimeLease.AssertRuntimeDescriptor(PipeAccessPolicy.ReadDescriptor(handle).GetBinaryFormBytes(), false);
                current = current.Parent;
            }
        }
        catch { Dispose(); throw; }
    }
    public void Dispose() { foreach (var handle in _held) handle.Dispose(); _held.Clear(); }
}
