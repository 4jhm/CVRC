using Newtonsoft.Json.Linq;
using VRCNext.Services;
using VRCNext.Services.VRCNPlusAPI;

namespace VRCNext;

public class VRCNPlusController
{
    private readonly CoreLibrary _core;
    private readonly VRCNPlusService _service;
    private string _loggedEntitlementForUser = "";
    private readonly object _logGate = new();

    public VRCNPlusController(CoreLibrary core)
    {
        _core    = core;
        _service = new VRCNPlusService();
    }

    public async Task<(bool ok, string text)> RunAdminCommandAsync(string subcommand, string callerUserId, string targetUserId)
    {
        if (!Database.IsValidVrcUserId(targetUserId))
            return (false, $"Invalid target userId: '{targetUserId}'. Expected format usr_xxxxxxxx-...");
        var action = subcommand switch
        {
            "get" => "adminCheckPlus",
            "set" => "adminGrantPlus",
            "del" => "adminRevokePlus",
            _     => null,
        };
        if (action == null) return (false, $"Unknown subcommand: {subcommand}");

        var (ok, error, isPlus) = await _service.AdminCallAsync(action, callerUserId, targetUserId);
        if (!ok) return (false, $"[VRCN+] {subcommand} failed: {error}");

        return subcommand switch
        {
            "get" => (true, $"[VRCN+] {targetUserId} is {(isPlus == true ? "ACTIVE (VRCN+)" : "NOT a subscriber")}"),
            "set" => (true, $"[VRCN+] Granted VRCN+ to {targetUserId}"),
            "del" => (true, $"[VRCN+] Revoked VRCN+ from {targetUserId}"),
            _     => (true, ""),
        };
    }

    public void OnOwnUserKnown(string userId)
    {
        if (!Database.IsValidVrcUserId(userId)) return;
        lock (_logGate)
        {
            if (_loggedEntitlementForUser == userId) return;
            _loggedEntitlementForUser = userId;
        }
        _ = Task.Run(async () =>
        {
            try
            {
                var isPlus = await _service.CheckEntitlementAsync(userId);
                if (isPlus)
                    _core.SendToJS("log", new { msg = "[VRCN] - VRCN+ Active", color = "ok" });
                _core.SendToJS("vrcnPlusEntitlement", new { userId, isPlus });
            }
            catch { }
        });
    }

    public async Task HandleMessage(string action, JObject msg)
    {
        switch (action)
        {
            case "vrcnPlusCheckEntitlement": {
                var userId = msg["userId"]?.ToString() ?? "";
                if (!Database.IsValidVrcUserId(userId))
                {
                    _core.SendToJS("vrcnPlusEntitlement", new { userId, isPlus = false });
                    return;
                }
                var isPlus = await _service.CheckEntitlementAsync(userId);
                _core.SendToJS("vrcnPlusEntitlement", new { userId, isPlus });
                return;
            }

            case "vrcnPlusGetTheme": {
                var userId = msg["userId"]?.ToString() ?? "";
                if (!Database.IsValidVrcUserId(userId))
                {
                    _core.SendToJS("vrcnPlusTheme", new { userId, theme = (object?)null, source = "invalid" });
                    return;
                }

                var cached = _service.GetLocalTheme(userId);
                if (cached != null)
                    _core.SendToJS("vrcnPlusTheme", new {
                        userId,
                        theme  = cached,
                        source = "cache",
                    });

                var (fresh, isPlus) = await _service.FetchRemoteThemeAsync(userId);
                if (fresh != null)
                    _core.SendToJS("vrcnPlusTheme", new {
                        userId,
                        theme  = fresh,
                        source = "remote",
                    });
                if (isPlus.HasValue)
                    _core.SendToJS("vrcnPlusEntitlement", new { userId, isPlus = isPlus.Value });
                return;
            }

            case "vrcnPlusSaveTheme": {
                var userId = msg["userId"]?.ToString() ?? "";
                var colors = msg["colors"] as JObject;
                if (!Database.IsValidVrcUserId(userId) || colors == null)
                {
                    _core.SendToJS("log", new { msg = "[VRCN+] Save rejected: invalid request", color = "err" });
                    _core.SendToJS("vrcnPlusSaveResult", new { ok = false, error = "Invalid request." });
                    return;
                }
                var (ok, error, theme) = await _service.SaveRemoteThemeAsync(userId, colors);
                if (ok)
                    _core.SendToJS("log", new { msg = "[VRCN+] Profile theme saved", color = "ok" });
                else
                    _core.SendToJS("log", new { msg = $"[VRCN+] Save failed: {error}", color = "err" });
                _core.SendToJS("vrcnPlusSaveResult", new { ok, error, userId, theme });
                if (ok && theme != null)
                {
                    _core.SendToJS("vrcnPlusTheme", new { userId, theme, source = "self" });
                    _core.SendToJS("vrcnPlusEntitlement", new { userId, isPlus = true });
                }
                return;
            }

            case "vrcnPlusDeleteTheme": {
                var userId = msg["userId"]?.ToString() ?? "";
                if (!Database.IsValidVrcUserId(userId))
                {
                    _core.SendToJS("log", new { msg = "[VRCN+] Delete rejected: invalid userId", color = "err" });
                    _core.SendToJS("vrcnPlusSaveResult", new { ok = false, error = "Invalid userId." });
                    return;
                }
                var (ok, error) = await _service.DeleteRemoteThemeAsync(userId);
                if (ok)
                    _core.SendToJS("log", new { msg = "[VRCN+] Profile theme deleted", color = "ok" });
                else
                    _core.SendToJS("log", new { msg = $"[VRCN+] Delete failed: {error}", color = "err" });
                _core.SendToJS("vrcnPlusSaveResult", new { ok, error, userId, theme = (object?)null });
                if (ok)
                    _core.SendToJS("vrcnPlusTheme", new { userId, theme = (object?)null, source = "self" });
                return;
            }
        }
    }
}
