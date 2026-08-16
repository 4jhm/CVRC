using Newtonsoft.Json.Linq;
using VRCNext.Services;

namespace VRCNext;

// Owns all Chatbox + OSC state, logic, and message handling.

public class ChatboxController : IDisposable
{
    private readonly CoreLibrary _core;
    private readonly VROverlayController _vroCtrl;

    // Fields (moved from MainForm.Fields.cs)
    private ChatboxService? _chatbox;
    private OscService? _osc;
    private bool _typingIndicatorOn;
    private int _lastEmoteTick;
    private const int EMOTE_COOLDOWN_MS = 2000;
    private const int EMOTE_RESET_DELAY_MS = 500;

    // Public Accessors (for other domains)
    public bool IsEnabled => _chatbox?.Enabled ?? false;
    public OscService? Osc => _osc;

    public ChatboxController(CoreLibrary core, VROverlayController vroCtrl)
    {
        _core = core;
        _vroCtrl = vroCtrl;
        _core.OnChatboxPauseRequest = ms => _chatbox?.PauseDirectSend(ms);
        _core.OnPlayerJoinLeft = (name, joined) => _chatbox?.NotifyPlayerJoinLeave(name, joined);
        _vroCtrl.OnExpressionSend  += (name, type, value) => SendOscParamValue(name, type, value);
        _vroCtrl.OnExpressionEmote += emote => TriggerEmoteInternal(emote);
    }

    // Message Handler

