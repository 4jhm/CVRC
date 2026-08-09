using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
#if WINDOWS
using Windows.Media.Control;
#endif

namespace VRCNext
{
    public class ChatboxService : IDisposable
    {
#if WINDOWS
        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
#endif

        private const string OSC_IP = "127.0.0.1";
        private const int OSC_PORT = 9000;
        private const int MAX_CHATBOX_CHARS = 144;
        private const int MIN_INTERVAL_MS = 1500;

        private UdpClient? _udp;
        private CancellationTokenSource? _cts;
        private bool _running;

        // Config
        public bool Enabled { get; set; }
        public bool ShowTime { get; set; } = true;
        public bool ShowMedia { get; set; } = true;
        public bool ShowPlaytime { get; set; } = true;
        public bool ShowCustomText { get; set; } = true;
        public bool ShowSystemStats { get; set; }
        public bool ShowAfk { get; set; }
        public string AfkMessage { get; set; } = "Currently AFK";
        public bool SuppressNotifSound { get; set; } = true;
        public bool HideChatboxBackground { get; set; } = false;
        public string TimeFormat { get; set; } = "hh:mm tt";
        public string Separator { get; set; } = " | ";
        public int IntervalMs { get; set; } = 5000;
        public List<string> CustomLines { get; set; } = new();
        private int _customLineIndex;

        // Media state
        public string CurrentTitle { get; private set; } = "";
        public string CurrentArtist { get; private set; } = "";
        public TimeSpan CurrentPosition { get; private set; }
        public TimeSpan CurrentDuration { get; private set; }
        public bool IsPlaying { get; private set; }

        // Position interpolation (browsers don't push continuous SMTC updates)
        private string _smtcTrackKey = "";
        private TimeSpan _smtcLastReportedPos;
        private TimeSpan _smtcBasePos;
        private DateTimeOffset _smtcBaseTime = DateTimeOffset.MinValue;

        // System stats
#if WINDOWS
        private PerformanceCounter? _cpuCounter;
#else
        private long _prevCpuTotal, _prevCpuIdle;
#endif
        private float _cpuPercent;
        private float _ramUsedGB;
        private float _ramTotalGB;

        // Direct send pause
        private volatile int _pauseUntilTick;

        // AFK
        private bool _isAfk;
        private DateTime _afkSince;

        private readonly Action<string> _log;
        private Action<object>? _onUpdate;

        public ChatboxService(Action<string> log) { _log = log; }
        public void SetUpdateCallback(Action<object> cb) => _onUpdate = cb;

        public void Start()
        {
            if (_running) return;
            _running = true;
            _cts = new CancellationTokenSource();
            _udp = new UdpClient();
            _udp.Connect(IPAddress.Parse(OSC_IP), OSC_PORT);
            _log("[Chatbox] Started");
            _ = RunLoopAsync(_cts.Token);
        }

        public void Stop()
        {
            if (!_running) return;
            _running = false;
            _cts?.Cancel();
            try { SendOscChatbox("", true); } catch { }
            _udp?.Close(); _udp = null;
            _log("[Chatbox] Stopped");
        }

        private async Task RunLoopAsync(CancellationToken ct)
        {
#if WINDOWS
            try { _cpuCounter = new PerformanceCounter("Processor", "% Processor Time", "_Total", true); _cpuCounter.NextValue(); }
            catch (Exception ex) { _log($"[Chatbox] CPU counter init: {ex.Message}"); }
#endif
            try { var gi = GC.GetGCMemoryInfo(); _ramTotalGB = gi.TotalAvailableMemoryBytes / (1024f * 1024f * 1024f); }
            catch { _ramTotalGB = 0; }

            while (!ct.IsCancellationRequested)
            {
                try
                {
                    if (ShowMedia) await UpdateMediaInfoAsync();
                    if (ShowSystemStats) UpdateSystemStats();
                    if (ShowAfk) UpdateAfkState();

                    var text = BuildChatboxText();
                    if (Enabled && !string.IsNullOrEmpty(text) && Environment.TickCount >= _pauseUntilTick)
                        SendOscChatbox(text, SuppressNotifSound);

                    _onUpdate?.Invoke(new {
                        currentTitle = CurrentTitle, currentArtist = CurrentArtist,
                        positionMs = (long)CurrentPosition.TotalMilliseconds,
                        durationMs = (long)CurrentDuration.TotalMilliseconds,
                        isPlaying = IsPlaying, chatboxText = text, enabled = Enabled,
                        cpuPercent = _cpuPercent, ramUsedGB = _ramUsedGB, ramTotalGB = _ramTotalGB,
                        isAfk = _isAfk,
                    });
                    await Task.Delay(Math.Max(IntervalMs, MIN_INTERVAL_MS), ct);
                }
                catch (TaskCanceledException) { break; }
                catch (Exception ex) { _log($"[Chatbox] Error: {ex.Message}"); await Task.Delay(2000, ct); }
            }
#if WINDOWS
            _cpuCounter?.Dispose(); _cpuCounter = null;
#endif
        }

