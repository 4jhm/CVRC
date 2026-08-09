using System.Security.Cryptography;
using System.Text;

namespace VRCNext.Services.Helpers;

public static class AutoStartShortcutHelper
{
    private static readonly string Root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "VRCNext", "AutoStart");

    public static string CategoryDir(bool vr) => Path.Combine(Root, vr ? "VR" : "Desktop");

    public static string ShortcutPathFor(string exePath, bool vr)
    {
        var name = Path.GetFileNameWithoutExtension(exePath) ?? "";
        var safe = new string(name.Where(c => !Path.GetInvalidFileNameChars().Contains(c)).ToArray());
        if (string.IsNullOrEmpty(safe)) safe = "app";
        return Path.Combine(CategoryDir(vr), $"{safe}-{ShortHash(exePath)}.lnk");
    }

    public static string EnsureShortcut(string exePath, bool vr)
    {
        if (!OperatingSystem.IsWindows()) return "";
        try
        {
            if (string.IsNullOrWhiteSpace(exePath)) return "";
            if (!exePath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) return "";
            Directory.CreateDirectory(CategoryDir(vr));
            var lnk = ShortcutPathFor(exePath, vr);
            if (File.Exists(lnk) &&
                string.Equals(ResolveTarget(lnk), exePath, StringComparison.OrdinalIgnoreCase))
                return lnk;
            CreateShortcut(lnk, exePath);
            return File.Exists(lnk) ? lnk : "";
        }
        catch { return ""; }
    }

    public static void Sync(IEnumerable<string>? exePaths, bool vr)
    {
        if (!OperatingSystem.IsWindows()) return;
        try
        {
            var dir = CategoryDir(vr);
            Directory.CreateDirectory(dir);

            var keep = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var raw in exePaths ?? Enumerable.Empty<string>())
            {
                var exe = (raw ?? "").Trim().Trim('"');
                if (string.IsNullOrEmpty(exe) || !exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) continue;
                var lnk = EnsureShortcut(exe, vr);
                if (!string.IsNullOrEmpty(lnk)) keep.Add(Path.GetFileName(lnk));
            }

            foreach (var file in Directory.EnumerateFiles(dir, "*.lnk"))
                if (!keep.Contains(Path.GetFileName(file)))
                    try { File.Delete(file); } catch { }
        }
        catch { }
    }

    private static void CreateShortcut(string lnkPath, string targetExe)
    {
        var t = Type.GetTypeFromProgID("WScript.Shell");
        if (t == null) return;
        dynamic? shell = Activator.CreateInstance(t);
        if (shell == null) return;
        try
        {
            dynamic sc = shell.CreateShortcut(lnkPath);
            sc.TargetPath = targetExe;
            sc.WorkingDirectory = Path.GetDirectoryName(targetExe) ?? "";
            sc.Save();
            try { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(sc); } catch { }
        }
        finally { try { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); } catch { } }
    }

    private static string ResolveTarget(string lnkPath)
    {
        try
        {
            var t = Type.GetTypeFromProgID("WScript.Shell");
            if (t == null) return "";
            dynamic? shell = Activator.CreateInstance(t);
            if (shell == null) return "";
            dynamic sc = shell.CreateShortcut(lnkPath);
            string target = sc.TargetPath as string ?? "";
            try { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(sc); } catch { }
            try { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); } catch { }
            return target;
        }
        catch { return ""; }
    }

    private static string ShortHash(string s)
    {
        var bytes = SHA1.HashData(Encoding.UTF8.GetBytes((s ?? "").ToLowerInvariant()));
        return Convert.ToHexString(bytes, 0, 4).ToLowerInvariant();
    }
}