    public void HandleMessage(string action, JObject msg)
    {
        switch (action)
        {
            case "chatboxConfig":
                {
                    _chatbox ??= new ChatboxService(s => Invoke(() => _core.SendToJS("log", new { msg = s, color = "sec" })));
                    _chatbox.SetUpdateCallback(data => {
                        try { Invoke(() => _core.SendToJS("chatboxUpdate", data)); } catch (Exception ex) { CrashHandler.WriteEntry("Chatbox.SetUpdateCallback", ex); }
#if WINDOWS
                        try
                        {
                            var d = JObject.FromObject(data);
                            var title   = d["currentTitle"]?.ToString() ?? "";
                            var artist  = d["currentArtist"]?.ToString() ?? "";
                            var posMs   = d["positionMs"]?.Value<double>() ?? 0;
                            var durMs   = d["durationMs"]?.Value<double>() ?? 0;
                            var playing = d["isPlaying"]?.Value<bool>() ?? false;
                            if (!string.IsNullOrEmpty(title))
                                _core.VrOverlay?.UpdateMediaInfo(title, artist, posMs / 1000.0, durMs / 1000.0, playing);
                        }
                        catch (Exception ex) { CrashHandler.WriteEntry("Chatbox.UpdateMediaInfo", ex); }
#endif
                    });

                    var enabled = msg["enabled"]?.Value<bool>() ?? false;
                    var showTime = msg["showTime"]?.Value<bool>() ?? true;
                    var showMedia = msg["showMedia"]?.Value<bool>() ?? true;
                    var showPlaytime = msg["showPlaytime"]?.Value<bool>() ?? true;
                    var showCustomText = msg["showCustomText"]?.Value<bool>() ?? true;
                    var showSystemStats = msg["showSystemStats"]?.Value<bool>() ?? false;
                    var showAfk = msg["showAfk"]?.Value<bool>() ?? false;
                    var afkMessage = msg["afkMessage"]?.ToString() ?? "Currently AFK";
                    var suppressSound = msg["suppressSound"]?.Value<bool>() ?? true;
                    var timeFormat = msg["timeFormat"]?.ToString() ?? "hh:mm tt";
                    var separator = msg["separator"]?.ToString() ?? " | ";
                    var intervalMs = msg["intervalMs"]?.Value<int>() ?? 5000;
                    var customLines = msg["customLines"]?.ToObject<List<string>>() ?? new();
                    var hideBackground = msg["hideBackground"]?.Value<bool>() ?? false;
                    var mediaSource = msg["mediaSource"]?.ToString() ?? "";
                    var hideNameEnabled = msg["hideNameEnabled"]?.Value<bool>() ?? false;
                    var hideNameText = msg["hideNameText"]?.ToString() ?? "CVRC";
                    var showJoinLeaveLog = msg["showJoinLeaveLog"]?.Value<bool>() ?? false;

                    _chatbox.ApplyConfig(enabled, showTime, showMedia, showPlaytime,
                        showCustomText, showSystemStats, showAfk, afkMessage,
                        suppressSound, timeFormat, separator, intervalMs, customLines, hideBackground, mediaSource,
                        hideNameEnabled, hideNameText, showJoinLeaveLog);
                    _vroCtrl.UpdateToolStates();

                    // Persist chatbox settings
                    _core.Settings.CbShowTime = showTime;
                    _core.Settings.CbShowMedia = showMedia;
                    _core.Settings.CbShowPlaytime = showPlaytime;
                    _core.Settings.CbShowCustomText = showCustomText;
                    _core.Settings.CbShowSystemStats = showSystemStats;
                    _core.Settings.CbShowAfk = showAfk;
                    _core.Settings.CbAfkMessage = afkMessage;
                    _core.Settings.CbSuppressSound = suppressSound;
                    _core.Settings.CbTimeFormat = timeFormat;
                    _core.Settings.CbSeparator = separator;
                    _core.Settings.CbIntervalMs = intervalMs;
                    _core.Settings.CbCustomLines = customLines;
                    _core.Settings.CbHideBackground = hideBackground;
                    _core.Settings.CbMediaSource = mediaSource;
                    _core.Settings.CbHideNameEnabled = hideNameEnabled;
                    _core.Settings.CbHideNameText = hideNameText;
                    _core.Settings.CbShowJoinLeaveLog = showJoinLeaveLog;
                    _core.Settings.Save();
                    if (_core.Settings.LastSaveError != null)
                        _core.SendToJS("toast", new { ok = false, msg = "Failed to save this setting, please report this error" });
                    else
                        _core.SendToJS("toast", new { ok = true, msg = "Saved" });
                }
                break;

            case "chatboxGetMediaSources":
                {
#if WINDOWS
                    var svc = _chatbox ?? new ChatboxService(_ => { });
                    _ = Task.Run(async () =>
                    {
                        var sources = await svc.GetAvailableMediaSourcesAsync();
                        var list = sources.Select(s => new { id = s.Id, title = s.Title, artist = s.Artist }).ToList();
                        Invoke(() => _core.SendToJS("chatboxMediaSources", new { sources = list }));
                    });
#else
                    _core.SendToJS("chatboxMediaSources", new { sources = Array.Empty<object>() });
#endif
                }
                break;

            case "chatboxDirectSend":
                {
                    var text = msg["text"]?.ToString() ?? "";
                    if (string.IsNullOrEmpty(text)) break;
                    if (text.Length > 144) text = text[..144];
                    if (_chatbox != null)
                    {
                        _chatbox.SendDirect(text);
                    }
                    else
                    {
                        var svc = new ChatboxService(_ => { });
                        svc.SendDirect(text);
                    }
                }
                break;

            case "chatboxTyping":
                {
                    var typing = msg["typing"]?.Value<bool>() ?? false;
                    if (_chatbox != null)
                        _chatbox.SendTypingIndicator(typing);
                    else
                    {
                        var svc = new ChatboxService(_ => { });
                        svc.SendTypingIndicator(typing);
                    }
                    _typingIndicatorOn = typing;
                }
                break;

            case "oscConnect":
                {
                    _osc ??= new OscService(s => Invoke(() => _core.SendToJS("log", new { msg = s, color = "sec" })));
                    _osc.SetParamCallback((name, val, type) => {
                        try
                        {
                            Invoke(() => _core.SendToJS("oscParam", new { name, value = val, type }));
                            _core.VrOverlay?.OscParam(name, val);
                        }
                        catch (Exception ex) { CrashHandler.WriteEntry("Osc.SetParamCallback", ex); }
                    });
                    _osc.SetAvatarChangeCallback((avatarId, paramDefs) => {
                        try
                        {
                            var paramList = paramDefs.Select(p => new { p.Name, p.Type, p.HasInput, p.HasOutput }).ToList();
                            Invoke(() => _core.SendToJS("oscAvatarParams", new { avatarId, paramList }));
                            var inputDefs = paramDefs.Where(p => p.HasInput && p.Name != "VRCEmote")
                                .Select(p => (p.Name, p.Type)).ToList();
                            _core.VrOverlay?.OscAvatarParams(inputDefs);
                        }
                        catch (Exception ex) { CrashHandler.WriteEntry("Osc.SetAvatarChangeCallback", ex); }
                    });
                    bool oscOk = _osc.Start();
                    _core.SendToJS("oscState", new { connected = oscOk });
                    _core.VrOverlay?.OscState(oscOk);
                    if (oscOk)
                    {
                        _ = Task.Run(async () =>
                        {
                            // Try OSCQuery first; gets all live values instantly (VRChat v2023.3.1+)
                            bool gotLive = await _osc.TryOscQueryAsync((name, val, type) =>
                            {
                                try
                                {
                                    Invoke(() => _core.SendToJS("oscParam", new { name, value = val, type }));
                                    _core.VrOverlay?.OscParam(name, val);
                                }
                                catch (Exception ex) { CrashHandler.WriteEntry("Osc.TryOscQueryAsync", ex); }
                            });
                            // Fallback: load config file as pending params so the full list is visible
                            if (!gotLive)
                            {
                                var (avatarId, paramDefs) = _osc.LoadMostRecentAvatarConfig();
                                if (paramDefs.Count > 0)
                                {
                                    var paramList = paramDefs.Select(p => new { p.Name, p.Type, p.HasInput, p.HasOutput }).ToList();
                                    Invoke(() => _core.SendToJS("oscAvatarParams", new { avatarId, paramList }));
                                    var inputDefs = paramDefs.Where(p => p.HasInput && p.Name != "VRCEmote")
                                        .Select(p => (p.Name, p.Type)).ToList();
                                    _core.VrOverlay?.OscAvatarParams(inputDefs);
                                }
                            }
                        });
                    }
                }
                break;

            case "oscDisconnect":
                _osc?.Stop();
                _core.SendToJS("oscState", new { connected = false });
                _core.VrOverlay?.OscState(false);
                break;

            case "oscSend":
                SendOscParamValue(msg["name"]?.ToString() ?? "", msg["type"]?.ToString() ?? "", msg["value"]);
                break;

            case "oscTriggerEmote":
                TriggerEmoteInternal(msg["emote"]?.Value<int>() ?? 0);
                break;

            case "oscSendRaw":
                {
                    if (_osc?.IsConnected == true)
                    {
                        var address = msg["address"]?.ToString() ?? "";
                        var pType   = msg["type"]?.ToString() ?? "";
                        if (!string.IsNullOrEmpty(address))
                        {
                            if (pType == "float") _osc.SendRawFloat(address, msg["value"]?.Value<float>() ?? 0f);
                            else if (pType == "bool") _osc.SendRawBool(address, msg["value"]?.Value<bool>() ?? false);
                        }
                    }
                }
                break;

            case "oscEnableOutputs":
                {
                    int filesUpdated = _osc != null ? _osc.EnableAllOutputs()
                        : new OscService(s => { }).EnableAllOutputs();
                    _core.SendToJS("oscOutputsEnabled", new { filesUpdated });
                }
                break;
        }
    }

