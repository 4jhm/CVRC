using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using VRCNext.Services.Helpers;

namespace VRCNext.Services;

public class AvatarLogEntry
{
    public string Key { get; set; } = "";
    public DateTime When { get; set; }
    public string Name { get; set; } = "";
    public string Author { get; set; } = "";
    public string? Wearer { get; set; }
    // Display name of the VRChat account that was logged in when this entry was recorded —
    // lets a multi-account setup tell which account actually encountered a given avatar.
    public string? Account { get; set; }
    public double? SizeMb { get; set; }
    public string? ThumbUrl { get; set; }
    public string? AvatarId { get; set; }
    public string? Link { get; set; }
    public string? Visibility { get; set; }
    public string? DownloadLink { get; set; }
    public string? CachePath { get; set; }
    // "posted" | "listed" | "error" | "skipped_small" | "uploading"
    public string Status { get; set; } = "listed";
    public string? Note { get; set; }
    // 0-100 while Status == "uploading"; meaningless otherwise.
    public int UploadProgress { get; set; }
    // Populated only for own-avatar switches (no download event to reliably correlate against a
    // cache write — see FindCacheCandidates). Every valid bundle found in the cache, so the UI can
    // list them by size/recency and let the user pick theirs manually.
    public List<CacheCandidate>? CacheCandidates { get; set; }
}

public class CacheCandidate
{
    public string Path { get; set; } = "";
    public double SizeMb { get; set; }
    public DateTime Modified { get; set; }
}

// Watches VRChat's log for freshly-downloaded avatars and posts them to Discord/GoFile.
// A from-scratch reimplementation of the "VRC Avatar Logger" personal project, built to
// reuse CVRC's own log watching, avatar lookup, and Discord/GoFile plumbing instead of
// tailing files and hand-rolling HTTP the way the standalone Python tool did.
public class AvatarLoggerService : IDisposable
{
    private readonly CoreLibrary _core;
    private readonly GofileService _gofile;
    private readonly Action<string> _log;
    private readonly Action<AvatarLogEntry> _onEvent;

