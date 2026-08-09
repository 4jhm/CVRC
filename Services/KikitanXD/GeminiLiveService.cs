using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
#if WINDOWS
using NAudio.Wave;
#endif

namespace VRCNext.Services.KikitanXD;

#if !WINDOWS
public sealed class GeminiLiveService : IKikitanSpeechService
{
    public event Action<string, bool>? OnRecognized;
    public event Action<string>? OnTranslated;
    public event Action<string>? OnOutput;
    public event Action<string>? OnLog;
    public event Action? OnChatboxSent;
    public bool IsRunning => false;
    public float MeterLevel => 0f;
    public void Start(int deviceIndex, KikitanXDSettings settings) { }
    public void UpdateSettings(KikitanXDSettings settings) { }
    public void Stop() { }
    public void Dispose() { }
}
#else

public sealed class GeminiLiveService : IKikitanSpeechService
{
    public event Action<string, bool>? OnRecognized;
    public event Action<string>? OnTranslated;
    public event Action<string>? OnOutput;
    public event Action<string>? OnLog;
    public event Action? OnChatboxSent;

    private WaveInEvent? _waveIn;
    private ClientWebSocket? _ws;
    private CancellationTokenSource? _cts;
    private Task? _receiveTask;
    private Task? _senderTask;
    private Task? _flushTask;
    private volatile bool _running;

    private volatile float _meterLevel;
    public float MeterLevel => _meterLevel;
    public bool IsRunning => _running;

    private readonly ConcurrentQueue<byte[]> _pcmQueue = new();
    private readonly SemaphoreSlim _pcmSignal = new(0);
    private readonly SemaphoreSlim _sendLock = new(1, 1);

    private readonly StringBuilder _turnInput = new();
    private readonly StringBuilder _turnOutput = new();
    private readonly object _turnLock = new();
    private DateTime _lastDeltaUtc = DateTime.MinValue;
    private bool _turnDirty;
    private volatile bool _goAwayPending;
    private int _debugMsgsLeft;
    private const int TurnFlushMs = 1200;

    private string _apiKey = "";
    private string _targetLang = "en";
    private int _deviceIndex;
    private volatile bool _translateEnabled = true;
    private volatile bool _oscEnabled = true;
    private volatile string[] _blockedWords = Array.Empty<string>();
    private volatile string[] _blockedSentences = Array.Empty<string>();
    private volatile float _silenceThreshold = 0.0167f;
    private long _gateOpenUntilTicks;
    private const int GateHangoverMs = 500;
    private volatile bool _partialOsc;
    private DateTime _lastPartialSend = DateTime.MinValue;
    private const int PartialMinIntervalMs = 1200;

    private const int SampleRate = 16000;
    private const int Channels = 1;
    private const int BitsPerSample = 16;
    private const string ModelName = "models/gemini-3.5-live-translate-preview";

    public void Start(int deviceIndex, KikitanXDSettings s)
    {
        Stop();
        _apiKey = s.GoogleApiKey ?? "";
        _targetLang = MapTargetLang(s.TargetLang);
        _translateEnabled = s.TranslateEnabled;
        _oscEnabled = s.OscEnabled;
        _partialOsc = s.PartialOsc;
        _silenceThreshold = Math.Clamp(s.NoiseGatePercent / 100f / 6f, 0.001f, 0.5f);
        _blockedWords = NormalizeList(s.BlockedWords);
        _blockedSentences = NormalizeList(s.BlockedSentences);

        if (string.IsNullOrWhiteSpace(_apiKey))
            throw new InvalidOperationException("Google API key is missing.");

        _running = true;
        _deviceIndex = deviceIndex;
        _cts = new CancellationTokenSource();
        var token = _cts.Token;

        _waveIn = new WaveInEvent
        {
            DeviceNumber = deviceIndex,
            WaveFormat = new WaveFormat(SampleRate, BitsPerSample, Channels),
            BufferMilliseconds = 100
        };
        _waveIn.DataAvailable += OnDataAvailable;
        _waveIn.RecordingStopped += OnRecordingStopped;
        _waveIn.StartRecording();

        _senderTask = Task.Run(() => SenderLoop(token));
        _flushTask = Task.Run(() => FlushLoop(token));

        _receiveTask = Task.Run(() => ConnectAndRunAsync(token));
        Log("Kikitan XD (Google Gemini Live): microphone started, connecting...");
    }

