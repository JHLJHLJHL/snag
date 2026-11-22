param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]] $ExecutablePaths
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SnagShellIcons {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    public static extern void SHChangeNotify(int eventId, uint flags, string path, IntPtr second);
}
'@

# Invalidate cached executable icons after replacing a build at the same path.
[SnagShellIcons]::SHChangeNotify(0x08000000, 0x1000, $null, [IntPtr]::Zero)
foreach ($executable in $ExecutablePaths) {
    $resolved = (Resolve-Path -LiteralPath $executable).ProviderPath
    [SnagShellIcons]::SHChangeNotify(0x2000, 0x1005, $resolved, [IntPtr]::Zero)
}