        private string BuildChatboxText()
        {
            // When hiding background, append \u0003\u001f — VRChat renders text without the bubble background.
            // Reserve 2 chars for the suffix, so max usable text is 142 instead of 144.
            int limit = HideChatboxBackground ? MAX_CHATBOX_CHARS - 2 : MAX_CHATBOX_CHARS;

            if (ShowAfk && _isAfk)
            {
                var d = DateTime.Now - _afkSince;
                var t = d.TotalHours >= 1 ? $"{(int)d.TotalHours}h {d.Minutes}m" : $"{(int)d.TotalMinutes}m";
                var msg = $"{AfkMessage} ({t})";
                if (ShowTime) msg = DateTime.Now.ToString(TimeFormat) + Separator + msg;
                if (msg.Length > limit) msg = msg[..limit];
                return HideChatboxBackground ? msg + "\u0003\u001f" : msg;
            }

            var parts = new List<string>();
            if (ShowTime) parts.Add(DateTime.Now.ToString(TimeFormat));

            if (ShowMedia && IsPlaying && !string.IsNullOrEmpty(CurrentTitle))
            {
                var m = $"\"{CurrentTitle}\"";
                if (!string.IsNullOrEmpty(CurrentArtist)) m += $" by {CurrentArtist}";
                if (ShowPlaytime && CurrentDuration.TotalSeconds > 0)
                    m += $" [{FormatTime(CurrentPosition)}/{FormatTime(CurrentDuration)}]";
                parts.Add(m);
            }

            if (ShowSystemStats)
            {
                var s = $"CPU {_cpuPercent:0}%";
                if (_ramTotalGB > 0) s += $" RAM {_ramUsedGB:0.0}/{_ramTotalGB:0.0}GB";
                parts.Add(s);
            }

            if (ShowCustomText && CustomLines.Count > 0)
            {
                var line = CustomLines[_customLineIndex % CustomLines.Count];
                if (!string.IsNullOrWhiteSpace(line)) parts.Add(line);
                _customLineIndex++;
            }

            var result = string.Join(Separator, parts);
            if (result.Length > limit) result = result[..limit];
            return HideChatboxBackground ? result + "\u0003\u001f" : result;
        }

        private static string FormatTime(TimeSpan ts) =>
            ts.TotalHours >= 1 ? ts.ToString(@"h\:mm\:ss") : ts.ToString(@"m\:ss");

        private void UpdateSystemStats()
        {
#if WINDOWS
            try
            {
                if (_cpuCounter != null) _cpuPercent = _cpuCounter.NextValue();
                using var ram = new PerformanceCounter("Memory", "Available MBytes", true);
                float availMB = ram.NextValue();
                _ramUsedGB = (_ramTotalGB * 1024f - availMB) / 1024f;
            }
            catch { }
#else
            // CPU via /proc/stat
            try
            {
                var statParts = File.ReadLines("/proc/stat").First()
                    .Split(' ', StringSplitOptions.RemoveEmptyEntries);
                // cpu user nice system idle iowait irq softirq steal ...
                long user   = long.Parse(statParts[1]);
                long nice   = long.Parse(statParts[2]);
                long system = long.Parse(statParts[3]);
                long idle   = long.Parse(statParts[4]);
                long iowait = long.Parse(statParts[5]);
                long irq    = long.Parse(statParts[6]);
                long softirq = long.Parse(statParts[7]);
                long total  = user + nice + system + idle + iowait + irq + softirq;
                long idleAll = idle + iowait;
                if (_prevCpuTotal > 0)
                {
                    long dt = total - _prevCpuTotal;
                    long di = idleAll - _prevCpuIdle;
                    _cpuPercent = dt > 0 ? (1f - (float)di / dt) * 100f : 0f;
                }
                _prevCpuTotal = total;
                _prevCpuIdle  = idleAll;
            }
            catch { }

            // RAM via /proc/meminfo
            try
            {
                long memTotalKB = 0, memAvailKB = 0;
                foreach (var line in File.ReadLines("/proc/meminfo"))
                {
                    if (line.StartsWith("MemTotal:"))
                        memTotalKB = long.Parse(line.Split(':')[1].Trim().Split(' ')[0]);
                    else if (line.StartsWith("MemAvailable:"))
                        memAvailKB = long.Parse(line.Split(':')[1].Trim().Split(' ')[0]);
                    if (memTotalKB > 0 && memAvailKB > 0) break;
                }
                _ramTotalGB = memTotalKB / (1024f * 1024f);
                _ramUsedGB  = (memTotalKB - memAvailKB) / (1024f * 1024f);
            }
            catch { }
#endif
        }