    private async Task ConnectAndRunAsync(CancellationToken token)
    {
        var uri = new Uri(
            "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key="
            + Uri.EscapeDataString(_apiKey));
        while (!token.IsCancellationRequested && _running)
        {
            _goAwayPending = false;
            try
            {
                var ws = new ClientWebSocket();
                _ws = ws;
                await ws.ConnectAsync(uri, token);
                await SendSetupAsync();
                _debugMsgsLeft = 6;
                Log("Kikitan XD (Google Gemini Live): connected");
                await ReceiveLoop(token);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                CrashHandler.AddBreadcrumb($"GeminiLive.Connect: {ex.GetType().Name}: {ex.Message}");
                Log($"Kikitan XD (Google): connection error — {ex.Message}");
            }

            var closing = _ws;
            _ws = null;
            if (closing != null)
            {
                try
                {
                    if (closing.State == WebSocketState.Open)
                        await closing.CloseAsync(WebSocketCloseStatus.NormalClosure, "goaway", CancellationToken.None);
                }
                catch { }
                try { closing.Dispose(); } catch { }
            }
            while (_pcmQueue.TryDequeue(out _)) { }
            lock (_turnLock) { _turnInput.Clear(); _turnOutput.Clear(); _turnDirty = false; }

            if (token.IsCancellationRequested || !_running) break;
            Log("Kikitan XD (Google Gemini Live): session ended, reconnecting...");
            try { await Task.Delay(1500, token); } catch { break; }
        }
    }

    public void UpdateSettings(KikitanXDSettings s)
    {
        _translateEnabled = s.TranslateEnabled;
        _oscEnabled = s.OscEnabled;
        _partialOsc = s.PartialOsc;
        _silenceThreshold = Math.Clamp(s.NoiseGatePercent / 100f / 6f, 0.001f, 0.5f);
        _blockedWords = NormalizeList(s.BlockedWords);
        _blockedSentences = NormalizeList(s.BlockedSentences);

        if (!_running) return;
        if (MapTargetLang(s.TargetLang) == _targetLang && (s.GoogleApiKey ?? "") == _apiKey) return;
        try { Start(_deviceIndex, s); }
        catch (Exception ex) { Log($"Kikitan XD (Google): could not apply new settings — {ex.Message}"); }
    }

    public void Stop()
    {
        _running = false;

        if (_waveIn != null)
        {
            _waveIn.DataAvailable -= OnDataAvailable;
            _waveIn.RecordingStopped -= OnRecordingStopped;
            try { _waveIn.StopRecording(); } catch { }
            _waveIn.Dispose();
            _waveIn = null;
        }

        try { _cts?.Cancel(); } catch { }

        if (_ws != null)
        {
            try
            {
                if (_ws.State == WebSocketState.Open)
                    _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "stop", CancellationToken.None).Wait(1000);
            }
            catch { }
            try { _ws.Dispose(); } catch { }
            _ws = null;
        }

        try { _receiveTask?.Wait(1000); } catch { }
        try { _senderTask?.Wait(1000); } catch { }
        try { _flushTask?.Wait(1000); } catch { }
        _receiveTask = null;
        _senderTask = null;
        _flushTask = null;

        _cts?.Dispose();
        _cts = null;

