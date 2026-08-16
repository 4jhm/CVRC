using System.Diagnostics;
using Newtonsoft.Json.Linq;
using VRCNext.Services;
using VRCNext.Services.Helpers;

namespace VRCNext;

// Owns all Relay, VRCVideoCacher, VRChat launch, and WebSocket lifecycle state + logic.

public class RelayController : IDisposable
{
    private readonly CoreLibrary _core;
    private readonly FriendsController _friends;
    private readonly InstanceController _instance;
    private readonly NotificationsController _notifications;
    private readonly VROverlayController _vroCtrl;

    // Fields (moved from MainForm.Fields.cs)
    private bool _relayRunning;
    private DateTime _relayStart;
    private Process? _vcProcess;
    private VRChatWebSocketService? _wsService;

    // VRChat process monitor + startup-app tracking (Close / Start always with VRChat)
    private System.Threading.Timer? _vrcMonitorTimer;
    private bool _vrcWasRunning;
    private DateTime _vrcLaunchByUsAt = DateTime.MinValue;
    private readonly List<string> _launchedExeNames = new();
    private readonly object _launchedLock = new();

    // Sleep/wake detection + resume retry
    private System.Threading.Timer? _wakeTimer;
    private DateTime _lastWakeTick = DateTime.UtcNow;
    private int _resumeRetryCount;
    private const int WakeThresholdSec = 20;
    private const int MaxResumeRetries = 5;

    // Callback set by AuthController so RelayController can trigger re-auth without circular dep
    public Func<Task>? OnWakeResumeRequested { get; set; }

    public Action? OnAuthExpired { get; set; }

    // Public Accessors
    public bool IsRunning => _relayRunning;
    public DateTime RelayStart => _relayStart;
    public bool IsVcRunning => _vcProcess != null && !_vcProcess.HasExited;

    // Cross-domain callback (set by MainForm)
    public Action<JObject>? OnOwnUserUpdated { get; set; }

    public RelayController(
        CoreLibrary core,
        FriendsController friends,
        InstanceController instance,
        NotificationsController notifications,
        VROverlayController vroCtrl)
    {
        _core = core;
        _friends = friends;
        _instance = instance;
        _notifications = notifications;
        _vroCtrl = vroCtrl;

        // Timer fires every 10s; if actual elapsed > WakeThresholdSec the PC just woke from sleep
        _wakeTimer = new System.Threading.Timer(_ => CheckForWake(), null,
            TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(10));

        // Monitor VRChat process to drive "Close with VRChat" / "Start always with VRChat"
        _vrcWasRunning = IsVrcRunning();
        _vrcMonitorTimer = new System.Threading.Timer(_ => CheckVrcState(), null,
            TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(3));
    }

    private void CheckForWake()
    {
        var now  = DateTime.UtcNow;
        var gap  = (now - _lastWakeTick).TotalSeconds;
        _lastWakeTick = now;

        if (gap < WakeThresholdSec) return;

        _core.SendToJS("log", new { msg = $"[Wake] PC resumed from sleep (~{(int)gap}s gap) — reconnecting...", color = "sec" });

        // Restart WebSocket unconditionally — existing connection is dead
        if (_core.VrcApi.IsLoggedIn)
        {
            StartWebSocket();
            _ = Task.Run(async () =>
            {
                await Task.Delay(3000); // give network a moment
                if (!_core.VrcApi.IsLoggedIn) return;
                await _friends.RefreshFriendsAsync(true);
            });
        }
        else if (!string.IsNullOrEmpty(_core.Settings.ActiveAccount?.AuthCookie))
        {
            // Not logged in yet (startup resume failed) — retry now that network is up
            _resumeRetryCount = 0;
            _ = Task.Run(async () => { await Task.Delay(3000); await TryResumeWithRetryAsync(); });
        }
    }

    public void ScheduleResumeRetry()
    {
        _resumeRetryCount = 0;
        _ = Task.Run(async () => { await Task.Delay(8000); await TryResumeWithRetryAsync(); });
    }

    private async Task TryResumeWithRetryAsync()
    {
        if (_resumeRetryCount >= MaxResumeRetries) return;
        if (OnWakeResumeRequested == null) return;

        _resumeRetryCount++;
        _core.SendToJS("log", new { msg = $"[Wake] Resume attempt {_resumeRetryCount}/{MaxResumeRetries}...", color = "sec" });

        try { await OnWakeResumeRequested(); }
        catch { }
    }

