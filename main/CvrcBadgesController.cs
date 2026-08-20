using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace VRCNext;

// CVRC-recognized name badges (owner, supporter themes, etc.) — see getCvrcOwnerBadgeHtml /
// cvrcOwnerNameClass in frontend/core/logic/core.js for how they're rendered. The list itself
// lives in a small public JSON file on GitHub (data/cvrc_badges.json) rather than being baked
// into the shipped app, so adding a new badge holder goes live for everyone the moment the file
// is edited and pushed — no new CVRC release needed.
public class CvrcBadgesController
{
    private const string ManifestUrl = "https://raw.githubusercontent.com/4jhm/CVRC/main/data/cvrc_badges.json";

    private static readonly string CachePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "VRCNext", "Caches", "cvrc_badges_cache.json");

    private readonly CoreLibrary _core;

    public CvrcBadgesController(CoreLibrary core)
    {
        _core = core;
    }

    public void HandleMessage(string action, JObject msg)
    {
        if (action != "getCvrcBadges") return;
        _ = LoadAsync();
    }

    private async Task LoadAsync()
    {
        // Cache-first: whatever's on disk shows immediately, then a background refresh keeps
        // it current — a badge is purely decorative, so there's no need to block on the network.
        var disk = LoadDiskCache();
        if (disk != null) _core.SendToJS("cvrcBadges", new { badges = disk });

        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
            client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", AppInfo.UserAgent);
            client.DefaultRequestHeaders.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoCache = true };
            var resp = await client.GetAsync(ManifestUrl);
            if (!resp.IsSuccessStatusCode) return;
            var body = await resp.Content.ReadAsStringAsync();
            var obj = JObject.Parse(body);
            SaveDiskCache(obj);
            _core.SendToJS("cvrcBadges", new { badges = obj });
        }
        catch { /* keep whatever the disk cache (or nothing) already gave the UI */ }
    }

    private static JObject? LoadDiskCache()
    {
        try
        {
            if (!File.Exists(CachePath)) return null;
            return JObject.Parse(File.ReadAllText(CachePath));
        }
        catch { return null; }
    }

    private static void SaveDiskCache(JObject obj)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(CachePath)!);
            File.WriteAllText(CachePath, obj.ToString(Formatting.None));
        }
        catch { /* best-effort — worst case it re-fetches next launch */ }
    }
}