        while (_pcmQueue.TryDequeue(out _)) { }
        lock (_turnLock)
        {
            _turnInput.Clear();
            _turnOutput.Clear();
            _turnDirty = false;
        }
        _meterLevel = 0f;
        Log("Kikitan XD (Google Gemini Live): stopped");
    }

    private async Task SendSetupAsync()
    {
        var setup = new JObject
        {
            ["setup"] = new JObject
            {
                ["model"] = ModelName,
                ["generationConfig"] = new JObject
                {
                    ["responseModalities"] = new JArray { "AUDIO" },
                    ["translationConfig"] = new JObject
                    {
                        ["targetLanguageCode"] = _targetLang,
                        ["echoTargetLanguage"] = true
                    }
                },
                ["inputAudioTranscription"] = new JObject(),
                ["outputAudioTranscription"] = new JObject()
            }
        };
        await SendJsonAsync(setup);
    }

    private void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        if (e.BytesRecorded <= 0 || !_running) return;

        float rms = ComputeRms(e.Buffer, e.BytesRecorded);
        _meterLevel = Math.Min(1f, rms * 6f);

        if (_ws == null || _ws.State != WebSocketState.Open) return;

        var nowTicks = DateTime.UtcNow.Ticks;
        if (rms > _silenceThreshold)
            _gateOpenUntilTicks = DateTime.UtcNow.AddMilliseconds(GateHangoverMs).Ticks;

        var chunk = new byte[e.BytesRecorded];
        if (nowTicks < _gateOpenUntilTicks)
            Buffer.BlockCopy(e.Buffer, 0, chunk, 0, e.BytesRecorded);
        _pcmQueue.Enqueue(chunk);
        _pcmSignal.Release();
    }

    private static float ComputeRms(byte[] buf, int length)
    {
        if (length < 2) return 0f;
        double sum = 0;
        int samples = length / 2;
        for (int i = 0; i < length - 1; i += 2)
        {
            short s = (short)(buf[i] | (buf[i + 1] << 8));
            double v = s / 32768.0;
            sum += v * v;
        }
        return (float)Math.Sqrt(sum / samples);
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs e)
    {
        if (e.Exception != null)
            Log($"Kikitan XD (Google): recording stopped — {e.Exception.Message}");
    }

    private async Task SenderLoop(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                await _pcmSignal.WaitAsync(token);
                while (_pcmQueue.TryDequeue(out var chunk))
                {
                    var ws = _ws;
                    if (ws == null || ws.State != WebSocketState.Open) continue;
                    var msg = new JObject
                    {
                        ["realtimeInput"] = new JObject
                        {
                            ["audio"] = new JObject
                            {
                                ["data"] = Convert.ToBase64String(chunk),
                                ["mimeType"] = $"audio/pcm;rate={SampleRate}"
                            }
                        }
                    };
                    await SendJsonAsync(msg);
                }
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                Log($"Kikitan XD (Google): send error — {ex.Message}");
            }
        }
    }

    private async Task SendJsonAsync(JObject obj)
    {
        var ws = _ws;
        if (ws == null || ws.State != WebSocketState.Open) return;
        var bytes = Encoding.UTF8.GetBytes(obj.ToString(Newtonsoft.Json.Formatting.None));
        await _sendLock.WaitAsync();
        try
        {
            await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true,
                _cts?.Token ?? CancellationToken.None);
        }
        finally { _sendLock.Release(); }
    }

    private async Task ReceiveLoop(CancellationToken token)
    {
        var ws = _ws;
        if (ws == null) return;
        var buffer = new byte[16384];
        var sb = new StringBuilder();
        try
        {
            while (!token.IsCancellationRequested && ws.State == WebSocketState.Open)
            {
                var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    Log($"Kikitan XD (Google): session closed by server — {ws.CloseStatus} {ws.CloseStatusDescription}");
                    return;
                }
                sb.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                if (!result.EndOfMessage) continue;

                var text = sb.ToString();
                sb.Clear();
                HandleServerMessage(text);
                if (_goAwayPending) return;
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            if (_running) Log($"Kikitan XD (Google): receive error — {ex.Message}");
        }
    }

    private void HandleServerMessage(string text)
    {
        JObject obj;
        try { obj = JObject.Parse(text); }
        catch { return; }

        if (obj["setupComplete"] != null)
        {
            Log("Kikitan XD (Google): session ready");
            return;
        }

        if (obj["goAway"] is JToken ga)
        {
            FinishTurn();
            _goAwayPending = true;
            Log($"Kikitan XD (Google): session time limit reached (goAway {ga["timeLeft"]}), reconnecting");
            return;
        }

        var sc = obj["serverContent"];
        if (sc == null)
            return;

        var inText = sc["inputTranscription"]?["text"]?.ToString();
        var outText = sc["outputTranscription"]?["text"]?.ToString();

        if (_debugMsgsLeft > 0 && (!string.IsNullOrEmpty(inText) || !string.IsNullOrEmpty(outText)))
        {
            _debugMsgsLeft--;
            Log($"Kikitan XD (Google) transcript: in=\"{inText}\" out=\"{outText}\"");
        }

        if (!string.IsNullOrEmpty(inText) || !string.IsNullOrEmpty(outText))
        {
            string inSnap, outSnap;
            lock (_turnLock)
            {
                if (!string.IsNullOrEmpty(inText)) _turnInput.Append(inText);
                if (!string.IsNullOrEmpty(outText)) _turnOutput.Append(outText);
                _lastDeltaUtc = DateTime.UtcNow;
                _turnDirty = true;
                inSnap = _turnInput.ToString();
                outSnap = _turnOutput.ToString();
            }
            if (!string.IsNullOrEmpty(inText)) OnRecognized?.Invoke(inSnap, true);
            if (!string.IsNullOrEmpty(outText) && _translateEnabled) OnTranslated?.Invoke(outSnap);

            // Live-type the growing sentence into the chatbox while it is spoken.
            if (_partialOsc && _oscEnabled)
            {
                var partial = (_translateEnabled && outSnap.Trim().Length > 0 ? outSnap : inSnap).Trim();
                if (partial.Length > 0 && (DateTime.UtcNow - _lastPartialSend).TotalMilliseconds >= PartialMinIntervalMs)
                {
                    _lastPartialSend = DateTime.UtcNow;
                    SendChatbox(partial.Length > 140 ? partial.Substring(partial.Length - 140) + "..." : partial + "...");
                }
            }
        }

        if (sc["turnComplete"]?.Value<bool>() == true || sc["generationComplete"]?.Value<bool>() == true)
            FinishTurn();
    }

    private async Task FlushLoop(CancellationToken token)
    {
        try
        {
            while (!token.IsCancellationRequested)
            {
                await Task.Delay(200, token);
                bool flush;
                lock (_turnLock)
                    flush = _turnDirty && (DateTime.UtcNow - _lastDeltaUtc).TotalMilliseconds > TurnFlushMs;
                if (flush) FinishTurn();
            }
        }
        catch (OperationCanceledException) { }
    }

    private void FinishTurn()
    {
        string src, translated;
        lock (_turnLock)
        {
            src = _turnInput.ToString().Trim();
            translated = _turnOutput.ToString().Trim();
            _turnInput.Clear();
            _turnOutput.Clear();
            _turnDirty = false;
        }

        if (src.Length == 0 && translated.Length == 0) return;

        string srcFiltered = ApplyBlockFilters(src);
        if (src.Length > 0 && srcFiltered.Length == 0) return;

        OnRecognized?.Invoke(srcFiltered.Length > 0 ? srcFiltered : src, false);

        string send = _translateEnabled && translated.Length > 0 ? translated : srcFiltered;
        send = ApplyBlockFilters(send);
        if (string.IsNullOrWhiteSpace(send)) return;

        OnTranslated?.Invoke(send);
        if (_oscEnabled) { SendChatbox(send); OnChatboxSent?.Invoke(); }
        OnOutput?.Invoke(send);
    }

    private static readonly Dictionary<string, string> TargetLangMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["zh"] = "zh-Hans",
        ["pt"] = "pt-BR"
    };

    private static string MapTargetLang(string? lang)
    {
        if (string.IsNullOrWhiteSpace(lang)) return "en";
        return TargetLangMap.TryGetValue(lang, out var mapped) ? mapped : lang;
    }

    private static string[] NormalizeList(IEnumerable<string>? items)
    {
        if (items == null) return Array.Empty<string>();
        var list = new List<string>();
        foreach (var i in items)
            if (!string.IsNullOrWhiteSpace(i)) list.Add(i.Trim());
        return list.ToArray();
    }

    private static string NormalizeSentence(string s)
    {
        return s.Trim().Trim(' ', '.', ',', '!', '?', ';', ':', '"', '\'', '。', '！', '？', '、', '…').Trim();
    }

    private string ApplyBlockFilters(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return text;

        var sentences = _blockedSentences;
        if (sentences.Length > 0)
        {
            string norm = NormalizeSentence(text);
            foreach (var s in sentences)
                if (norm.Equals(NormalizeSentence(s), StringComparison.OrdinalIgnoreCase))
                    return "";
        }

        var words = _blockedWords;
        if (words.Length > 0)
        {
            foreach (var w in words)
            {
                if (string.IsNullOrWhiteSpace(w)) continue;
                text = System.Text.RegularExpressions.Regex.Replace(
                    text,
                    $@"\b{System.Text.RegularExpressions.Regex.Escape(w)}\b",
                    "",
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            }
            text = System.Text.RegularExpressions.Regex.Replace(text, @"\s{2,}", " ").Trim();
        }

        return text;
    }

    private static void SendChatbox(string text)
    {
        try
        {
            if (text.Length > 144) text = text[..144];
            using var udp = new System.Net.Sockets.UdpClient();
            udp.Connect("127.0.0.1", 9000);
            var buf = new List<byte>();
            OscString(buf, "/chatbox/input");
            OscString(buf, ",sTF");
            OscString(buf, text);
            var pkt = buf.ToArray();
            udp.Send(pkt, pkt.Length);
        }
        catch { }
    }

    private static void OscString(List<byte> buf, string s)
    {
        var b = Encoding.UTF8.GetBytes(s);
        buf.AddRange(b);
        int pad = 4 - (b.Length % 4);
        if (pad == 0) pad = 4;
        buf.AddRange(new byte[pad]);
    }

    private void Log(string msg) => OnLog?.Invoke(msg);

    public void Dispose()
    {
        Stop();
        _pcmSignal.Dispose();
        _sendLock.Dispose();
    }
}
#endif