    // Shared by the desktop OSC Tool/OSC Radial Menu ("oscSend"/"oscTriggerEmote" above) and
    // the VR-overlay Expressions tab (wired to VROverlayController.OnExpressionSend/OnExpressionEmote
    // in the constructor) so both paths go through the same connection/cooldown checks.
    private void SendOscParamValue(string name, string type, JToken? valueToken)
    {
        if (_osc?.IsConnected != true)
        {
            _core.SendToJS("log", new { msg = $"[OSC] Send skipped — not connected (osc={_osc != null}, running={_osc?.IsConnected})", color = "err" });
            return;
        }
        if (string.IsNullOrEmpty(name)) return;
        if (type == "bool") _osc.SendBool(name, valueToken?.Value<bool>() ?? false);
        else if (type == "float") _osc.SendFloat(name, valueToken?.Value<float>() ?? 0f);
        else if (type == "int") _osc.SendInt(name, valueToken?.Value<int>() ?? 0);
    }

    private void TriggerEmoteInternal(int emote)
    {
        if (_osc?.IsConnected != true)
        {
            _core.SendToJS("log", new { msg = "[OSC] Emote trigger skipped — not connected", color = "err" });
            return;
        }
        if (emote < 1 || emote > 8) return;

        int now = Environment.TickCount;
        if (now - _lastEmoteTick < EMOTE_COOLDOWN_MS)
        {
            _core.SendToJS("toast", new { ok = false, msg = "Please wait before triggering another emote" });
            return;
        }
        _lastEmoteTick = now;

        // VRCEmote must return to 0 before VRChat will play it again, so fire the
        // trigger and reset it back after a short delay — a single "press", not a hold.
        var osc = _osc;
        osc.SendInt("VRCEmote", emote);
        _ = Task.Run(async () =>
        {
            await Task.Delay(EMOTE_RESET_DELAY_MS);
            osc.SendInt("VRCEmote", 0);
        });
    }