    private static readonly string AppDataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "VRCNext");
    private static readonly string SeenPath    = Path.Combine(AppDataDir, "avatarlogger_seen.json");
    private static readonly string HistoryPath = Path.Combine(AppDataDir, "avatarlogger_history.json");
    private const int HistoryCap = 2000;

    private CancellationTokenSource? _cts;
    private Task? _worker;
    private volatile bool _running;

    private Dictionary<string, DateTime> _seen = new();
    private List<AvatarLogEntry> _history = new();
    // Every entry emitted this session, regardless of status — unlike History (posted-only,
    // persisted, feeds the Database view), this is what manual actions (Upload button, retry)
    // look an entry up by, since a "listed" or "error" entry never makes it into History.
    private readonly Dictionary<string, AvatarLogEntry> _liveEntries = new();
    private readonly HashSet<string> _claimedFiles = new();
    private readonly List<(DateTime When, string Wearer, string Avatar)> _recentSwitches = new();
    private readonly List<(DateTime When, double SizeMb)> _recentDownloads = new();
    private readonly Dictionary<string, DateTime> _postedNames = new();

    private static readonly Regex UnpackRe = new(
        @"^(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}).*?\[AssetBundleDownloadManager\] \[\d+\] Unpacking Avatar \((.+)\)\s*$",
        RegexOptions.Compiled);
    private static readonly Regex DownloadRe = new(
        @"^(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}).*?\[AssetBundleDownloadManager\] Download for avatar .*?\((\d+(?:\.\d+)?) (KB|MB|GB)\) started .* completed",
        RegexOptions.Compiled);
    private static readonly Regex SwitchRe = new(
        @"^(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}).*?\[Behaviour\] Switching (.+?) to avatar (.+?)\s*$",
        RegexOptions.Compiled);
    private static readonly Regex TsPrefixRe = new(@"^(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2})", RegexOptions.Compiled);
    private static readonly Dictionary<string, double> SizeUnits = new() { ["KB"] = 1 / 1024.0, ["MB"] = 1.0, ["GB"] = 1024.0 };
    private static readonly TimeSpan SwitchSettle = TimeSpan.FromSeconds(8);
    private static readonly TimeSpan WearerWindow = TimeSpan.FromSeconds(30);

    public AvatarLoggerService(CoreLibrary core, Action<string> log, Action<AvatarLogEntry> onEvent)
    {
        _core = core;
        _log = log;
        _onEvent = onEvent;
        _gofile = new GofileService(log);
        LoadSeen();
        LoadHistory();
    }

    public bool IsRunning => _running;
    public IReadOnlyList<AvatarLogEntry> History => _history;

    public void Start()
    {
        if (_running) return;
        _running = true;
        _cts = new CancellationTokenSource();
        _worker = Task.Run(() => TailLoopAsync(_cts.Token));
        _log("[AvatarLogger] Started");
    }

    public void Stop()
    {
        if (!_running) return;
        _running = false;
        _cts?.Cancel();
        _log("[AvatarLogger] Stopped");
    }

    public void Dispose() => Stop();

    public void ClearSeen()
    {
        _seen.Clear();
        _postedNames.Clear();
        SaveSeen();
    }

    // ---- log tailing ----

    private static string? NewestLog(string logDir)
    {
        try
        {
            if (!Directory.Exists(logDir)) return null;
            return Directory.GetFiles(logDir, "output_log_*.txt")
                .OrderByDescending(f => new FileInfo(f).LastWriteTime)
                .FirstOrDefault();
        }
        catch { return null; }
    }

    private async Task TailLoopAsync(CancellationToken ct)
    {
        var logDir = VrcPathsHelper.AppDataDir();
        string? current = NewestLog(logDir);
        FileStream? fs = null;
        var buf = new List<byte>();
        try
        {
            if (current != null)
            {
                fs = new FileStream(current, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                fs.Seek(0, SeekOrigin.End); // attach at end — don't replay the whole session
                _log($"[AvatarLogger] watching {Path.GetFileName(current)}");
            }
            else
            {
                _log($"[AvatarLogger] waiting for a log file in {logDir} ...");
            }

            while (!ct.IsCancellationRequested)
            {
                var latest = NewestLog(logDir);
                if (latest != null && latest != current)
                {
                    fs?.Dispose();
                    current = latest;
                    fs = new FileStream(current, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                    buf.Clear();
                    _log($"[AvatarLogger] switched to {Path.GetFileName(current)}");
                }

                if (fs != null)
                {
                    var chunk = new byte[65536];
                    int n;
                    while ((n = await fs.ReadAsync(chunk, 0, chunk.Length, ct)) > 0)
                        buf.AddRange(chunk.AsSpan(0, n).ToArray());

                    int nl;
                    while ((nl = buf.IndexOf((byte)'\n')) >= 0)
                    {
                        var lineBytes = buf.GetRange(0, nl);
                        buf.RemoveRange(0, nl + 1);
                        var line = System.Text.Encoding.UTF8.GetString(lineBytes.ToArray()).TrimEnd('\r');
                        try { FeedLine(line); }
                        catch (Exception ex) { CrashHandler.WriteEntry("AvatarLoggerService.FeedLine", ex); }
                    }
                }

                FlushPendingMySwitches(DateTime.Now);
                await Task.Delay(2000, ct);
            }
        }
        catch (TaskCanceledException) { }
        catch (Exception ex)
        {
            CrashHandler.WriteEntry("AvatarLoggerService.TailLoop", ex);
            _log($"[AvatarLogger] tail error: {ex.Message}");
        }
        finally { fs?.Dispose(); }
    }

    private readonly List<(DateTime When, string Name, string Wearer)> _pendingMy = new();

    private void FeedLine(string line)
    {
        var tsm = TsPrefixRe.Match(line);
        if (tsm.Success) FlushPendingMySwitches(ParseTs(tsm.Groups[1].Value));

        var m = SwitchRe.Match(line);
        if (m.Success)
        {
            var when = ParseTs(m.Groups[1].Value);
            var wearer = m.Groups[2].Value.Trim();
            var avatar = m.Groups[3].Value.Trim();
            _recentSwitches.Add((when, wearer, avatar));
            if (_recentSwitches.Count > 200) _recentSwitches.RemoveRange(0, 100);

            var myName = _core.VrcApi.IsLoggedIn ? (_core.VrcApi.CurrentUserRaw?["displayName"]?.ToString() ?? "") : "";
            if (_core.Settings.AvlogLogMySwitches && !string.IsNullOrEmpty(myName) && wearer == myName)
                _pendingMy.Add((when, avatar, wearer));
            return;
        }

        m = DownloadRe.Match(line);
        if (m.Success)
        {
            var when = ParseTs(m.Groups[1].Value);
            var sizeMb = double.Parse(m.Groups[2].Value) * SizeUnits[m.Groups[3].Value];
            _recentDownloads.Add((when, sizeMb));
            if (_recentDownloads.Count > 200) _recentDownloads.RemoveRange(0, 100);
            return;
        }

        m = UnpackRe.Match(line);
        if (!m.Success) return;
        var w = ParseTs(m.Groups[1].Value);
        var (name, author) = SplitNameAuthor(m.Groups[2].Value);
        if (string.IsNullOrEmpty(name)) return;
        _ = ProcessAvatarAsync(name, author, w, TakeDownloadSize(w), FindWearer(name, w), fromSwitch: false);
    }

    private void FlushPendingMySwitches(DateTime now)
    {
        if (_pendingMy.Count == 0) return;
        var still = new List<(DateTime, string, string)>();
        foreach (var (when, name, wearer) in _pendingMy)
        {
            if (now - when < SwitchSettle) { still.Add((when, name, wearer)); continue; }
            if (_postedNames.TryGetValue(name, out var last) && (when - last).Duration() < TimeSpan.FromMinutes(5))
                continue; // the download path already handled this avatar
            _ = ProcessAvatarAsync(name, "", when, null, wearer, fromSwitch: true);
        }
        _pendingMy.Clear();
        _pendingMy.AddRange(still);
    }

    private double? TakeDownloadSize(DateTime when)
    {
        while (_recentDownloads.Count > 0)
        {
            var (ts, sizeMb) = _recentDownloads[0];
            _recentDownloads.RemoveAt(0);
            if ((when - ts).TotalSeconds > 60) continue; // stale, discard
            return sizeMb;
        }
        return null;
    }

    private string? FindWearer(string avatarName, DateTime when)
    {
        for (int i = _recentSwitches.Count - 1; i >= 0; i--)
        {
            var (ts, player, avatar) = _recentSwitches[i];
            if (avatar == avatarName && (when - ts).Duration() <= WearerWindow) return player;
        }
        return null;
    }

    private static (string Name, string Author) SplitNameAuthor(string inner)
    {
        var idx = inner.LastIndexOf(" by ", StringComparison.Ordinal);
        if (idx < 0) return (inner.Trim(), "");
        return (inner[..idx].Trim(), inner[(idx + 4)..].Trim());
    }

    private static DateTime ParseTs(string s) =>
        DateTime.ParseExact(s, "yyyy.MM.dd HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture);

    // ---- per-avatar pipeline ----

    private async Task ProcessAvatarAsync(string name, string author, DateTime when, double? sizeMb, string? wearer, bool fromSwitch)
    {
        try
        {
            var account = _core.VrcApi.IsLoggedIn ? _core.VrcApi.CurrentUserRaw?["displayName"]?.ToString() : null;

            var ignore = _core.Settings.AvlogIgnorePeople
                .Where(p => !string.IsNullOrWhiteSpace(p))
                .Select(p => p.Trim().ToLowerInvariant())
                .ToHashSet();
            if (ignore.Count > 0 && ((wearer != null && ignore.Contains(wearer.ToLowerInvariant()))
                                   || (!string.IsNullOrEmpty(author) && ignore.Contains(author.ToLowerInvariant()))))
                return;

            var key = $"{name}|{author}";
            if (_seen.ContainsKey(key))
            {
                // Was already logged (this session or a past one — seen.json persists). Previously
                // this returned with zero feedback, which looked exactly like "nothing detected it"
                // from the UI. Still surface it (with the file re-matched) so it's visible and can
                // be force-uploaded via the row's Upload button if wanted.
                Emit(new AvatarLogEntry
                {
                    Key = key, When = when, Name = name, Author = author, Wearer = wearer, Account = account,
                    SizeMb = sizeMb, CachePath = FindCacheFile(when), Status = "repeat",
                    Note = "already logged before (use \"Forget Logged Avatars\" to reset, or Upload to force it again)",
                });
                return;
            }

            string? thumb = null, avatarId = null, visibility = null;
            var (lThumb, lId, lAuthor) = await LookupAvatarAsync(name, author);
            thumb = lThumb; avatarId = lId;
            if (string.IsNullOrEmpty(author) && !string.IsNullOrEmpty(lAuthor)) author = lAuthor;
            visibility = avatarId != null ? "Public" : "Private / unlisted";

            if (sizeMb.HasValue && sizeMb.Value < _core.Settings.AvlogMinSizeMb)
            {
                RecordSeen(key, when);
                Emit(new AvatarLogEntry
                {
                    Key = key, When = when, Name = name, Author = author, Wearer = wearer, Account = account,
                    SizeMb = sizeMb, ThumbUrl = thumb, AvatarId = avatarId, Visibility = visibility,
                    CachePath = FindCacheFile(when), Status = "skipped_small",
                    Note = $"under {_core.Settings.AvlogMinSizeMb:g} MB — click Upload to send it anyway",
                });
                return;
            }

            var cachePath = FindCacheFile(when);
            var auto = _core.Settings.AvlogAutoUpload && sizeMb.HasValue && sizeMb.Value >= _core.Settings.AvlogAutoUploadMinMb;

            var entry = new AvatarLogEntry
            {
                Key = key, When = when, Name = name, Author = author, Wearer = wearer, Account = account,
                SizeMb = sizeMb, ThumbUrl = thumb, AvatarId = avatarId, Visibility = visibility,
                CachePath = cachePath, Status = "listed",
                // Own-avatar switches have no download event to correlate a single cache file
                // against, so a lone "best guess" can't be trusted — hand the user every valid
                // bundle in the cache instead, so they can recognize theirs by size/recency.
                CacheCandidates = fromSwitch ? FindCacheCandidates(when) : null,
            };

            if (!auto || cachePath == null)
            {
                entry.Note = !auto ? "auto-upload off" : "no cache file matched";
                RecordSeen(key, when);
                Emit(entry);
                return;
            }

            await DeliverAsync(entry);
            RecordSeen(key, when);
            Emit(entry);
        }
        catch (Exception ex)
        {
            CrashHandler.WriteEntry("AvatarLoggerService.ProcessAvatar", ex);
        }
    }

    private void RecordSeen(string key, DateTime when)
    {
        _seen[key] = when;
        _postedNames[key.Split('|')[0]] = when;
        SaveSeen();
    }

    // Delivers (Discord and/or GoFile per AvlogDeliveryMode) and fills in entry.Status/Link/Note.
    // Shared by the automatic pipeline and the manual "Upload" button in the UI.
    public async Task DeliverAsync(AvatarLogEntry entry)
    {
        if (string.IsNullOrEmpty(entry.CachePath) || !File.Exists(entry.CachePath))
        {
            entry.Status = "error";
            entry.Note = "matched file no longer exists";
            return;
        }
        if (_claimedFiles.Contains(entry.CachePath))
        {
            entry.Status = "error";
            entry.Note = "file already claimed by another avatar this session";
            return;
        }
        _claimedFiles.Add(entry.CachePath);

        var fileMb = new FileInfo(entry.CachePath).Length / (1024.0 * 1024.0);
        var mode = _core.Settings.AvlogDeliveryMode;
        string fileName = SafeFileName(entry.Name, entry.Author) + ".vrca";

        TryArchiveLocalCopy(entry.CachePath, fileName);

        // Large files are the ones most likely to hit GoFile's practical limits or just take
        // forever to upload — past the configured size, skip the network attempt entirely and
        // call it delivered once the local copy is down.
        var localOnlyAbove = _core.Settings.AvlogLocalOnlyAboveMb;
        if (localOnlyAbove > 0 && fileMb >= localOnlyAbove && !string.IsNullOrWhiteSpace(_core.Settings.AvlogLocalArchivePath))
        {
            entry.Status = "local";
            entry.Note = $"saved locally only ({fileMb:0.#} MB is over the {localOnlyAbove:g} MB auto-local limit)";
            AddToHistory(entry);
            return;
        }

        string? downloadLink = null;
        bool discordHasFile = mode != "gofile" && fileMb <= _core.Settings.AvlogMaxAttachmentMb;

        if (mode == "gofile" || (!discordHasFile))
        {
            downloadLink = await UploadToGofileWithProgressAsync(entry, fileName);
            if (downloadLink == null && mode != "auto")
            {
                entry.Status = "error";
                entry.Note = $"GoFile upload failed: {_gofile.LastUploadError}";
                return;
            }
        }

        if (string.IsNullOrEmpty(_core.Settings.AvlogWebhookUrl))
        {
            entry.Status = downloadLink != null ? "posted" : "error";
            entry.DownloadLink = downloadLink;
            entry.Note = downloadLink != null ? "uploaded to GoFile (no Discord webhook set)" : "no Discord webhook set, and GoFile upload failed";
            return;
        }

        var embed = BuildEmbed(entry, downloadLink);
        var json = JsonConvert.SerializeObject(new { embeds = new[] { embed } });

        WebhookService.PostResult result;
        if (discordHasFile && downloadLink == null)
            result = await _core.Webhook.PostEmbedWithFilesAsync(_core.Settings.AvlogWebhookUrl, json,
                new[] { (entry.CachePath, fileName) });
        else
            result = await _core.Webhook.PostJsonAsync(_core.Settings.AvlogWebhookUrl, json);

        if (!result.Success && mode == "auto" && downloadLink == null)
        {
            // Discord failed and we haven't tried GoFile yet — fall back.
            downloadLink = await UploadToGofileWithProgressAsync(entry, fileName);
            if (downloadLink != null)
            {
                embed = BuildEmbed(entry, downloadLink);
                json = JsonConvert.SerializeObject(new { embeds = new[] { embed } });
                result = await _core.Webhook.PostJsonAsync(_core.Settings.AvlogWebhookUrl, json);
            }
        }

        entry.DownloadLink = downloadLink;
        entry.Status = result.Success ? "posted" : "error";
        entry.Note = result.Success ? null : $"Discord post failed: {result.Error}";
        AddToHistory(entry);
    }

    // Uploads to GoFile while pushing throttled live progress to the UI via Emit(entry) — at
    // most ~3/sec, plus always on the first and last chunk, so a fast connection doesn't flood
    // the frontend with events for a file that uploads in under a second.
    private async Task<string?> UploadToGofileWithProgressAsync(AvatarLogEntry entry, string fileName)
    {
        entry.Status = "uploading";
        entry.UploadProgress = 0;
        Emit(entry);

        var lastEmit = DateTime.UtcNow;
        var lastPercent = -1;
        var link = await _gofile.UploadFileAsync(entry.CachePath!, fileName,
            string.IsNullOrEmpty(_core.Settings.AvlogGofileToken) ? null : _core.Settings.AvlogGofileToken,
            string.IsNullOrEmpty(_core.Settings.AvlogGofileFolder) ? null : _core.Settings.AvlogGofileFolder,
            onProgress: (sent, total) =>
            {
                var percent = total > 0 ? (int)(sent * 100 / total) : 0;
                var now = DateTime.UtcNow;
                if (percent == lastPercent) return;
                if ((now - lastEmit).TotalMilliseconds < 300 && percent < 100) return;
                lastPercent = percent;
                lastEmit = now;
                entry.UploadProgress = percent;
                Emit(entry);
            });
        return link;
    }

    private static string SafeFileName(string name, string author)
    {
        string Clean(string s) => new string((s ?? "").Select(c => char.IsLetterOrDigit(c) || " -_.".Contains(c) ? c : '_').ToArray()).Trim();
        var n = Clean(name);
        var a = Clean(author);
        return string.IsNullOrEmpty(a) ? n : $"{n} - {a}";
    }

    // Manual "Upload to Files" button — just copies straight to AvlogLocalArchivePath, no
    // GoFile/Discord involved. Independent of delivery Status, so it works even on an entry
    // that was already posted (or failed to post) elsewhere.
    public (bool ok, string message) ManualArchiveToFiles(AvatarLogEntry entry)
    {
        if (string.IsNullOrEmpty(entry.CachePath) || !File.Exists(entry.CachePath))
            return (false, "matched file no longer exists");
        var dir = _core.Settings.AvlogLocalArchivePath;
        if (string.IsNullOrWhiteSpace(dir))
            return (false, "no Local Archive Folder set — configure one in Settings first");

        string fileName = SafeFileName(entry.Name, entry.Author) + ".vrca";
        TryArchiveLocalCopy(entry.CachePath, fileName);
        return (true, $"Saved to {dir}");
    }

    // Best-effort local backup copy — independent of whether Discord/GoFile delivery actually
    // succeeds, so a failed upload still leaves you with the file. Never blocks or fails delivery.
    private void TryArchiveLocalCopy(string cachePath, string fileName)
    {
        var dir = _core.Settings.AvlogLocalArchivePath;
        if (string.IsNullOrWhiteSpace(dir)) return;
        try
        {
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, fileName);
            if (File.Exists(target))
            {
                var stem = Path.GetFileNameWithoutExtension(fileName);
                var ext = Path.GetExtension(fileName);
                var i = 2;
                do { target = Path.Combine(dir, $"{stem} ({i}){ext}"); i++; } while (File.Exists(target));
            }
            File.Copy(cachePath, target);
            _log($"[AvatarLogger] archived locally: {target}");
        }
        catch (Exception ex)
        {
            _log($"[AvatarLogger] local archive copy failed: {ex.Message}");
        }
    }

    private static JObject BuildEmbed(AvatarLogEntry entry, string? downloadLink)
    {
        var fields = new JArray();
        if (!string.IsNullOrEmpty(entry.Author)) fields.Add(new JObject { ["name"] = "Author", ["value"] = entry.Author, ["inline"] = true });
        if (!string.IsNullOrEmpty(entry.Wearer)) fields.Add(new JObject { ["name"] = "Worn by", ["value"] = entry.Wearer, ["inline"] = true });
        if (entry.SizeMb.HasValue) fields.Add(new JObject { ["name"] = "Size", ["value"] = $"{entry.SizeMb:0.0} MB", ["inline"] = true });
        if (!string.IsNullOrEmpty(entry.Visibility)) fields.Add(new JObject { ["name"] = "Visibility", ["value"] = entry.Visibility, ["inline"] = true });
        string? link = !string.IsNullOrEmpty(entry.AvatarId) ? $"https://vrchat.com/home/avatar/{entry.AvatarId}" : null;
        if (link != null) fields.Add(new JObject { ["name"] = "Avatar", ["value"] = $"[Open in VRChat]({link})", ["inline"] = true });
        if (!string.IsNullOrEmpty(downloadLink)) fields.Add(new JObject { ["name"] = "📁 Download (GoFile)", ["value"] = downloadLink, ["inline"] = false });

        var embed = new JObject
        {
            ["title"] = string.IsNullOrEmpty(entry.Name) ? "(unnamed avatar)" : entry.Name,
            ["color"] = 0x1B8CFF,
            ["fields"] = fields,
            ["timestamp"] = entry.When.ToString("o"),
            ["footer"] = new JObject { ["text"] = "VRChat avatar loaded in full detail — via CVRC" },
        };
        if (link != null) embed["url"] = link;
        if (!string.IsNullOrEmpty(entry.ThumbUrl)) embed["image"] = new JObject { ["url"] = entry.ThumbUrl };
        return embed;
    }

    // ---- avatar metadata lookup (avtrdb search-by-name) ----

    private static readonly HttpClient LookupHttp = new() { Timeout = TimeSpan.FromSeconds(8) };

    private async Task<(string? Thumb, string? AvatarId, string? Author)> LookupAvatarAsync(string name, string author)
    {
        try
        {
            var url = "https://api.avtrdb.com/v2/avatar/search?query=" + Uri.EscapeDataString(name);
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.UserAgent.ParseAdd("Mozilla/5.0");
            using var resp = await LookupHttp.SendAsync(req);
            if (!resp.IsSuccessStatusCode) return (null, null, null);
            var body = await resp.Content.ReadAsStringAsync();
            var data = JObject.Parse(body);
            var avatars = data["avatars"] as JArray;
            if (avatars == null || avatars.Count == 0) return (null, null, null);

            JObject? exact = null, byNameAuthor = null;
            foreach (var a in avatars.OfType<JObject>())
            {
                var aName = a["name"]?.ToString() ?? "";
                if (!string.Equals(aName, name, StringComparison.OrdinalIgnoreCase)) continue;
                exact ??= a;
                var aAuthor = a["author"]?["name"]?.ToString() ?? "";
                if (!string.IsNullOrEmpty(author) && string.Equals(aAuthor, author, StringComparison.OrdinalIgnoreCase))
                    byNameAuthor = a;
            }
            var pick = byNameAuthor ?? exact;
            if (pick == null) return (null, null, null);
            return (pick["image_url"]?.ToString(), pick["vrc_id"]?.ToString(), pick["author"]?["name"]?.ToString());
        }
        catch (Exception ex)
        {
            _log($"[AvatarLogger] lookup error: {ex.Message}");
            return (null, null, null);
        }
    }

    // ---- cache file matching ----

    private static string AutoCacheDir(string logDir)
    {
        var a = Path.Combine(logDir, "Cache-WindowsPlayer");
        if (Directory.Exists(a)) return a;
        var parent = Directory.GetParent(logDir)?.FullName;
        if (parent != null)
        {
            var b = Path.Combine(parent, "Cache-WindowsPlayer");
            if (Directory.Exists(b)) return b;
        }
        return a;
    }

    // VRChat's cache bundles are usually named "__data" (no extension) regardless of nesting
    // depth, but that's not universal across every setup. Blank AvlogCacheFileName auto-detects:
    // match any file in a cache leaf folder that isn't a known non-bundle sidecar
    // ("__lock"/"__info"). A bare word typed here (e.g. "__data" or "l") is ambiguous — it could
    // mean "match this exact filename" or "match this extension" — so both interpretations are
    // tried and the results merged, rather than guessing one and silently matching nothing for
    // the other (as a plain "__data" input used to, since "*.  __data" matches nothing on a real
    // VRChat cache where the file's whole name is "__data" with no extension at all). Either way,
    // the file this finds is only ever a *source*: the delivered/archived copy is always renamed
    // to "<avatar name>.vrca", never anything the user types here.
    private static readonly HashSet<string> NonBundleSiblingNames =
        new(StringComparer.OrdinalIgnoreCase) { "__lock", "__info" };

    private static IEnumerable<string> IterDataFiles(string cacheDir, string filter)
    {
        if (!Directory.Exists(cacheDir)) yield break;
        var autoDetect = string.IsNullOrWhiteSpace(filter);

        var patterns = autoDetect ? new[] { "*" }
            : (filter.Contains('*') || filter.Contains('?')) ? new[] { filter } // already a full glob pattern
            : new[] { filter, "*." + filter.TrimStart('.') }; // bare word: try as exact name AND as extension

        var seen = new HashSet<string>();
        foreach (var pattern in patterns)
        {
            IEnumerable<string> matches;
            try { matches = Directory.EnumerateFiles(cacheDir, pattern, SearchOption.AllDirectories); }
            catch { continue; }
            foreach (var m in matches)
            {
                if (autoDetect && NonBundleSiblingNames.Contains(Path.GetFileName(m)))
                    continue;
                if (seen.Add(m)) yield return m;
            }
        }
    }

    // VRChat's asset bundles (the "__data" cache files, once unpacked) are Unity "UnityFS"
    // bundles regardless of nesting depth. Timestamp proximity alone isn't enough to trust a
    // match: for an avatar that's already fully cached (typically your own — VRChat doesn't
    // re-download/re-touch it just because you switched to it), nothing in the cache tree was
    // genuinely written at switch time, so the "closest by timestamp" candidate can be some
    // unrelated file that happened to be touched around then. Checking the header rejects those
    // false matches instead of silently archiving/uploading garbage.
    private static bool LooksLikeAssetBundle(string path)
    {
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            if (fs.Length < 7) return false;
            var header = new byte[7];
            int read = 0;
            while (read < 7)
            {
                int n = fs.Read(header, read, 7 - read);
                if (n <= 0) break;
                read += n;
            }
            if (read < 7) return false;
            var sig = System.Text.Encoding.ASCII.GetString(header);
            return sig is "UnityFS" or "UnityWe" or "UnityRa"; // FS / Web / Raw bundle formats
        }
        catch { return false; }
    }

    private string? FindCacheFile(DateTime when)
    {
        var overridePath = _core.Settings.AvlogCachePathOverride;
        var cache = !string.IsNullOrWhiteSpace(overridePath)
            ? overridePath
            : AutoCacheDir(VrcPathsHelper.AppDataDir());
        if (!Directory.Exists(cache)) return null;

        var targetFileName = _core.Settings.AvlogCacheFileName; // blank = auto-detect

        var whenTicks = when;
        (double Score, string Path)? best = null;
        foreach (var data in IterDataFiles(cache, targetFileName))
        {
            if (_claimedFiles.Contains(data)) continue;
            DateTime touch;
            try { touch = File.GetLastWriteTime(data); }
            catch { continue; }
            foreach (var sib in new[] { "__lock", "__info" })
            {
                try
                {
                    var sp = Path.Combine(Path.GetDirectoryName(data)!, sib);
                    if (File.Exists(sp))
                    {
                        var t = File.GetLastWriteTime(sp);
                        if (t > touch) touch = t;
                    }
                }
                catch { }
            }
            var diff = Math.Abs((touch - whenTicks).TotalSeconds);
            if (diff > 300) continue;
            if (!LooksLikeAssetBundle(data)) continue;
            if (best == null || diff < best.Value.Score) best = (diff, data);
        }
        return best?.Path;
    }

    // Every valid bundle in the cache tree, sorted by closeness to `when` (nearest first) so the
    // most likely match still shows up first — but unlike FindCacheFile this doesn't collapse to
    // one guess or apply a time cutoff, since for an own avatar there may be no genuinely-fresh
    // write to find at all. Capped so a huge cache doesn't flood the UI with candidates.
    private List<CacheCandidate> FindCacheCandidates(DateTime when, int max = 40)
    {
        var overridePath = _core.Settings.AvlogCachePathOverride;
        var cache = !string.IsNullOrWhiteSpace(overridePath)
            ? overridePath
            : AutoCacheDir(VrcPathsHelper.AppDataDir());
        if (!Directory.Exists(cache)) return new();

        var targetFileName = _core.Settings.AvlogCacheFileName;
        var results = new List<(double Diff, CacheCandidate Candidate)>();
        foreach (var data in IterDataFiles(cache, targetFileName))
        {
            if (!LooksLikeAssetBundle(data)) continue;
            DateTime touch;
            long len;
            try
            {
                touch = File.GetLastWriteTime(data);
                len = new FileInfo(data).Length;
            }
            catch { continue; }
            var diff = Math.Abs((touch - when).TotalSeconds);
            results.Add((diff, new CacheCandidate { Path = data, SizeMb = len / (1024.0 * 1024.0), Modified = touch }));
        }
        return results.OrderBy(r => r.Diff).Take(max).Select(r => r.Candidate).ToList();
    }

    // ---- persistence ----

    private void LoadSeen()
    {
        try
        {
            if (!File.Exists(SeenPath)) return;
            var raw = JsonConvert.DeserializeObject<Dictionary<string, DateTime>>(File.ReadAllText(SeenPath));
            if (raw != null) _seen = raw;
        }
        catch { }
    }

    private void SaveSeen()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(SeenPath)!);
            File.WriteAllText(SeenPath, JsonConvert.SerializeObject(_seen));
        }
        catch (Exception ex) { CrashHandler.WriteEntry("AvatarLoggerService.SaveSeen", ex); }
    }

    private void LoadHistory()
    {
        try
        {
            if (!File.Exists(HistoryPath)) return;
            var raw = JsonConvert.DeserializeObject<List<AvatarLogEntry>>(File.ReadAllText(HistoryPath));
            if (raw != null) _history = raw;
        }
        catch { }
    }

    private void AddToHistory(AvatarLogEntry entry)
    {
        if (entry.Status != "posted" && entry.Status != "local") return;
        _history.RemoveAll(e => e.Key == entry.Key);
        _history.Add(entry);
        if (_history.Count > HistoryCap) _history.RemoveRange(0, _history.Count - HistoryCap);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(HistoryPath)!);
            File.WriteAllText(HistoryPath, JsonConvert.SerializeObject(_history));
        }
        catch (Exception ex) { CrashHandler.WriteEntry("AvatarLoggerService.SaveHistory", ex); }
    }

    private void Emit(AvatarLogEntry entry)
    {
        _liveEntries[entry.Key] = entry;
        _onEvent(entry);
    }

    public AvatarLogEntry? FindEntry(string key) => _liveEntries.TryGetValue(key, out var e) ? e : null;
}
