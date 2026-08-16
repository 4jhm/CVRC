#if !WINDOWS
using System.Diagnostics;

namespace VRCNext.Services.Helpers;

public static class LinuxDesktopHelper
{
    private static bool IsWayland =>
        !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WAYLAND_DISPLAY"));

    private static string Desktop =>
        (Environment.GetEnvironmentVariable("XDG_CURRENT_DESKTOP") ?? "").ToLowerInvariant();

    public static bool CopyImageToClipboard(string path, out string? error)
    {
        error = null;
        var mime = Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif"            => "image/gif",
            ".webp"           => "image/webp",
            ".bmp"            => "image/bmp",
            _                 => "image/png",
        };

        if (IsWayland && TryPipeFile("wl-copy", new[] { "-t", mime }, path, out error))
            return true;
        if (TryRun("xclip", new[] { "-selection", "clipboard", "-t", mime, "-i", path }, out error))
            return true;
        error ??= "No clipboard tool found. Install wl-clipboard (Wayland) or xclip (X11).";
        return false;
    }

    public static bool SetWallpaper(string path, out string? error)
    {
        error = null;
        var uri = new Uri(path).AbsoluteUri;
        var d = Desktop;

        if (d.Contains("kde"))
        {
            if (TryRun("plasma-apply-wallpaperimage", new[] { path }, out error))
                return true;
            var script =
                "var allDesktops = desktops();" +
                "for (i = 0; i < allDesktops.length; i++) {" +
                "  d = allDesktops[i];" +
                "  d.wallpaperPlugin = 'org.kde.image';" +
                "  d.currentConfigGroup = Array('Wallpaper', 'org.kde.image', 'General');" +
                "  d.writeConfig('Image', '" + uri.Replace("'", "%27") + "');" +
                "}";
            foreach (var qdbus in new[] { "qdbus6", "qdbus", "qdbus-qt5" })
                if (TryRun(qdbus, new[] { "org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell.evaluateScript", script }, out error))
                    return true;
        }

        if (d.Contains("gnome") || d.Contains("unity") || d.Contains("budgie") || d.Contains("pantheon"))
        {
            var ok = TryRun("gsettings", new[] { "set", "org.gnome.desktop.background", "picture-uri", uri }, out error);
            TryRun("gsettings", new[] { "set", "org.gnome.desktop.background", "picture-uri-dark", uri }, out _);
            if (ok) return true;
        }

        if (d.Contains("cinnamon") &&
            TryRun("gsettings", new[] { "set", "org.cinnamon.desktop.background", "picture-uri", uri }, out error))
            return true;

        if (d.Contains("mate") &&
            TryRun("gsettings", new[] { "set", "org.mate.background", "picture-filename", path }, out error))
            return true;

        if (d.Contains("xfce"))
        {
            var props = RunCapture("xfconf-query", new[] { "-c", "xfce4-desktop", "-l" });
            bool any = false;
            foreach (var prop in (props ?? "").Split('\n'))
            {
                var p = prop.Trim();
                if (p.EndsWith("last-image") || p.EndsWith("image-path"))
                    if (TryRun("xfconf-query", new[] { "-c", "xfce4-desktop", "-p", p, "-s", path }, out _))
                        any = true;
            }
            if (any) return true;
        }

        if (TryRun("gsettings", new[] { "set", "org.gnome.desktop.background", "picture-uri", uri }, out error))
        {
            TryRun("gsettings", new[] { "set", "org.gnome.desktop.background", "picture-uri-dark", uri }, out _);
            return true;
        }

        error ??= $"Could not set wallpaper on this desktop environment ({Desktop}).";
        return false;
    }

    public static bool RevealInFileManager(string path)
    {
        var uri = new Uri(path).AbsoluteUri;
        if (TryRun("dbus-send", new[]
            {
                "--session", "--print-reply",
                "--dest=org.freedesktop.FileManager1",
                "/org/freedesktop/FileManager1",
                "org.freedesktop.FileManager1.ShowItems",
                $"array:string:{uri}", "string:",
            }, out _))
            return true;

        var dir = Path.GetDirectoryName(path);
        if (string.IsNullOrEmpty(dir)) return false;
        return TryRun("xdg-open", new[] { dir }, out _, waitForExit: false);
    }

    private static bool TryRun(string file, string[] args, out string? error, bool waitForExit = true, int timeoutMs = 15000)
    {
        error = null;
        try
        {
            var psi = new ProcessStartInfo(file)
            {
                UseShellExecute = false,
                RedirectStandardError = true,
                RedirectStandardOutput = true,
            };
            foreach (var a in args) psi.ArgumentList.Add(a);
            using var proc = Process.Start(psi);
            if (proc == null) { error = $"{file} could not be started"; return false; }
            if (!waitForExit) return true;
            if (!proc.WaitForExit(timeoutMs)) { try { proc.Kill(); } catch { } error = $"{file} timed out"; return false; }
            if (proc.ExitCode != 0)
            {
                var err = proc.StandardError.ReadToEnd().Trim();
                error = err.Length > 0 ? err : $"{file} exited with code {proc.ExitCode}";
                return false;
            }
            return true;
        }
        catch (Exception ex) { error = ex.Message; return false; }
    }

    private static string? RunCapture(string file, string[] args, int timeoutMs = 10000)
    {
        try
        {
            var psi = new ProcessStartInfo(file)
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            foreach (var a in args) psi.ArgumentList.Add(a);
            using var proc = Process.Start(psi);
            if (proc == null) return null;
            var output = proc.StandardOutput.ReadToEnd();
            if (!proc.WaitForExit(timeoutMs)) { try { proc.Kill(); } catch { } return null; }
            return proc.ExitCode == 0 ? output : null;
        }
        catch { return null; }
    }

    private static bool TryPipeFile(string file, string[] args, string inputPath, out string? error)
    {
        try
        {
            using var fs = File.OpenRead(inputPath);
            return TryPipeStream(file, args, fs, out error);
        }
        catch (Exception ex) { error = ex.Message; return false; }
    }

    private static bool TryPipeStream(string file, string[] args, Stream input, out string? error)
    {
        error = null;
        try
        {
            var psi = new ProcessStartInfo(file)
            {
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardError = true,
            };
            foreach (var a in args) psi.ArgumentList.Add(a);
            using var proc = Process.Start(psi);
            if (proc == null) { error = $"{file} could not be started"; return false; }
            input.CopyTo(proc.StandardInput.BaseStream);
            proc.StandardInput.Close();
            if (!proc.WaitForExit(15000)) { try { proc.Kill(); } catch { } error = $"{file} timed out"; return false; }
            if (proc.ExitCode != 0)
            {
                var err = proc.StandardError.ReadToEnd().Trim();
                error = err.Length > 0 ? err : $"{file} exited with code {proc.ExitCode}";
                return false;
            }
            return true;
        }
        catch (Exception ex) { error = ex.Message; return false; }
    }
}
#endif