        private void UpdateAfkState()
        {
#if WINDOWS
            try
            {
                bool focused = false;
                var hwnd = GetForegroundWindow();
                if (hwnd != IntPtr.Zero)
                {
                    GetWindowThreadProcessId(hwnd, out uint pid);
                    try { focused = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant().Contains("vrchat"); }
                    catch { }
                }
                if (!focused && !_isAfk) { _isAfk = true; _afkSince = DateTime.Now; }
                else if (focused) _isAfk = false;
            }
            catch { _isAfk = false; }
#endif
        }

        private async Task UpdateMediaInfoAsync()
        {
#if WINDOWS
            try
            {
                var mgr = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync()
                    .AsTask().WaitAsync(TimeSpan.FromSeconds(5));
                var sessions = mgr.GetSessions();
                _log($"[Chatbox/SMTC] {sessions.Count} session(s) found");
                foreach (var sess in sessions)
                    _log($"[Chatbox/SMTC]   app={sess.SourceAppUserModelId} status={sess.GetPlaybackInfo()?.PlaybackStatus}");
                var s = sessions.FirstOrDefault(sess =>
                            sess.GetPlaybackInfo()?.PlaybackStatus ==
                            GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
                        ?? mgr.GetCurrentSession();
                if (s == null)
                {
                    _log("[Chatbox/SMTC] No session selected → no media");
                    IsPlaying = false; CurrentTitle = ""; CurrentArtist = ""; return;
                }
                _log($"[Chatbox/SMTC] Using session: {s.SourceAppUserModelId}");
                IsPlaying = s.GetPlaybackInfo()?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
                var p = await s.TryGetMediaPropertiesAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5));
                if (p != null) { CurrentTitle = p.Title ?? ""; CurrentArtist = p.Artist ?? ""; }
                _log($"[Chatbox/SMTC] title=\"{CurrentTitle}\" artist=\"{CurrentArtist}\" playing={IsPlaying}");
                var tl = s.GetTimelineProperties();
                if (tl != null)
                {
                    CurrentDuration = tl.EndTime - tl.StartTime;
                    var trackKey = $"{CurrentTitle}||{(long)CurrentDuration.TotalSeconds}";
                    if (trackKey != _smtcTrackKey)
                    {
                        _smtcTrackKey = trackKey;
                        _smtcLastReportedPos = tl.Position;
                        _smtcBasePos = tl.Position;
                        _smtcBaseTime = DateTimeOffset.Now;
                    }
                    else if (Math.Abs((tl.Position - _smtcLastReportedPos).TotalMilliseconds) > 500)
                    {
                        _smtcLastReportedPos = tl.Position;
                        _smtcBasePos = tl.Position;
                        _smtcBaseTime = DateTimeOffset.Now;
                    }
                    var pos = _smtcBasePos + (IsPlaying ? (DateTimeOffset.Now - _smtcBaseTime) : TimeSpan.Zero);
                    if (CurrentDuration > TimeSpan.Zero && pos > CurrentDuration) pos = CurrentDuration;
                    if (pos < TimeSpan.Zero) pos = TimeSpan.Zero;
                    CurrentPosition = pos;
                }
            }
            catch (Exception ex) { _log($"[Chatbox/SMTC] Exception: {ex.GetType().Name}: {ex.Message}"); IsPlaying = false; }
#else
            // MPRIS2 via playerctl — works on KDE Plasma, GNOME, and most Linux DEs
            try
            {
                // Single call: tab-separated status, title, artist, length(µs), position(µs)
                var raw = await RunProcessAsync("playerctl",
                    "--format={{status}}\t{{title}}\t{{artist}}\t{{mpris:length}}\t{{mpris:position}} metadata");
                var cols = raw.Trim().Split('\t');
                if (cols.Length < 2 || string.IsNullOrWhiteSpace(cols[0]))
                {
                    IsPlaying = false; CurrentTitle = ""; CurrentArtist = "";
                    return;
                }
                IsPlaying = cols[0].Trim() == "Playing";
                CurrentTitle  = cols.Length > 1 ? cols[1].Trim() : "";
                CurrentArtist = cols.Length > 2 ? cols[2].Trim() : "";
                if (cols.Length > 3 && long.TryParse(cols[3].Trim(), out long lenUs))
                    CurrentDuration = TimeSpan.FromMicroseconds(lenUs);
                if (cols.Length > 4 && long.TryParse(cols[4].Trim().Split(' ')[0], out long posUs))
                    CurrentPosition = TimeSpan.FromMicroseconds(posUs);
            }
            catch { IsPlaying = false; }
#endif
        }

#if !WINDOWS
        private static async Task<string> RunProcessAsync(string exe, string args)
        {
            using var proc = new Process
            {
                StartInfo = new ProcessStartInfo(exe, args)
                {
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                }
            };
            proc.Start();
            var output = await proc.StandardOutput.ReadToEndAsync();
            await proc.WaitForExitAsync();
            return output;
        }
#endif

