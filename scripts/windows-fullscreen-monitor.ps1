Add-Type -AssemblyName System.Windows.Forms

$source = @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class CompanionFullscreenCheck {
  [StructLayout(LayoutKind.Sequential)]
  private struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

  public static bool IsFullscreen() {
    IntPtr hwnd = GetForegroundWindow();
    RECT rect;
    if (hwnd == IntPtr.Zero || !GetWindowRect(hwnd, out rect)) return false;
    foreach (Screen screen in Screen.AllScreens) {
      var bounds = screen.Bounds;
      if (rect.Left <= bounds.Left + 1 && rect.Top <= bounds.Top + 1 &&
          rect.Right >= bounds.Right - 1 && rect.Bottom >= bounds.Bottom - 1) return true;
    }
    return false;
  }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms
$previous = $null
while ($true) {
  $state = if ([CompanionFullscreenCheck]::IsFullscreen()) { 'fullscreen' } else { 'normal' }
  if ($state -ne $previous) {
    [Console]::Out.WriteLine($state)
    [Console]::Out.Flush()
    $previous = $state
  }
  Start-Sleep -Milliseconds 1000
}
