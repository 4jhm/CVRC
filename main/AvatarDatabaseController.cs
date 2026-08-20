using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace VRCNext;

// No download link on purpose — see the workflow that generates the manifest for why.
public record AvatarDbEntry(string Name, long SizeBytes, long CreateTimeUnix);

// "Avatar Database" tool — browses a shared Gofile folder of downloadable avatar files.
//
// This used to hit Gofile's folder-listing API directly with a throwaway guest account, but
// that endpoint is Premium-only in Gofile's official API, and the website's own internal
// fallback is signed with an anti-bot secret Gofile rotates server-side specifically to
// defeat reverse-engineering — continuing to guess it risks getting a user's IP banned, and
// a Premium token can't be embedded in a shipped client app without exposing it to everyone
// running it. Instead, a scheduled GitHub Action (.github/workflows/refresh-avatar-db.yml)
// uses a Premium token kept as a repo secret to regenerate a static manifest of the shared
// folder's contents, which is what this controller actually fetches — a plain, unauthenticated
// GET, no Gofile API calls or secrets involved on the client at all.
public class AvatarDatabaseController
{
    private const string ManifestUrl = "https://raw.githubusercontent.com/4jhm/CVRC/main/data/avatar_database.json";

    // Treating a network fetch as optional once we already have a decent on-disk cache cuts
    // avoidable traffic — the manifest only refreshes once a day anyway (see the workflow),
    // so there is no reason to hit GitHub on every single launch.
    private static readonly string CachePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "VRCNext", "Caches", "avatardb_cache.json");
    private static readonly TimeSpan BackgroundRefreshAge = TimeSpan.FromHours(6);

    private readonly CoreLibrary _core;
    private List<AvatarDbEntry>? _memEntries;
    private DateTime _memCachedAt = DateTime.MinValue;

    public AvatarDatabaseController(CoreLibrary core)
    {
        _core = core;
    }

    public void HandleMessage(string action, JObject msg)
    {
        switch (action)
        {
            case "avatarDbLoad":
                {
                    var force = msg["force"]?.Value<bool>() ?? false;
                    _ = LoadAsync(force);
                }
                break;

            case "avatarDbOpenLink":
                {
                    var url = msg["url"]?.ToString() ?? "https://gofile.io/d/dLV8UU";
                    try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo { FileName = url, UseShellExecute = true }); }
                    catch (Exception ex) { _core.SendToJS("log", new { msg = $"[AvatarDb] Could not open link: {ex.Message}", color = "err" }); }
                }
                break;
        }
    }

    private async Task LoadAsync(bool force)
    {
        if (!force && _memEntries != null && (DateTime.UtcNow - _memCachedAt).TotalMinutes < 10)
        {
            SendEntries(_memEntries);
            return;
        }

        // Cache-first: show whatever's on disk immediately (instant, no network wait, can't
        // fail), then decide whether a network refresh is actually warranted this time.
        if (_memEntries == null && !force)
        {
            var disk = LoadDiskCache();
            if (disk != null)
            {
                _memEntries = disk.Value.entries;
                _memCachedAt = disk.Value.at;
                SendEntries(_memEntries);

                if ((DateTime.UtcNow - disk.Value.at) < BackgroundRefreshAge)
                    return; // fresh enough — skip the network entirely this load
            }
        }

        await RefreshFromNetworkAsync();
    }

    private async Task RefreshFromNetworkAsync()
    {
        // _memEntries reflects anything already shown this session (disk cache or an earlier
        // successful fetch) — a refresh failing is only fatal if there's truly nothing to fall
        // back on; otherwise leave the current list alone and just log the miss.
        var hadFallback = _memEntries != null;

        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
            client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", AppInfo.UserAgent);
            // Raw GitHub content is aggressively CDN-cached; this keeps a stale copy from
            // sticking around locally longer than the cache-freshness logic above expects.
            client.DefaultRequestHeaders.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoCache = true };

            var resp = await client.GetAsync(ManifestUrl);
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
            {
                var reason = $"manifest fetch failed: HTTP {(int)resp.StatusCode}";
                if (hadFallback)
                {
                    _core.SendToJS("log", new { msg = $"[AvatarDb] Refresh failed, keeping cached list: {reason}", color = "warn" });
                    return;
                }
                _core.SendToJS("avatarDbResult", new { ok = false, message = $"Could not load the avatar database: {reason}" });
                return;
            }

            var root = JObject.Parse(body);
            var files = root["files"] as JArray;
            if (files == null)
            {
                var reason = "manifest had no 'files' array";
                if (hadFallback)
                {
                    _core.SendToJS("log", new { msg = $"[AvatarDb] Refresh failed, keeping cached list: {reason}", color = "warn" });
                    return;
                }
                _core.SendToJS("avatarDbResult", new { ok = false, message = $"Could not load the avatar database: {reason}" });
                return;
            }

            var entries = files.OfType<JObject>()
                .Select(f => new AvatarDbEntry(
                    Name: f["name"]?.ToString() ?? "unknown",
                    SizeBytes: f["sizeBytes"]?.Value<long>() ?? 0,
                    CreateTimeUnix: f["createTime"]?.Value<long>() ?? 0))
                .ToList();

            _memEntries = entries;
            _memCachedAt = DateTime.UtcNow;
            SaveDiskCache(entries, _memCachedAt);
            SendEntries(entries);
        }
        catch (Exception ex)
        {
            if (hadFallback)
            {
                _core.SendToJS("log", new { msg = $"[AvatarDb] Refresh error: {ex.Message}", color = "warn" });
                return;
            }
            _core.SendToJS("avatarDbResult", new { ok = false, message = $"Error: {ex.Message}" });
        }
    }

    private void SendEntries(List<AvatarDbEntry> entries)
    {
        var files = entries
            .Select(e => new
            {
                name = e.Name,
                sizeBytes = e.SizeBytes,
                createTime = e.CreateTimeUnix,
            })
            .ToList();
        _core.SendToJS("avatarDbResult", new { ok = true, files });
    }

    private static (List<AvatarDbEntry> entries, DateTime at)? LoadDiskCache()
    {
        try
        {
            if (!File.Exists(CachePath)) return null;
            var obj = JObject.Parse(File.ReadAllText(CachePath));
            var at = obj["at"]?.Value<DateTime?>();
            var entries = obj["entries"]?.ToObject<List<AvatarDbEntry>>();
            if (at == null || entries == null) return null;
            return (entries, DateTime.SpecifyKind(at.Value, DateTimeKind.Utc));
        }
        catch { return null; }
    }

    private static void SaveDiskCache(List<AvatarDbEntry> entries, DateTime at)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(CachePath)!);
            File.WriteAllText(CachePath, JObject.FromObject(new { entries, at }).ToString(Formatting.None));
        }
        catch { /* best-effort — a failed write just means next launch refetches */ }
    }
}