    // Message Handler

    public void HandleMessage(string action, JObject msg)
    {
        switch (action)
        {
            case "startRelay":
                StartRelay();
                break;
            case "stopRelay":
                StopRelay();
                break;
            case "playVRChat":
            {
                var pvRunning = IsVrcRunning();
                var pvLoc = pvRunning ? (_core.LogWatcher?.CurrentLocation ?? "") : "";
                _core.SendToJS("vrcLaunchNeeded", new { location = pvLoc, steamVr = IsSteamVrRunning() });
                break;
            }
            case "vcCheck":
                _core.SendToJS("vcState", GetVcState());
                break;
            case "vcInstall":
                _ = InstallVcAsync();
                break;
            case "vcStart":
                StartVcProcess();
                break;
            case "vcStop":
                StopVcProcess();
                break;
            case "vrcLaunchAndJoin":
                {
                    var llLoc = msg["location"]?.ToString() ?? "";
                    var llVr  = msg["vr"]?.Value<bool>() ?? false;
#if WINDOWS
                    // Build args: --no-vr for Desktop mode, optional join URI, plus user-configured launch args
                    var joinUri2 = !string.IsNullOrEmpty(llLoc) ? VRChatApiService.BuildLaunchUri(llLoc) : "";
                    var noVrFlag = llVr ? "" : "--no-vr";
                    var llExtraArgs = (_core.Settings.VrcLaunchArgs ?? "").Trim();
                    var llProfileArg = GetVrcProfileArg();

                    // Always prefer steam.exe -applaunch so --no-vr is passed correctly.
                    // steam:// URL does NOT forward args to VRChat, causing SteamVR to open in Desktop mode.
                    var steamExe = FindSteamExe();
                    bool llLaunched = false;
                    if (steamExe != null)
                    {
                        var applaunchArgs = string.IsNullOrEmpty(joinUri2)
                            ? $"-applaunch 438100 {noVrFlag} {llProfileArg} {llExtraArgs}".Trim()
                            : $"-applaunch 438100 {noVrFlag} {llProfileArg} {llExtraArgs} \"{joinUri2}\"".Trim();
                        applaunchArgs = System.Text.RegularExpressions.Regex.Replace(applaunchArgs, "\\s+", " ");
                        try
                        {
                            Process.Start(new ProcessStartInfo
                            {
                                FileName = steamExe, Arguments = applaunchArgs,
                                UseShellExecute = false
                            });
                            llLaunched = true;
                        }
                        catch { }
                    }
                    if (!llLaunched)
                    {
                        // Fallback: direct exe path (user-configured)
                        var vrcExe = _core.Settings.VrcPath;
                        if (!string.IsNullOrWhiteSpace(vrcExe) && File.Exists(vrcExe))
                        {
                            var llArgs = string.IsNullOrEmpty(joinUri2)
                                ? $"{noVrFlag} {llProfileArg} {llExtraArgs}".Trim()
                                : $"{noVrFlag} {llProfileArg} {llExtraArgs} \"{joinUri2}\"".Trim();
                            llArgs = System.Text.RegularExpressions.Regex.Replace(llArgs, "\\s+", " ");
                            Process.Start(new ProcessStartInfo
                            {
                                FileName = vrcExe, Arguments = llArgs,
                                WorkingDirectory = Path.GetDirectoryName(vrcExe) ?? "",
                                UseShellExecute = false
                            });
                        }
                        else
                        {
                            _core.SendToJS("vrcActionResult", new { action = "join", success = false,
                                message = "Could not launch VRChat: Steam not found and no exe path configured." });
                            _core.SendToJS("log", new { msg = "Launch failed: steam.exe not found and VrcPath not set.", color = "err" });
                            break;
                        }
                    }
                    _vrcLaunchByUsAt = DateTime.UtcNow;
                    var llExtraApps = llVr ? _core.Settings.ExtraExeVR : _core.Settings.ExtraExeDesktop;
                    LaunchExtraApps(llExtraApps, log: true, vr: llVr);
#else
                    // On Linux, launch via Steam so Proton is applied automatically
                    var joinUriLnx   = !string.IsNullOrEmpty(llLoc) ? VRChatApiService.BuildLaunchUri(llLoc) : "";
                    var noVrFlagLnx  = llVr ? "" : "--no-vr";
                    var extraArgsLnx = (_core.Settings.VrcLaunchArgs ?? "").Trim();
                    var profileLnx   = GetVrcProfileArg();
                    var applaunchLnx = System.Text.RegularExpressions.Regex.Replace(
                        string.IsNullOrEmpty(joinUriLnx)
                            ? $"-applaunch 438100 {noVrFlagLnx} {profileLnx} {extraArgsLnx}"
                            : $"-applaunch 438100 {noVrFlagLnx} {profileLnx} {extraArgsLnx} \"{joinUriLnx}\"",
                        "\\s+", " ").Trim();
                    try
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = "steam",
                            Arguments = applaunchLnx,
                            UseShellExecute = false
                        });
                    }
                    catch
                    {
                        var steamUrl = string.IsNullOrEmpty(joinUriLnx)
                            ? "steam://rungameid/438100"
                            : $"steam://rungameid/438100//{Uri.EscapeDataString(joinUriLnx)}";
                        Process.Start(new ProcessStartInfo { FileName = steamUrl, UseShellExecute = true });
                    }
#endif
                    var modeLabel = llVr ? "VR" : "Desktop";
                    var locLabel  = !string.IsNullOrEmpty(llLoc) ? $" → {llLoc}" : "";
                    _core.SendToJS("vrcActionResult", new { action = "join", success = true, message = $"Launching VRChat ({modeLabel})..." });
                    _core.SendToJS("log", new { msg = $"Launched VRChat [{modeLabel}]{locLabel}", color = "ok" });
                    _core.SendToJS("vrcLaunched", new { vr = llVr });
                }
                break;

            case "vrcAccountsSaveLabel":
                {
                    var slot = msg["slot"]?.Value<int>() ?? -1;
                    var label = msg["label"]?.ToString() ?? "";
                    if (slot >= 0 && slot < 10)
                    {
                        var labels = GetVrcAccountLabels();
                        labels[slot] = label;
                        _core.Settings.VrcAccountLabels = labels;
                        _core.Settings.Save();
                    }
                }
                break;

            case "vrcAccountsLaunch":
                {
                    var slot = msg["slot"]?.Value<int>() ?? -1;
                    if (slot >= 0 && slot < 10) LaunchVRChatProfile(slot);
                }
                break;

            case "vrcAccountsSavePath":
                {
                    var slot = msg["slot"]?.Value<int>() ?? -1;
                    var path = msg["path"]?.ToString() ?? "";
                    if (slot >= 0 && slot < 10)
                    {
                        var paths = GetVrcAccountExePaths();
                        paths[slot] = path;
                        _core.Settings.VrcAccountExePaths = paths;
                        _core.Settings.Save();
                    }
                }
                break;

            case "vrcAccountsBrowsePath":
                {
                    var slot = msg["slot"]?.Value<int>() ?? -1;
                    if (slot < 0 || slot >= 10) break;
                    var r = NativeFileDialogSharp.Dialog.FileOpen("exe");
                    if (r.IsOk)
                    {
                        var paths = GetVrcAccountExePaths();
                        paths[slot] = r.Path;
                        _core.Settings.VrcAccountExePaths = paths;
                        _core.Settings.Save();
                        _core.SendToJS("vrcAccountsPathResult", new { slot, path = r.Path });
                    }
                }
                break;

            case "vrcAccountsSaveOffline":
                {
                    var slot = msg["slot"]?.Value<int>() ?? -1;
                    var offline = msg["offline"]?.Value<bool>() ?? false;
                    if (slot >= 0 && slot < 10)
                    {
                        var flags = GetVrcAccountOfflineFlags();
                        flags[slot] = offline;
                        _core.Settings.VrcAccountOfflineMode = flags;
                        _core.Settings.Save();
                    }
                }
                break;
        }
    }

    // Relay Control

    private void StartRelay()
    {
        var allFolders = _core.Settings.WatchFolders.Where(Directory.Exists).ToList();
        var enabledFilter = _core.Settings.RelayEnabledFolders;
        var folders = enabledFilter == null
            ? allFolders
            : allFolders.Where(f => enabledFilter.Contains(f, StringComparer.OrdinalIgnoreCase)).ToList();
        if (folders.Count == 0)
        {
            _core.SendToJS("log", new { msg = "No valid watch folders configured!", color = "err" });
            return;
        }
        var whs = _core.Settings.Webhooks.Where(w => w.Enabled && !string.IsNullOrWhiteSpace(w.Url)).ToList();
        if (whs.Count == 0)
        {
            _core.SendToJS("log", new { msg = "No webhooks active!", color = "err" });
            return;
        }

        _core.FileWatcher.Start(folders);
        _relayRunning = true;
        _relayStart = DateTime.Now;
        _vroCtrl.UpdateToolStates();

        _core.SendToJS("relayState", new { running = true, streams = whs.Count });
        _core.SendToJS("log", new { msg = "Relay started successfully", color = "ok" });
        foreach (var f in folders)
            _core.SendToJS("log", new { msg = $"  Watching: {f}", color = "sec" });
        foreach (var w in whs)
            _core.SendToJS("log", new { msg = $"  Webhook: {w.Name}", color = "accent" });
    }

    private void StopRelay()
    {
        _core.FileWatcher.Stop();
        _relayRunning = false;
        _vroCtrl.UpdateToolStates();

        _core.SendToJS("relayState", new { running = false, streams = 0 });
        _core.SendToJS("log", new { msg = "Relay stopped", color = "warn" });
    }

    // Toggle (called from VR overlay)

    public void ToggleRelay()
    {
        if (_relayRunning) StopRelay();
        else               StartRelay();
    }

    // VRCVideoCacher

    public static readonly string VcExePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "VRCNext", "Tools", "VRCVideoCacher", "VRCVideoCacher.exe");

    private object GetVcState()
    {
        bool installed = File.Exists(VcExePath);
        bool running   = _vcProcess != null && !_vcProcess.HasExited;
        return new { installed, running };
    }

    private void StartVcProcess()
    {
        if (!File.Exists(VcExePath)) return;
        if (_vcProcess != null && !_vcProcess.HasExited) return;

        try
        {
            _vcProcess = Process.Start(new ProcessStartInfo
            {
                FileName         = VcExePath,
                WorkingDirectory = Path.GetDirectoryName(VcExePath)!,
                UseShellExecute  = false,
                CreateNoWindow   = false,
            })!;
            _vcProcess.EnableRaisingEvents = true;
            _vcProcess.Exited += (_, _) =>
            {
                _vcProcess = null;
                try { Invoke(() => { _core.SendToJS("vcState", GetVcState()); _vroCtrl.UpdateToolStates(); }); } catch { }
            };
            _core.SendToJS("vcState", GetVcState());
            _vroCtrl.UpdateToolStates();
        }
        catch { }
    }

    private void StopVcProcess()
    {
        try { _vcProcess?.Kill(entireProcessTree: true); } catch { }
        _vcProcess = null;
        _core.SendToJS("vcState", GetVcState());
        _vroCtrl.UpdateToolStates();
    }

    private async Task InstallVcAsync()
    {
        try
        {
            Invoke(() => _core.SendToJS("vcState", new { installed = false, running = false, downloading = true, progress = 0 }));

            using var http = new System.Net.Http.HttpClient();
            http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", AppInfo.UserAgent);

            var apiResp = await http.GetAsync("https://api.github.com/repos/EllyVR/VRCVideoCacher/releases/latest");
            if (!apiResp.IsSuccessStatusCode)
            {
                Invoke(() => _core.SendToJS("vcState", new { installed = false, running = false, error = $"GitHub API: HTTP {(int)apiResp.StatusCode}" }));
                return;
            }

            var json     = JObject.Parse(await apiResp.Content.ReadAsStringAsync());
            var version  = json["tag_name"]?.ToString() ?? "?";
            var assets   = json["assets"] as JArray;
            var exeAsset = assets?.FirstOrDefault(a => a["name"]?.ToString().EndsWith(".exe") == true);
            var dlUrl    = exeAsset?["browser_download_url"]?.ToString();

            if (string.IsNullOrEmpty(dlUrl))
            {
                Invoke(() => _core.SendToJS("vcState", new { installed = false, running = false, error = "No .exe asset in latest release" }));
                return;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(VcExePath)!);

            using var dlResp = await http.GetAsync(dlUrl, System.Net.Http.HttpCompletionOption.ResponseHeadersRead);
            var total = dlResp.Content.Headers.ContentLength ?? -1L;
            await using var stream = await dlResp.Content.ReadAsStreamAsync();
            await using var fs     = File.Create(VcExePath);

            var buf        = new byte[65536];
            long downloaded = 0;
            int  read;
            while ((read = await stream.ReadAsync(buf)) > 0)
            {
                await fs.WriteAsync(buf.AsMemory(0, read));
                downloaded += read;
                if (total > 0)
                {
                    int pct = (int)(downloaded * 100 / total);
                    try { Invoke(() => _core.SendToJS("vcState", new { installed = false, running = false, downloading = true, progress = pct })); } catch { }
                }
            }

            Invoke(() =>
            {
                _core.SendToJS("vcState", GetVcState());
            });
        }
        catch (Exception ex)
        {
            try { Invoke(() => _core.SendToJS("vcState", new { installed = false, running = false, error = ex.Message })); } catch { }
        }
    }

    // Launch VRChat + extra apps

    private string GetVrcProfileArg()
    {
        var acc = _core.Settings.ActiveAccount;
        if (acc == null || acc.IsPrimary) return "";
        var extra = _core.Settings.VrcLaunchArgs ?? "";
        if (extra.IndexOf("--profile", StringComparison.OrdinalIgnoreCase) >= 0) return "";
        var before = acc.ProfileIndex;
        var idx = _core.Settings.EnsureProfileIndex(acc);
        if (idx != before) _core.Settings.Save();
        return $"--profile={idx}";
    }

    // Always exactly 10 entries — pads with "Account N" defaults and trims any excess.
    private List<string> GetVrcAccountLabels()
    {
        var labels = new List<string>(_core.Settings.VrcAccountLabels ?? new List<string>());
        while (labels.Count < 10) labels.Add($"Account {labels.Count + 1}");
        if (labels.Count > 10) labels = labels.Take(10).ToList();
        return labels;
    }

    // Always exactly 10 entries — pads with "" (falls back to the global VrcPath/auto-detect).
    private List<string> GetVrcAccountExePaths()
    {
        var paths = new List<string>(_core.Settings.VrcAccountExePaths ?? new List<string>());
        while (paths.Count < 10) paths.Add("");
        if (paths.Count > 10) paths = paths.Take(10).ToList();
        return paths;
    }

    // Always exactly 10 entries — pads with false.
    private List<bool> GetVrcAccountOfflineFlags()
    {
        var flags = new List<bool>(_core.Settings.VrcAccountOfflineMode ?? new List<bool>());
        while (flags.Count < 10) flags.Add(false);
        if (flags.Count > 10) flags = flags.Take(10).ToList();
        return flags;
    }

    // Launches a fresh, independent VRChat process on a specific "--profile=N" slot (0-9), each of
    // which VRChat treats as a fully separate local login session — this is what lets 10 buttons run
    // 10 concurrently logged-in accounts side by side. Always desktop mode: these are alt/bot
    // instances, not something you'd wear a headset for, and only one HMD session can be VR anyway.
    private void LaunchVRChatProfile(int slot)
    {
#if WINDOWS
        var offlineFlags = GetVrcAccountOfflineFlags();
        if (slot >= 0 && slot < offlineFlags.Count && offlineFlags[slot])
        {
            var labels0 = GetVrcAccountLabels();
            var label0 = slot >= 0 && slot < labels0.Count ? labels0[slot] : $"Account {slot + 1}";
            _ = Task.Run(async () =>
            {
                await EnsureSteamOfflineAsync(label0);
                LaunchVRChatProfileCore(slot);
            });
            return;
        }
#endif
        LaunchVRChatProfileCore(slot);
    }

    private void LaunchVRChatProfileCore(int slot)
    {
        var labels = GetVrcAccountLabels();
        var label = slot >= 0 && slot < labels.Count ? labels[slot] : $"Account {slot + 1}";
        try
        {
            var profileArg = $"--profile={slot}";
            var extraArgs = (_core.Settings.VrcLaunchArgs ?? "").Trim();
#if WINDOWS
            // Deliberately NOT using steam.exe -applaunch here: Steam treats an App ID as a
            // singleton and either no-ops or just refocuses the existing window instead of
            // spawning a second process, so it can't actually run concurrent instances. Launching
            // the game exe directly (bypassing Steam's launcher) is the only way multiple
            // "--profile=N" sessions can run side by side — same approach community multi-account
            // launcher scripts use.
            var exePaths = GetVrcAccountExePaths();
            var vrcPath = slot >= 0 && slot < exePaths.Count ? exePaths[slot] : "";
            if (string.IsNullOrWhiteSpace(vrcPath) || !File.Exists(vrcPath))
                vrcPath = _core.Settings.VrcPath;
            if (string.IsNullOrWhiteSpace(vrcPath) || !File.Exists(vrcPath))
                vrcPath = AuthController.DetectVrcLaunchExe();

            if (string.IsNullOrWhiteSpace(vrcPath) || !File.Exists(vrcPath))
            {
                _core.SendToJS("log", new { msg = "Could not launch VRChat: install not found. Set the VRChat exe path in Settings.", color = "err" });
                _core.SendToJS("vrcAccountsLaunchResult", new { slot, success = false });
                return;
            }
            var exeArgs = System.Text.RegularExpressions.Regex.Replace(
                $"--no-vr {profileArg} {extraArgs}", "\\s+", " ").Trim();
            Process.Start(new ProcessStartInfo
            {
                FileName = vrcPath, Arguments = exeArgs,
                WorkingDirectory = Path.GetDirectoryName(vrcPath) ?? "",
                UseShellExecute = false
            });
#else
            var applaunchLnx = System.Text.RegularExpressions.Regex.Replace(
                $"-applaunch 438100 --no-vr {profileArg} {extraArgs}", "\\s+", " ").Trim();
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "steam",
                    Arguments = applaunchLnx,
                    UseShellExecute = false
                });
            }
            catch
            {
                Process.Start(new ProcessStartInfo { FileName = "steam://rungameid/438100", UseShellExecute = true });
            }
