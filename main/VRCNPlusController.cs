using Newtonsoft.Json.Linq;
using VRCNext.Services;
using VRCNext.Services.VRCNPlusAPI;

namespace VRCNext;

public class VRCNPlusController
{
    private readonly CoreLibrary _core;
    private readonly VRCNPlusService _service;

    public VRCNPlusController(CoreLibrary core)
    {
        _core    = core;
        _service = new VRCNPlusService();
    }

    public Task HandleMessage(string action, JObject msg)
    {
        switch (action)
        {
            case "vrcnPlusGetTheme": {
                var userId = msg["userId"]?.ToString() ?? "";
                if (!Database.IsValidVrcUserId(userId))
                {
                    _core.SendToJS("vrcnPlusTheme", new { userId, theme = (object?)null, source = "invalid" });
                    break;
                }

                var cached = _service.GetLocalTheme(userId);
                _core.SendToJS("vrcnPlusTheme", new {
                    userId,
                    theme  = cached,
                    source = "local",
                });
                break;
            }

            case "vrcnPlusSaveTheme": {
                var userId = msg["userId"]?.ToString() ?? "";
                var colors = msg["colors"] as JObject;
                if (!Database.IsValidVrcUserId(userId) || colors == null)
                {
                    _core.SendToJS("log", new { msg = "[VRCN+] Save rejected: invalid request", color = "err" });
                    _core.SendToJS("vrcnPlusSaveResult", new { ok = false, error = "Invalid request." });
                    break;
                }
                var (ok, error, theme) = _service.SaveLocalTheme(userId, colors);
                if (ok)
                    _core.SendToJS("log", new { msg = "[VRCN+] Profile theme saved", color = "ok" });
                else
                    _core.SendToJS("log", new { msg = $"[VRCN+] Save failed: {error}", color = "err" });
                _core.SendToJS("vrcnPlusSaveResult", new { ok, error, userId, theme });
                if (ok && theme != null)
                    _core.SendToJS("vrcnPlusTheme", new { userId, theme, source = "self" });
                break;
            }
        }
        return Task.CompletedTask;
    }
}
