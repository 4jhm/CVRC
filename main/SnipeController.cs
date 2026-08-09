using Newtonsoft.Json.Linq;
using VRCNext.Services;

namespace VRCNext;

public class SnipeController : IDisposable
{
    private const int PollIntervalMs = 12_000;
    private const int BackoffMaxMs   = 120_000;
    private const int BackoffStepMs  = 15_000;

    private readonly CoreLibrary _core;

    private CancellationTokenSource? _cts;
    private Task?                     _loopTask;
    private SnipeConfig?              _cfg;

    public bool IsRunning => _loopTask != null && !_loopTask.IsCompleted;

    public SnipeController(CoreLibrary core) => _core = core;

    public async Task HandleMessage(string action, JObject msg)
    {
        switch (action)
        {
            case "vrcStartSnipe":
            {
                var groupId = msg["groupId"]?.ToString() ?? "";
                if (string.IsNullOrEmpty(groupId))
                {
                    _core.SendToJS("snipeStatus", new { active = false, error = "groupId is required" });
                    return;
                }

                var worldId    = msg["worldId"]?.ToString() ?? "";
                var autoJoin   = msg["autoJoin"]?.Value<bool>() ?? true;
                var minCap     = msg["minCapacity"]?.Value<int>() ?? 0;
                var rawTypes   = (msg["accessTypes"] as JArray)?.Select(t => t.ToString()).ToList()
                              ?? new List<string>();

                StopLoop();
                _ = StartLoopAsync(new SnipeConfig
                {
                    GroupId     = groupId,
                    WorldId     = worldId,
                    AutoJoin    = autoJoin,
                    MinCapacity = minCap,
                    AccessTypes = rawTypes.Count > 0 ? rawTypes : null,
                });
                break;
            }

            case "vrcStopSnipe":
                StopLoop();
                _core.SendToJS("snipeStatus", new { active = false });
                break;

            case "vrcSnipeStatus":
                SendCurrentStatus();
                break;
        }

        await Task.CompletedTask;
    }

    private async Task StartLoopAsync(SnipeConfig cfg)
    {
        _cfg = cfg;
        _cts = new CancellationTokenSource();
        var ct = _cts.Token;

        _core.SendToJS("snipeStatus", new
        {
            active      = true,
            groupId     = cfg.GroupId,
            worldId     = cfg.WorldId,
            autoJoin    = cfg.AutoJoin,
            minCapacity = cfg.MinCapacity,
            accessTypes = cfg.AccessTypes,
        });

        _loopTask = Task.Run(async () =>
        {
            var known          = new HashSet<string>(StringComparer.Ordinal);
            bool baselineSet   = false;
            int  backoffMs     = 0;
            int  consecutiveErrors = 0;

            Log($"[SNIPE] Started — group={cfg.GroupId} world={cfg.WorldId} autoJoin={cfg.AutoJoin}");

            while (!ct.IsCancellationRequested)
            {
                try
                {
                    var waitMs = baselineSet ? PollIntervalMs + backoffMs : 0;
                    if (waitMs > 0) await Task.Delay(waitMs, ct);
                    if (ct.IsCancellationRequested) break;

                    var instances = await _core.Groups.GetGroupInstancesAsync(cfg.GroupId);
                    backoffMs = 0;
                    consecutiveErrors = 0;

                    if (!baselineSet)
                    {
                        baselineSet = true;
                        Log($"[SNIPE] Baseline: {instances.Count} existing instance(s) — showing immediately");
                    }

                    foreach (var inst in instances.Cast<JObject>())
                    {
                        var id = GetInstanceId(inst);
                        if (string.IsNullOrEmpty(id) || known.Contains(id)) continue;
                        known.Add(id);

                        var location   = inst["location"]?.ToString() ?? "";
                        var worldName  = inst["world"]?["name"]?.ToString() ?? "";
                        var worldId    = inst["world"]?["id"]?.ToString() ?? location.Split(':')[0];
                        var userCount  = inst["userCount"]?.Value<int>() ?? inst["n_users"]?.Value<int>() ?? 0;
                        var capacity   = inst["world"]?["capacity"]?.Value<int>() ?? 0;
                        var accessType = inst["type"]?.ToString()
                                      ?? InstanceController.ParseInstanceTypeFromLoc(location);

                        if (!string.IsNullOrEmpty(cfg.WorldId) &&
                            !worldId.Equals(cfg.WorldId, StringComparison.OrdinalIgnoreCase))
                        {
                            Log($"[SNIPE] Skipping {id} — world mismatch ({worldId})");
                            continue;
                        }

                        if (cfg.AccessTypes?.Count > 0 && !cfg.AccessTypes.Contains(accessType))
                        {
                            Log($"[SNIPE] Skipping {id} — access type '{accessType}' not in filter");
                            continue;
                        }

                        if (cfg.MinCapacity > 0 && capacity > 0 && capacity < cfg.MinCapacity)
                        {
                            Log($"[SNIPE] Skipping {id} — capacity {capacity} < minCapacity {cfg.MinCapacity}");
                            continue;
                        }

                        Log($"[SNIPE] New instance! {id} world='{worldName}' {userCount}/{capacity} type={accessType}");

                        _core.SendToJS("snipeFound", new
                        {
                            instanceId = id,
                            location,
                            worldName,
                            worldId,
                            userCount,
                            capacity,
                            accessType,
                        });

                        if (cfg.AutoJoin && !string.IsNullOrEmpty(location))
                            await TryJoinAsync(location, ct);
                    }
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex) when (IsRateLimit(ex))
                {
                    consecutiveErrors++;
                    backoffMs = Math.Min(BackoffStepMs * consecutiveErrors, BackoffMaxMs);
                    Log($"[SNIPE] Rate limited — backing off {backoffMs / 1000}s");
                    _core.SendToJS("snipeStatus", new
                    {
                        active      = true,
                        groupId     = cfg.GroupId,
                        rateLimited = true,
                        backoffMs,
                    });
                }
                catch (Exception ex)
                {
                    consecutiveErrors++;
                    Log($"[SNIPE] Poll error: {ex.Message}");
                    try { await Task.Delay(Math.Min(5000 * consecutiveErrors, 30_000), ct); } catch { break; }
                }
            }

            Log("[SNIPE] Loop ended");
        }, ct);

        try { await _loopTask; }
        catch (OperationCanceledException) { }
        catch (Exception ex) { Log($"[SNIPE] Loop task faulted: {ex.Message}"); }
    }