#endif
            _core.SendToJS("log", new { msg = $"Launched VRChat — {label} (profile {slot})", color = "ok" });
            _core.SendToJS("vrcAccountsLaunchResult", new { slot, success = true });
        }
        catch (Exception ex)
        {
            _core.SendToJS("log", new { msg = $"Launch error ({label}): {ex.Message}", color = "err" });
            _core.SendToJS("vrcAccountsLaunchResult", new { slot, success = false });
        }
    }

    // Launches the configured startup apps and remembers them so they can be
    // closed again when "Close with VRChat" is enabled. Handles .exe, .lnk
    // shortcuts and .bat/.cmd scripts.
    //
    // Apps are launched through explorer.exe so they run detached, exactly like
    // a user double-click. Launching an app as a direct child process makes
    // Electron/Chromium apps (e.g. SlimeVR) exit immediately, while native apps
    // survive — which is why a direct Process.Start started Voicemeeter but not
    // SlimeVR.
    private void LaunchExtraApps(IEnumerable<string> apps, bool log, bool vr)
    {
        foreach (var raw in apps)
        {
            var path = (raw ?? "").Trim().Trim('"');
            if (string.IsNullOrEmpty(path)) continue;

            if (!File.Exists(path))
            {
                _core.SendToJS("log", new { msg = $"Startup app not found: {path}", color = "warn" });
                continue;
            }

            try
            {
#if WINDOWS
                var launchPath = path;
                if (path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                {
                    var lnk = AutoStartShortcutHelper.EnsureShortcut(path, vr);
                    if (!string.IsNullOrEmpty(lnk) && File.Exists(lnk)) launchPath = lnk;
                }

                Process.Start(new ProcessStartInfo
                {
                    FileName = "explorer.exe",
                    Arguments = $"\"{launchPath}\"",
                    UseShellExecute = false
                });
#else
                bool isExecutable = false;
                try { isExecutable = (File.GetUnixFileMode(path) & (UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute)) != 0; } catch { }
                if (isExecutable)
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = path,
                        WorkingDirectory = Path.GetDirectoryName(path) ?? "",
                        UseShellExecute = false
                    });
                }
                else
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = path,
                        UseShellExecute = true
                    });
                }