    // Toggle (called from VR overlay)

    public void Toggle()
    {
        if (_chatbox != null)
        {
            if (_typingIndicatorOn)
            {
                _chatbox.SendTypingIndicator(false);
                _typingIndicatorOn = false;
            }
            _chatbox.Stop();
            _chatbox = null;
            _core.SendToJS("chatboxUpdate", new { enabled = false });
        }
        else
        {
            _chatbox = new ChatboxService(s => Invoke(() => _core.SendToJS("log", new { msg = s, color = "sec" })));
            _chatbox.SetUpdateCallback(data => { try { Invoke(() => _core.SendToJS("chatboxUpdate", data)); } catch (Exception ex) { CrashHandler.WriteEntry("Chatbox.SetUpdateCallback", ex); } });
            _chatbox.ApplyConfig(true, _core.Settings.CbShowTime, _core.Settings.CbShowMedia, _core.Settings.CbShowPlaytime,
                _core.Settings.CbShowCustomText, _core.Settings.CbShowSystemStats, _core.Settings.CbShowAfk, _core.Settings.CbAfkMessage,
                _core.Settings.CbSuppressSound, _core.Settings.CbTimeFormat, _core.Settings.CbSeparator, _core.Settings.CbIntervalMs, _core.Settings.CbCustomLines, _core.Settings.CbHideBackground, _core.Settings.CbMediaSource,
                _core.Settings.CbHideNameEnabled, _core.Settings.CbHideNameText, _core.Settings.CbShowJoinLeaveLog);
            _core.SendToJS("chatboxUpdate", new { enabled = true });
        }
    }

    // Disposal

    public void Dispose()
    {
        if (_typingIndicatorOn)
        {
            (_chatbox ?? new ChatboxService(_ => { })).SendTypingIndicator(false);
            _typingIndicatorOn = false;
        }
        _chatbox?.Dispose();
        _chatbox = null;
        _osc?.Dispose();
        _osc = null;
    }

    // Photino compatibility shim
    private static void Invoke(Action action) => action();
}