        private void SendOscChatbox(string text, bool suppressSound = true)
        {
            if (_udp == null) return;
            try { var p = BuildOscMessage("/chatbox/input", text, true, !suppressSound); _udp.Send(p, p.Length); }
            catch (Exception ex) { _log($"[Chatbox] OSC send error: {ex.Message}"); }
        }

        private static byte[] BuildOscMessage(string address, string text, bool sendImmediate, bool notifySound)
        {
            var buf = new List<byte>();
            WriteOscString(buf, address);
            WriteOscString(buf, "," + "s" + (sendImmediate ? "T" : "F") + (notifySound ? "T" : "F"));
            WriteOscString(buf, text);
            return buf.ToArray();
        }

        private static void WriteOscString(List<byte> buf, string s)
        {
            var b = Encoding.UTF8.GetBytes(s); buf.AddRange(b);
            int pad = 4 - (b.Length % 4); if (pad == 0) pad = 4;
            for (int i = 0; i < pad; i++) buf.Add(0);
        }

        public void ApplyConfig(bool enabled, bool showTime, bool showMedia, bool showPlaytime,
            bool showCustomText, bool showSystemStats, bool showAfk, string afkMessage,
            bool suppressSound, string timeFormat, string separator,
            int intervalMs, List<string> customLines, bool hideBackground = false)
        {
            var was = Enabled; Enabled = enabled;
            ShowTime = showTime; ShowMedia = showMedia; ShowPlaytime = showPlaytime;
            ShowCustomText = showCustomText; ShowSystemStats = showSystemStats;
            ShowAfk = showAfk;
            if (!string.IsNullOrWhiteSpace(afkMessage)) AfkMessage = afkMessage;
            SuppressNotifSound = suppressSound;
            if (!string.IsNullOrWhiteSpace(timeFormat)) TimeFormat = timeFormat;
            if (separator != null) Separator = separator;
            IntervalMs = Math.Max(intervalMs, MIN_INTERVAL_MS);
            CustomLines = customLines ?? new();
            HideChatboxBackground = hideBackground;
            if (enabled && !was) Start(); else if (!enabled && was) Stop();
        }

        public void SendDirect(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            bool ownUdp = _udp == null;
            if (ownUdp)
            {
                _udp = new UdpClient();
                _udp.Connect(IPAddress.Parse(OSC_IP), OSC_PORT);
            }
            SendOscChatbox(text, SuppressNotifSound);
            if (ownUdp) { _udp?.Close(); _udp = null; }
            else _pauseUntilTick = Environment.TickCount + 10_000;
        }

        // VRChat's own "/chatbox/typing" endpoint — shows the native "user is typing..." indicator
        // above the head without putting any text in the chatbox.
        public void SendTypingIndicator(bool typing)
        {
            bool ownUdp = _udp == null;
            if (ownUdp)
            {
                _udp = new UdpClient();
                _udp.Connect(IPAddress.Parse(OSC_IP), OSC_PORT);
            }
            try
            {
                var p = BuildOscBoolMessage("/chatbox/typing", typing);
                int sent = _udp!.Send(p, p.Length);
                _log($"[Chatbox] /chatbox/typing → {(typing ? "true" : "false")} ({sent}B to :{OSC_PORT})");
            }
            catch (Exception ex) { _log($"[Chatbox] Typing indicator send error: {ex.Message}"); }
            if (ownUdp) { _udp?.Close(); _udp = null; }
        }

        private static byte[] BuildOscBoolMessage(string address, bool value)
        {
            var buf = new List<byte>();
            WriteOscString(buf, address);
            WriteOscString(buf, value ? ",T" : ",F");
            return buf.ToArray();
        }

        public void PauseDirectSend(int ms)
        {
            _pauseUntilTick = Environment.TickCount + ms;
        }

        public void Dispose() { Stop(); _cts?.Dispose(); }
    }
}