#endif
                var exeName = ResolveTargetExeName(path);
                if (!string.IsNullOrEmpty(exeName))
                    lock (_launchedLock)
                    {
                        if (!_launchedExeNames.Contains(exeName, StringComparer.OrdinalIgnoreCase))
                            _launchedExeNames.Add(exeName);
                    }

                if (log) _core.SendToJS("log", new { msg = $"Launched: {Path.GetFileName(path)}", color = "ok" });
            }
            catch (Exception ex)
            {
                _core.SendToJS("log", new { msg = $"Failed to launch {Path.GetFileName(path)}: {ex.Message}", color = "err" });
            }
        }
    }

    // Maps a configured startup-app path to the process name that will be
    // running (so Close-with-VRChat can find and stop it). Resolves .lnk
    // shortcuts to their target executable.
    private static string ResolveTargetExeName(string path)
    {
        try
        {
#if WINDOWS
            var ext = Path.GetExtension(path).ToLowerInvariant();
            if (ext == ".exe")
                return Path.GetFileNameWithoutExtension(path);
            if (ext == ".lnk")
            {
                var target = ResolveShortcutTarget(path);
                if (!string.IsNullOrEmpty(target) && target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                    return Path.GetFileNameWithoutExtension(target);
            }
#else
            return Path.GetFileNameWithoutExtension(path);
#endif
        }
        catch { }
        return "";
    }

#if WINDOWS
    private static string ResolveShortcutTarget(string lnkPath)
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
#endif

    // VRChat process monitor (Close / Start always with VRChat)

    private void CheckVrcState()
    {
        bool running;
        try { running = IsVrcRunning(); }
        catch { return; }
        if (running == _vrcWasRunning) return;
        _vrcWasRunning = running;

        LogVrcLaunchState(running);
        Invoke(() => _core.SendToJS("vrcRunningChanged", new { running }));

        if (running)
        {
            // VRChat just started. If we launched it ourselves the startup apps
            // were already handled by the launch path, so skip.
            bool launchedByUs = (DateTime.UtcNow - _vrcLaunchByUsAt).TotalSeconds < 120;
            _vrcLaunchByUsAt = DateTime.MinValue;
            if (launchedByUs) return;

            if (!_core.Settings.StartAlwaysWithVrc) return;

            bool vr = IsSteamVrRunning();
            var apps = vr ? _core.Settings.ExtraExeVR : _core.Settings.ExtraExeDesktop;
            Invoke(() =>
            {
                _core.SendToJS("log", new { msg = "VRChat started outside VRCNext — launching startup apps...", color = "sec" });
                LaunchExtraApps(apps, log: true, vr: vr);
                _core.SendToJS("vrcLaunched", new { vr });
            });
        }
        else
        {
            // VRChat just closed.
            if (_core.Settings.CloseWithVrc)
            {
                CloseTrackedExtraApps();
                Invoke(() => _core.SendToJS("vrcClosed", new { }));
            }
        }
    }

    private void LogVrcLaunchState(bool running)
    {
        Invoke(() => _core.LogSelfProfile?.Invoke("launch", "", running ? "start" : "stop"));
    }

    private void CloseTrackedExtraApps()
    {
        List<string> names;
        lock (_launchedLock)
        {
            names = new List<string>(_launchedExeNames);
            _launchedExeNames.Clear();
        }
        int closed = 0;
        foreach (var name in names)
        {
            try
            {
                foreach (var p in Process.GetProcessesByName(name))
                {
                    try { if (!p.HasExited) { p.Kill(entireProcessTree: true); closed++; } }
                    catch { }
                    finally { try { p.Dispose(); } catch { } }
                }
            }
            catch { }
        }
        if (closed > 0)
            Invoke(() => _core.SendToJS("log", new { msg = $"VRChat closed — closed {closed} startup app process(es).", color = "sec" }));
    }

    // Find steam.exe via registry (Windows only)

#if WINDOWS
    private static string? FindSteamExe()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\WOW6432Node\Valve\Steam")
                         ?? Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Valve\Steam");
            var installPath = key?.GetValue("InstallPath") as string;
            if (!string.IsNullOrEmpty(installPath))
            {
                var exe = Path.Combine(installPath, "steam.exe");
                if (File.Exists(exe)) return exe;
            }
        }
        catch { }
        // Fallback: common default paths
        foreach (var candidate in new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Steam", "steam.exe"),
            @"C:\Program Files\Steam\steam.exe"
        })
        {
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    // Starts Steam fresh in offline mode if it isn't already running. VRChat's own Steamworks
    // auth still needs the Steam client process alive in the background even though we launch
    // VRChat.exe directly (see LaunchVRChatProfileCore) — this just controls whether that
    // background client is online or offline. If Steam is already running online, it is
    // deliberately left alone rather than force-restarted, since that would kick out every other
    // Steam game/feature the user currently has open.
    private async Task EnsureSteamOfflineAsync(string label)
    {
        try
        {
            if (Process.GetProcessesByName("steam").Length > 0)
            {
                _core.SendToJS("log", new { msg = $"Steam is already running online — can't force offline mode for {label} without restarting Steam, so it was left as-is.", color = "sec" });
                return;
            }
            var steamExe = FindSteamExe();
            if (steamExe == null)
            {
                _core.SendToJS("log", new { msg = $"Offline mode requested for {label} but steam.exe could not be found.", color = "sec" });
                return;
            }
            Process.Start(new ProcessStartInfo { FileName = steamExe, Arguments = "-offline", UseShellExecute = true });
            _core.SendToJS("log", new { msg = $"Starting Steam in offline mode for {label}...", color = "sec" });
            await Task.Delay(4000); // give Steam a moment to initialize before launching VRChat
        }
        catch (Exception ex)
        {
            _core.SendToJS("log", new { msg = $"Could not start Steam in offline mode: {ex.Message}", color = "err" });
        }
    }
#endif

    // Static process checks

    public static bool IsVrcRunning()
    {
        try
        {
            bool Alive(Process p) { try { return !p.HasExited; } catch { return false; } }
            if (Process.GetProcessesByName("VRChat").Any(Alive)) return true;
#if !WINDOWS
            if (Process.GetProcessesByName("VRChat.exe").Any(Alive)) return true;
#endif
            return false;
        }
        catch { return false; }
    }

    public static bool IsSteamVrRunning()
    {
        try { return Process.GetProcessesByName("vrserver").Any(p => { try { return !p.HasExited; } catch { return false; } }); }
        catch { return false; }
    }

    // WebSocket lifecycle

    public void StopWebSocket()
    {
        _wsService?.Stop();
    }

    public void StartWebSocket()
    {
        var (auth, tfa) = _core.VrcApi.GetCookies();
        if (string.IsNullOrEmpty(auth)) return;

        _wsService?.Dispose();
        _wsService = new VRChatWebSocketService();

        // Wire all friend-related WebSocket events to FriendsController
        _friends.WireWebSocket(_wsService);

        // Wire all notification-related WebSocket events to NotificationsController
        _notifications.WireWebSocket(_wsService);

        _wsService.AuthExpiredSuspected += (_, _) => Invoke(() => OnAuthExpired?.Invoke());

        // Small delay so the VRC API reflects the new location before we query it
        _wsService.OwnLocationChanged += (_, _) =>
        {
            if (_core.VrcApi.IsLoggedIn)
                _ = Task.Delay(3000).ContinueWith(_ => _instance.GetCurrentInstanceAsync());
        };

        // user-update: own profile changed in-game (status, bio, statusDescription, tags, icon…)
        // The WS payload is partial (no pronouns/bioLinks), so fetch the full user from REST
        // then push everything to JS in one shot — sidebar, modal, Discord presence all update.
        _wsService.OwnUserUpdated += (_, _) =>
        {
            if (!_core.VrcApi.IsLoggedIn) return;
            _ = Task.Run(async () =>
            {
                var full = await _core.Auth.RefreshCurrentUserAsync();
                if (full != null)
                    Invoke(() => OnOwnUserUpdated?.Invoke(full));
            });
        };

        // All log calls must use Invoke(); these fire on the WebSocket background thread
        _wsService.Connected += (_, _) =>
        {
            Invoke(() =>
            {
                _core.SendToJS("wsStatus", new { connected = true });
                _core.SendToJS("log", new { msg = "[WS] Connected to pipeline.vrchat.cloud", color = "ok" });
            });
        };

        _wsService.Disconnected += (_, _) =>
        {
            Invoke(() =>
            {
                _core.SendToJS("wsStatus", new { connected = false });
                _core.SendToJS("log", new { msg = "[WS] Disconnected — reconnecting...", color = "warn" });
            });
        };

        // Real connection failure (not watchdog idle-timeout "No data for Xs") → one REST fallback.
        // Watchdog aborts the socket after 75s of silence and reconnects automatically — no REST needed.
        _wsService.ConnectError += (_, err) =>
        {
            Invoke(() => _core.SendToJS("log", new { msg = $"[WS] Error: {err}", color = "err" }));
            if (!err.StartsWith("No data for") && _core.VrcApi.IsLoggedIn)
            {
                _ = _friends.RefreshFriendsAsync(true);
                _ = _notifications.GetNotificationsAsync();
            }
        };

        // Pass a delegate so the service fetches fresh cookies on every internal reconnect
        _wsService.Start(auth, tfa ?? "", () =>
        {
            var (a, t) = _core.VrcApi.GetCookies();
            return (a ?? "", t ?? "");
        });
    }

    // Disposal

    public void Dispose()
    {
        _wakeTimer?.Dispose();
        _wakeTimer = null;
        _vrcMonitorTimer?.Dispose();
        _vrcMonitorTimer = null;
        try { _vcProcess?.Kill(entireProcessTree: true); } catch { }
        _wsService?.Dispose();
    }

    // Photino compatibility shim
    private static void Invoke(Action action) => action();
}
