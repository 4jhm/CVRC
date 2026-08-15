using Newtonsoft.Json.Linq;
using VRCNext.Services;

namespace VRCNext;

// Avatar Logger — watches for freshly-downloaded VRChat avatars and posts them to
// Discord/GoFile. A native rebuild of the standalone "VRC Avatar Logger" personal
// project, reusing CVRC's own webhook/GoFile/log-watching plumbing instead of
// launching it as an external subprocess.
public class AvatarLoggerController
{
    private readonly CoreLibrary _core;
    private readonly Action<Action> _invoke;
    private AvatarLoggerService? _service;

    public AvatarLoggerController(CoreLibrary core, Action<Action> invoke)
    {
        _core = core;
        _invoke = invoke;
    }

    private AvatarLoggerService Service => _service ??= new AvatarLoggerService(
        _core,
        s => _invoke(() => _core.SendToJS("log", new { msg = $"[AvatarLogger] {s}", color = "sec" })),
        entry => _invoke(() => _core.SendToJS("avatarLoggerEvent", ToJs(entry))));

    public void HandleMessage(string action, JObject msg)
    {
        switch (action)
        {
            case "avlogConfig":
            {
                var enabled = msg["enabled"]?.Value<bool>() ?? false;
                _core.Settings.AvlogEnabled          = enabled;
                _core.Settings.AvlogWebhookUrl        = msg["webhookUrl"]?.ToString() ?? "";
                _core.Settings.AvlogMinSizeMb         = msg["minSizeMb"]?.Value<double>() ?? 15;
                _core.Settings.AvlogAutoUpload        = msg["autoUpload"]?.Value<bool>() ?? false;
                _core.Settings.AvlogAutoUploadMinMb   = msg["autoUploadMinMb"]?.Value<double>() ?? 15;
                _core.Settings.AvlogDeliveryMode      = msg["deliveryMode"]?.ToString() ?? "discord";
                _core.Settings.AvlogMaxAttachmentMb   = msg["maxAttachmentMb"]?.Value<double>() ?? 25;
                _core.Settings.AvlogGofileToken       = msg["gofileToken"]?.ToString() ?? "";
                _core.Settings.AvlogGofileFolder      = msg["gofileFolder"]?.ToString() ?? "";
                _core.Settings.AvlogLogMySwitches     = msg["logMySwitches"]?.Value<bool>() ?? true;
                _core.Settings.AvlogIgnorePeople      = msg["ignorePeople"]?.ToObject<List<string>>() ?? new();
                _core.Settings.AvlogLocalArchivePath  = msg["localArchivePath"]?.ToString() ?? "";
                _core.Settings.AvlogCachePathOverride = msg["cachePathOverride"]?.ToString() ?? "";
                _core.Settings.AvlogCacheFileName     = msg["cacheFileName"]?.ToString()?.Trim() ?? "";
                _core.Settings.Save();

                try { if (enabled) Service.Start(); else Service.Stop(); }
                catch (Exception ex)
                {
                    CrashHandler.WriteEntry("AvatarLoggerController.avlogConfig", ex);
                    _core.SendToJS("toast", new { ok = false, msg = $"Avatar Logger failed to start: {ex.Message}" });
                }
                SendStatus();
                break;
            }

            case "avlogStatus":
                SendStatus();
                break;

            case "avlogClearSeen":
                Service.ClearSeen();
                _core.SendToJS("toast", new { ok = true, msg = "Cleared — previously-logged avatars will be logged again." });
                break;

            case "avlogGetHistory":
                _core.SendToJS("avatarLoggerHistory", new { entries = Service.History.Select(ToJs).ToList() });
                break;

            case "avlogManualUpload":
            {
                var key = msg["key"]?.ToString() ?? "";
                var entry = Service.FindEntry(key);
                if (entry == null) break;
                _ = Task.Run(async () =>
                {
                    await Service.DeliverAsync(entry);
                    _invoke(() => _core.SendToJS("avatarLoggerEvent", ToJs(entry)));
                });
                break;
            }

            case "avlogUploadToFiles":
            {
                var key = msg["key"]?.ToString() ?? "";
                var entry = Service.FindEntry(key);
                if (entry == null) break;
                var (ok, message) = Service.ManualArchiveToFiles(entry);
                _core.SendToJS("toast", new { ok, msg = message });
                break;
            }

            case "avlogTestWebhook":
            {
                var url = msg["webhookUrl"]?.ToString() ?? _core.Settings.AvlogWebhookUrl;
                if (string.IsNullOrEmpty(url)) { _core.SendToJS("toast", new { ok = false, msg = "No webhook URL set." }); break; }
                _ = Task.Run(async () =>
                {
                    try
                    {
                        var json = "{\"embeds\":[{\"title\":\"Test Avatar\",\"description\":\"CVRC Avatar Logger wiring works.\",\"color\":1802495}]}";
                        var result = await _core.Webhook.PostJsonAsync(url, json);
                        _invoke(() => _core.SendToJS("toast", new { ok = result.Success, msg = result.Success ? "Test embed sent!" : $"Failed: {result.Error}" }));
                    }
                    catch (Exception ex)
                    {
                        CrashHandler.WriteEntry("AvatarLoggerController.avlogTestWebhook", ex);
                        _invoke(() => _core.SendToJS("toast", new { ok = false, msg = $"Test webhook error: {ex.Message}" }));
                    }
                });
                break;
            }

            case "avlogBrowseCachePath":
            {
                var defaultDir = _core.Settings.AvlogCachePathOverride;
                if (string.IsNullOrWhiteSpace(defaultDir) || !Directory.Exists(defaultDir))
                    defaultDir = VRCNext.Services.Helpers.VrcPathsHelper.AppDataDir();
                var r = NativeFileDialogSharp.Dialog.FolderPicker(defaultDir);
                if (r.IsOk) _core.SendToJS("avlogCachePathResult", r.Path);
                break;
            }
        }
    }