    private async Task TryJoinAsync(string location, CancellationToken ct)
    {
        if (ct.IsCancellationRequested) return;
        try
        {
            var vrcRunning = RelayController.IsVrcRunning();

            if (vrcRunning)
            {
                Log($"[SNIPE] VRChat running — sending self-invite to {location}");
                var ok = await _core.Instances.InviteSelfAsync(location);
                _core.SendToJS("snipeJoinResult", new { success = ok, location });
                if (!ok) Log($"[SNIPE] Self-invite failed for {location}");
            }
            else
            {
                Log($"[SNIPE] VRChat not running — launching via Steam URI for {location}");
                var uri = VRChatApiService.BuildLaunchUri(location);
#if WINDOWS
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName        = uri,
                    UseShellExecute = true,
                });
#else
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName        = "steam",
                    Arguments       = $"steam://rungameid/438100//{Uri.EscapeDataString(uri)}",
                    UseShellExecute = false,
                });
#endif
                _core.SendToJS("snipeJoinResult", new { success = true, location, method = "steamLaunch" });
            }
        }
        catch (Exception ex)
        {
            Log($"[SNIPE] TryJoin exception: {ex.Message}");
            _core.SendToJS("snipeJoinResult", new { success = false, location, error = ex.Message });
        }
    }

    private void StopLoop()
    {
        _cts?.Cancel();
        _cts?.Dispose();
        _cts = null;
        _cfg = null;
    }

    private void SendCurrentStatus()
    {
        if (_cfg != null && IsRunning)
            _core.SendToJS("snipeStatus", new
            {
                active      = true,
                groupId     = _cfg.GroupId,
                worldId     = _cfg.WorldId,
                autoJoin    = _cfg.AutoJoin,
                minCapacity = _cfg.MinCapacity,
                accessTypes = _cfg.AccessTypes,
            });
        else
            _core.SendToJS("snipeStatus", new { active = false });
    }

    private static string GetInstanceId(JToken inst)
        => inst["instanceId"]?.ToString() ?? inst["id"]?.ToString() ?? "";

    private static bool IsRateLimit(Exception ex)
        => ex.Message.Contains("429") || ex.Message.Contains("Too Many");

    private void Log(string msg)
        => _core.SendToJS("log", new { msg, color = "sec" });

    public void Dispose()
    {
        StopLoop();
        GC.SuppressFinalize(this);
    }

    private sealed class SnipeConfig
    {
        public string        GroupId     { get; init; } = "";
        public string        WorldId     { get; init; } = "";
        public bool          AutoJoin    { get; init; } = true;
        public int           MinCapacity { get; init; } = 0;
        public List<string>? AccessTypes { get; init; }
    }
}
