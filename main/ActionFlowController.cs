using Newtonsoft.Json.Linq;
using VRCNext.Services;
using VRCNext.Services.Helpers;

namespace VRCNext;

public class ActionFlowController : IDisposable
{
    private readonly CoreLibrary _core;
    private ActionFlowSettings   _settings;

#if WINDOWS
    public Func<SystemTrayService?>? TrayServiceProvider { get; set; }
#endif

    public ActionFlowController(CoreLibrary core)
    {
        _core = core;
        _settings = ActionFlowSettings.Load();
    }

    public void HandleMessage(string action, JObject msg)
    {
        switch (action)
        {
            case "afLoadFlows":
            {

                var arr = new JArray();
                foreach (var f in _settings.Flows)
                {
                    arr.Add(new JObject {
                        ["id"]        = f.Id,
                        ["name"]      = f.Name,
                        ["enabled"]   = f.Enabled,
                        ["workspace"] = f.Workspace,
                        ["createdAt"] = f.CreatedAt,
                        ["updatedAt"] = f.UpdatedAt,
                    });
                }
                _core.SendToJS("afFlows", new {
                    flows             = arr,
                    conditions        = _settings.Conditions,
                    conditionDefaults = _settings.ConditionDefaults,
                });
                break;
            }

            case "afSaveConditions":
            {
                var conds  = msg["conditions"]?.ToObject<Dictionary<string, bool>>();
                var defs   = msg["defaults"]?.ToObject<Dictionary<string, bool>>();
                if (conds != null) _settings.Conditions = conds;
                if (defs  != null) _settings.ConditionDefaults = defs;
                _settings.Save();
                if (_settings.LastSaveError != null)
                    _core.SendToJS("log", new { msg = "[ActionFlow] conditions save failed: " + _settings.LastSaveError, color = "err" });
                break;
            }

            case "afSaveFlows":
            {
                var arr = msg["flows"] as JArray;
                if (arr == null) {
                    _core.SendToJS("afSaveResult", new { ok = false, error = "missing flows" });
                    _core.SendToJS("log", new { msg = "[ActionFlow] save rejected: missing flows", color = "err" });
                    break;
                }

                try
                {
                    _settings.Flows = arr.ToObject<List<ActionFlowSettings.ActionFlow>>() ?? new();
                }
                catch (Exception ex)
                {
                    _core.SendToJS("afSaveResult", new { ok = false, error = "parse: " + ex.Message });
                    _core.SendToJS("log", new { msg = "[ActionFlow] save parse error: " + ex.Message, color = "err" });
                    break;
                }

                _settings.Save();
                if (_settings.LastSaveError != null)
                {
                    _core.SendToJS("afSaveResult", new { ok = false, error = _settings.LastSaveError });
                    _core.SendToJS("log", new { msg = "[ActionFlow] save failed: " + _settings.LastSaveError, color = "err" });
                }
                else
                {
                    var nonEmpty = _settings.Flows.Count(f => f.Workspace != null && f.Workspace.HasValues);
                    _core.SendToJS("afSaveResult", new { ok = true, count = _settings.Flows.Count, nonEmpty });
                }
                break;
            }

            case "afTrayNotify":
            {
                var title    = msg["title"]?.ToString()    ?? "Action Flow";
                var subtitle = msg["subtitle"]?.ToString() ?? "";
                var accent   = msg["accent"]?.ToString()   ?? "info";

#if WINDOWS
                var tray = TrayServiceProvider?.Invoke();
                tray?.ShowNotification(title, subtitle, "", accent);
#endif
                break;
            }

            case "afGetGameRunning":
            {
                var running = _core.IsVrcRunning?.Invoke() ?? false;
                _core.SendToJS("afGameRunning", new { running });
                break;
            }

            case "afInstanceWebhook":
            {
                var url = msg["url"]?.ToString();
                if (string.IsNullOrWhiteSpace(url) || !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) break;
                var scope         = msg["scope"]?.ToString() ?? "own";
                var advanced      = msg["advanced"]?.Value<bool>() ?? false;
                var worldId       = msg["worldId"]?.ToString() ?? "";
                var worldName     = msg["worldName"]?.ToString() ?? "";
                var typeLabel     = msg["instanceTypeLabel"]?.ToString() ?? "";
                var authorName    = msg["authorName"]?.ToString() ?? "";
                var authorUserId  = msg["authorUserId"]?.ToString() ?? "";
                var authorIconUrl = msg["authorIconUrl"]?.ToString() ?? "";
                var capacity      = msg["capacity"]?.Value<int>() ?? 0;

                _ = Task.Run(async () =>
                {
                    try
                    {
                        static string ExtOrPng(string p)
                        {
                            var e = Path.GetExtension(p);
                            return string.IsNullOrEmpty(e) ? ".png" : e;
                        }

                        var lines = new List<string>();
                        if (!string.IsNullOrEmpty(typeLabel)) lines.Add($"**Instance Type:** {typeLabel}");

                        if (scope == "own")
                        {
                            var players = _core.LogWatcher.GetCurrentPlayers().OrderBy(p => p.JoinedAt).ToList();
                            int count = players.Count;
                            lines.Add($"**Players:** {(capacity > 0 ? $"{count}/{capacity}" : count.ToString())}");
                            if (advanced && count > 0)
                            {
                                lines.Add("");
                                lines.Add($"**Players in Instance ({count})**");
                                lines.AddRange(players.Select(p => p.DisplayName));
                            }
                        }

                        var description = string.Join("\n", lines);
                        if (description.Length > 4000) description = description[..4000];

                        var embed = new JObject
                        {
                            ["color"]     = 10459903,
                            ["timestamp"] = DateTime.UtcNow.ToString("o"),
                        };
                        if (!string.IsNullOrEmpty(worldName))   embed["title"]       = $"Joined \"{worldName}\"";
                        if (!string.IsNullOrEmpty(description))  embed["description"] = description;

                        var attachments = new List<(string, string)>();

                        var worldFile = string.IsNullOrEmpty(worldId) ? null : ImageCacheHelper.GetWorldCached(worldId);
                        if (worldFile != null && File.Exists(worldFile))
                        {
                            var wn = "world" + ExtOrPng(worldFile);
                            embed["thumbnail"] = new JObject { ["url"] = "attachment://" + wn };
                            attachments.Add((worldFile, wn));
                        }

                        if (!string.IsNullOrEmpty(authorName))
                        {
                            var author = new JObject { ["name"] = authorName };
                            var iconFile = string.IsNullOrEmpty(authorUserId) ? null : ImageCacheHelper.GetUserCached(authorUserId);
                            if (iconFile == null && !string.IsNullOrEmpty(authorUserId)
                                && authorIconUrl.StartsWith("http", StringComparison.OrdinalIgnoreCase))
                            {
                                try { iconFile = await ImageCacheHelper.CacheUserAsync(authorUserId, authorIconUrl); } catch { }
                            }
                            if (iconFile != null && File.Exists(iconFile))
                            {
                                var inm = "icon" + ExtOrPng(iconFile);
                                author["icon_url"] = "attachment://" + inm;
                                attachments.Add((iconFile, inm));
                            }
                            else if (authorIconUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                            {
                                author["icon_url"] = authorIconUrl;
                            }
                            embed["author"] = author;
                        }

                        var payload = new JObject
                        {
                            ["embeds"] = new JArray { embed },
                        };

                        var json = payload.ToString(Newtonsoft.Json.Formatting.None);
                        var res = attachments.Count > 0
                            ? await _core.Webhook.PostEmbedWithFilesAsync(url, json, attachments)
                            : await _core.Webhook.PostJsonAsync(url, json);
                        if (!res.Success)
                            _core.SendToJS("log", new { msg = "[ActionFlow] webhook send failed: " + res.Error, color = "err" });
                    }
                    catch (Exception ex)
                    {
                        _core.SendToJS("log", new { msg = "[ActionFlow] webhook error: " + ex.Message, color = "err" });
                    }
                });
                break;
            }

            case "afSendChatMessage":
            {
                var uid       = msg["userId"]?.ToString();
                var text      = msg["text"]?.ToString();
                var notifId   = msg["notificationId"]?.ToString();
                var notifType = msg["notifType"]?.ToString();
                if (string.IsNullOrEmpty(uid) || string.IsNullOrEmpty(text)) break;
                _ = Task.Run(async () =>
                {
                    if (!string.IsNullOrEmpty(notifId) && !string.IsNullOrEmpty(notifType))
                    {
                        var (ok, err) = await _core.Invite.RespondToNotificationAsync(notifId, notifType, text);
                        if (!ok) _core.SendToJS("log", new { msg = "[ActionFlow] reply failed → " + uid + ": " + err, color = "err" });
                    }
                    else
                    {
                        var (ok, err, _) = await _core.Invite.SendChatMessageDedupedAsync(uid, text);
                        if (!ok) _core.SendToJS("log", new { msg = "[ActionFlow] chat send failed → " + uid + ": " + err, color = "err" });
                    }
                });
                break;
            }
        }
    }

    public void Dispose()
    {
        GC.SuppressFinalize(this);
    }
}
