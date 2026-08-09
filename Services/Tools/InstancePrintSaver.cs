using Newtonsoft.Json.Linq;
using VRCNext.Services.Helpers;

namespace VRCNext.Services.Tools;

public class InstancePrintSaver
{
    private const int MaxRecentIds = 100;
    private static readonly TimeSpan SaveInterval = TimeSpan.FromMilliseconds(2500);

    private readonly CoreLibrary _core;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Queue<string> _recent = new();
    private readonly object _lock = new();

    public InstancePrintSaver(CoreLibrary core) => _core = core;

    public string ResolveFolder()
    {
        var custom = (_core.Settings.InstancePrintsPath ?? "").Trim();
        if (custom.Length > 0) return VrcPathsHelper.TranslateGamePath(custom);
        return Path.Combine(VrcPathsHelper.PhotoDir(), "Prints");
    }

    public void OnPrintSeen(string printId)
    {
        if (!_core.Settings.SaveInstancePrints) return;
        if (string.IsNullOrWhiteSpace(printId)) return;
        if (AlreadySeen(printId)) return;
        _ = Task.Run(() => SaveAsync(printId));
    }

    private bool AlreadySeen(string printId)
    {
        lock (_lock)
        {
            if (_recent.Contains(printId)) return true;
            _recent.Enqueue(printId);
            while (_recent.Count > MaxRecentIds) _recent.Dequeue();
            return false;
        }
    }

    private async Task SaveAsync(string printId)
    {
        await _gate.WaitAsync();
        try
        {
            await Task.Delay(SaveInterval);
            if (!_core.Settings.SaveInstancePrints) return;
            if (!_core.VrcApi.IsLoggedIn) return;

            var resp = await _core.VrcApi._http.GetAsync($"{VRChatApiService.BASE}/prints/{printId}");
            if (!resp.IsSuccessStatusCode) return;
            var body = await resp.Content.ReadAsStringAsync();
            var print = JObject.Parse(body);

            var imageUrl = print["files"]?["image"]?.ToString() ?? "";
            if (imageUrl.Length == 0) return;

            var createdRaw = print["createdAt"]?.ToString() ?? print["timestamp"]?.ToString() ?? "";
            var created = DateTime.TryParse(createdRaw, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.RoundtripKind, out var dt) ? dt.ToLocalTime() : DateTime.Now;

            var author = Sanitize(print["authorName"]?.ToString() ?? "Unknown");
            var folder = Path.Combine(ResolveFolder(), created.ToString("yyyy-MM"));
            Directory.CreateDirectory(folder);

            var fileName = $"{author}_{created:yyyy-MM-dd_HH-mm-ss.fff}_{printId}.png";
            var target = Path.Combine(folder, fileName);
            if (File.Exists(target)) return;

            var imgResp = await _core.VrcApi._http.GetAsync(imageUrl);
            if (!imgResp.IsSuccessStatusCode) return;
            var bytes = await imgResp.Content.ReadAsByteArrayAsync();
            if (bytes.Length == 0) return;
            await File.WriteAllBytesAsync(target, bytes);

            _core.SendToJS("log", new { msg = $"Print saved: {fileName}", color = "ok" });
        }
        catch (Exception ex)
        {
            _core.SendToJS("log", new { msg = $"Print save failed ({printId}): {ex.Message}", color = "err" });
        }
        finally { _gate.Release(); }
    }

    private static string Sanitize(string name)
    {
        foreach (var c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
        return name.Trim().Length == 0 ? "Unknown" : name.Trim();
    }
}
