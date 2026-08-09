using Newtonsoft.Json.Linq;
using VRCNext.Services;

namespace VRCNext;

// "Avatar Database" tool — browses a Gofile folder of downloadable avatar files.
public class AvatarDatabaseController
{
    // https://gofile.io/d/dLV8UU
    private const string ContentId = "dLV8UU";

    private readonly CoreLibrary _core;
    private GofileService? _gofile;
    private List<GofileEntry>? _cachedEntries;
    private DateTime _cachedAt = DateTime.MinValue;

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
                    var url = msg["url"]?.ToString() ?? $"https://gofile.io/d/{ContentId}";
                    try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo { FileName = url, UseShellExecute = true }); }
                    catch (Exception ex) { _core.SendToJS("log", new { msg = $"[AvatarDb] Could not open link: {ex.Message}", color = "err" }); }
                }
                break;
        }
    }

    private async Task LoadAsync(bool force)
    {
        try
        {
            if (!force && _cachedEntries != null && (DateTime.UtcNow - _cachedAt).TotalMinutes < 10)
            {
                SendEntries(_cachedEntries);
                return;
            }

            _gofile ??= new GofileService(s => _core.SendToJS("log", new { msg = s, color = "sec" }));
            var entries = await _gofile.ListFolderAsync(ContentId);
            if (entries == null)
            {
                _core.SendToJS("avatarDbResult", new { ok = false, message = "Could not load the avatar database. Check the Activity Log for details." });
                return;
            }

            _cachedEntries = entries;
            _cachedAt = DateTime.UtcNow;
            SendEntries(entries);
        }
        catch (Exception ex)
        {
            _core.SendToJS("avatarDbResult", new { ok = false, message = $"Error: {ex.Message}" });
        }
    }

    private void SendEntries(List<GofileEntry> entries)
    {
        var files = entries
            .Where(e => e.Type == "file")
            .Select(e => new
            {
                name = e.Name,
                sizeBytes = e.SizeBytes,
                createTime = e.CreateTimeUnix,
                link = e.DownloadLink,
            })
            .ToList();
        _core.SendToJS("avatarDbResult", new { ok = true, files });
    }
}