    private void SendStatus()
    {
        _core.SendToJS("avatarLoggerStatus", new
        {
            available = true,
            running = _service?.IsRunning ?? false,
            enabled = _core.Settings.AvlogEnabled,
            webhookUrl = _core.Settings.AvlogWebhookUrl,
            minSizeMb = _core.Settings.AvlogMinSizeMb,
            autoUpload = _core.Settings.AvlogAutoUpload,
            autoUploadMinMb = _core.Settings.AvlogAutoUploadMinMb,
            deliveryMode = _core.Settings.AvlogDeliveryMode,
            maxAttachmentMb = _core.Settings.AvlogMaxAttachmentMb,
            gofileToken = _core.Settings.AvlogGofileToken,
            gofileFolder = _core.Settings.AvlogGofileFolder,
            logMySwitches = _core.Settings.AvlogLogMySwitches,
            ignorePeople = _core.Settings.AvlogIgnorePeople,
            localArchivePath = _core.Settings.AvlogLocalArchivePath,
            cachePathOverride = _core.Settings.AvlogCachePathOverride,
            cacheFileName = _core.Settings.AvlogCacheFileName,
        });
    }

    private static object ToJs(AvatarLogEntry e) => new
    {
        key = e.Key,
        whenIso = e.When.ToString("o"),
        name = e.Name,
        author = e.Author,
        wearer = e.Wearer,
        sizeMb = e.SizeMb,
        thumbUrl = e.ThumbUrl,
        avatarId = e.AvatarId,
        visibility = e.Visibility,
        downloadLink = e.DownloadLink,
        cachePath = e.CachePath,
        status = e.Status,
        note = e.Note,
        uploadProgress = e.UploadProgress,
    };

    // Called on app shutdown so the background tail loop stops cleanly.
    public void Shutdown() => _service?.Stop();
}
