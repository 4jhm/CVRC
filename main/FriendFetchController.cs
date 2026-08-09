using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using VRCNext.Services;

namespace VRCNext;

public class FriendFetchController
{
    private const int MaxConcurrent = 2;
    private const int DelayMs = 500;
    private static readonly TimeSpan Cooldown = TimeSpan.FromHours(1);

    private readonly CoreLibrary _core;
    private readonly FriendsController _friends;

    private int _running;
    private int _done;
    private int _total;
    private int _failed;
    private DateTime? _lastRunUtc;
    private CancellationTokenSource? _cts;

    public FriendFetchController(CoreLibrary core, FriendsController friends)
    {
        _core = core;
        _friends = friends;
    }

    private static string StatePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "VRCNext", "Caches", "friend_fetch.json");

    private static DateTime? ReadLastRun()
    {
        try
        {
            if (!File.Exists(StatePath)) return null;
            using var sr = new StringReader(File.ReadAllText(StatePath, System.Text.Encoding.UTF8));
            using var jr = new JsonTextReader(sr) { DateParseHandling = DateParseHandling.None };
            var o = JObject.Load(jr);
            var s = o["lastRun"]?.ToString();
            if (string.IsNullOrEmpty(s)) return null;
            return DateTime.TryParse(s, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.RoundtripKind, out var dt)
                ? dt.ToUniversalTime() : null;
        }
        catch { return null; }
    }

    private void MarkRun(DateTime utc)
    {
        _lastRunUtc = utc;
        WriteLastRun(utc);
    }

    private static void WriteLastRun(DateTime? utc)
    {
        try
        {
            var dir = Path.GetDirectoryName(StatePath)!;
            Directory.CreateDirectory(dir);
            var o = new JObject { ["lastRun"] = utc?.ToString("o") ?? "" };
            File.WriteAllText(StatePath, o.ToString(Formatting.None), System.Text.Encoding.UTF8);
        }
        catch { }
    }

    private long CooldownRemainingMs()
    {
        var fileRun = ReadLastRun();
        DateTime? last = _lastRunUtc;
        if (fileRun != null && (last == null || fileRun.Value > last.Value)) last = fileRun;
        if (last == null) return 0;
        var left = (last.Value + Cooldown) - DateTime.UtcNow;
        return left.TotalMilliseconds > 0 ? (long)left.TotalMilliseconds : 0;
    }

    public async Task HandleMessage(string action, JObject msg)
    {
        switch (action)
        {
            case "vrcFriendFetchState":
                PushState();
                break;

            case "vrcFriendFetchStart":
                Start(msg["force"]?.Value<bool>() ?? false);
                break;

            case "vrcFriendFetchCancel":
                _cts?.Cancel();
                PushState();
                break;
        }
        await Task.CompletedTask;
    }

    private void PushState() => _core.SendToJS("vrcFriendFetchProgress", new
    {
        running = _running == 1,
        done = _done,
        total = _total,
        cooldownMs = CooldownRemainingMs(),
    });

    private void Start(bool force)
    {
        if (!_core.VrcApi.IsLoggedIn) { PushState(); return; }
        if (Interlocked.CompareExchange(ref _running, 1, 0) == 1) { PushState(); return; }
        if (!force && CooldownRemainingMs() > 0) { _running = 0; PushState(); return; }

        _cts = new CancellationTokenSource();
        MarkRun(DateTime.UtcNow);
        _ = Task.Run(() => RunAsync(_cts.Token));
    }

    private async Task RunAsync(CancellationToken ct)
    {
        try
        {
            var ids = _friends.GetTrackedUserIds();
            _done = 0;
            _failed = 0;
            _total = ids.Count;
            PushState();
            if (_total == 0) return;

            using var gate = new SemaphoreSlim(MaxConcurrent, MaxConcurrent);
            var tasks = ids.Select(async uid =>
            {
                await gate.WaitAsync(ct);
                try
                {
                    if (ct.IsCancellationRequested) return;
                    var payload = await _friends.BuildUserDetailPayloadAsync(uid, true);
                    if (payload == null)
                    {
                        Interlocked.Increment(ref _failed);
                    }
                    else
                    {
                        _core.TimeEngine.SaveUserProfileCache(uid, JsonConvert.SerializeObject(payload));
                        PushMutualsToNetwork(uid, payload);
                        _friends.PushFriendFacts(uid);
                    }
                    await Task.Delay(DelayMs, ct);
                }
                catch (Exception ex)
                {
                    Interlocked.Increment(ref _failed);
                    if (_failed <= 3)
                        _core.SendToJS("log", new { msg = $"Friend fetch failed for {uid}: {ex.Message}", color = "err" });
                }
                finally
                {
                    gate.Release();
                    var c = Interlocked.Increment(ref _done);
                    if (c % 2 == 0 || c == _total) PushState();
                }
            });

            await Task.WhenAll(tasks);
        }
        catch { }
        finally
        {
            _running = 0;
            _cts?.Dispose();
            _cts = null;
            MarkRun(DateTime.UtcNow);
            PushState();
            _core.SendToJS("log", new { msg = $"Friend fetch done: {_done - _failed}/{_total} profiles cached, {_failed} failed", color = _failed > 0 ? "warn" : "ok" });
            _friends.PushFriendsFromStore();
        }
    }

    private void PushMutualsToNetwork(string userId, object payload)
    {
        try
        {
            var jo = JObject.FromObject(payload);
            var optedOut = jo["mutualsOptedOut"]?.Value<bool>() ?? false;
            var ids = (jo["mutuals"] as JArray)?
                .Select(m => m["id"]?.ToString() ?? "")
                .Where(s => s.Length > 0)
                .ToArray() ?? Array.Empty<string>();
            _core.SendToJS("vrcMutualsForNetwork", new { userId, mutualIds = optedOut ? Array.Empty<string>() : ids, optedOut });
        }
        catch { }
    }
}
