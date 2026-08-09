using System.Text;
using System.Text.RegularExpressions;

namespace VRCNext.Services.Helpers;

public static class VrcCacheScanner
{
    private const int HeadBytes = 131072;

    private static readonly Regex RxAvatarId = new(
        @"avtr_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
        RegexOptions.Compiled);

    public static string CacheDir()
    {
        return Path.Combine(VrcPathsHelper.AppDataDir(), "Cache-WindowsPlayer");
    }

    public static int Scan(HashSet<string> scannedFiles, Action<string> onAvatarId, CancellationToken ct = default)
    {
        var dir = CacheDir();
        if (!Directory.Exists(dir)) return 0;

        IEnumerable<string> files;
        try { files = Directory.EnumerateFiles(dir, "__data", SearchOption.AllDirectories); }
        catch { return 0; }

        var buffer = new byte[HeadBytes];
        int scanned = 0;

        foreach (var file in files)
        {
            if (ct.IsCancellationRequested) break;
            lock (scannedFiles) { if (!scannedFiles.Add(file)) continue; }
            scanned++;
            try
            {
                using var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                int read = fs.Read(buffer, 0, buffer.Length);
                if (read <= 0) continue;
                var text = Encoding.Latin1.GetString(buffer, 0, read);
                if (!text.Contains("avtr_")) continue;
                foreach (Match m in RxAvatarId.Matches(text))
                    onAvatarId(m.Value);
            }
            catch { }
        }
        return scanned;
    }
}
