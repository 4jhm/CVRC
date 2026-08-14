using System.Text;

namespace VRCNext.Services.Helpers;

public static class AvtrdbSpamGuard
{
    private const int WindowSeconds   = 120;
    private const int Threshold       = 40;
    private const int CooldownMinutes = 30;

    public static Func<string>? WebhookUrl;
    public static Action<string>? Log;

    private static readonly object _lock = new();
    private static readonly Queue<DateTime> _window = new();
    private static readonly DateTime _sessionStart = DateTime.UtcNow;
    private static long _total;
    private static DateTime _lastReport = DateTime.MinValue;

    public static void RecordQuery()
    {
        int burst;
        lock (_lock)
        {
            var now = DateTime.UtcNow;
            _total++;
            _window.Enqueue(now);
            while (_window.Count > 0 && (now - _window.Peek()).TotalSeconds > WindowSeconds)
                _window.Dequeue();

            if (_window.Count <= Threshold) return;
            if ((now - _lastReport).TotalMinutes < CooldownMinutes) return;

            _lastReport = now;
            burst = _window.Count;
        }

        _ = Task.Run(() => ReportAsync(burst));
    }

    private static async Task ReportAsync(int burst)
    {
        try
        {
            var url = WebhookUrl?.Invoke();
            if (string.IsNullOrWhiteSpace(url)) return;

            long total;
            lock (_lock) total = _total;

            var elapsed = DateTime.UtcNow - _sessionStart;
            var hours   = Math.Max(elapsed.TotalHours, 1.0 / 3600);
            var minutes = Math.Max(elapsed.TotalMinutes, 1.0 / 60);
            var now     = DateTime.Now;

            var sb = new StringBuilder();
            sb.AppendLine("**AVTRDB API SPAM WARNING**");
            sb.AppendLine("```");
            sb.AppendLine($"Client Version            : {AppInfo.Version}");
            sb.AppendLine($"Date                      : {now:yyyy-MM-dd}");
            sb.AppendLine($"Time                      : {now:HH:mm:ss}");
            sb.AppendLine($"Average Requests Per Hour : {Math.Round(total / hours)}");
            sb.AppendLine($"Average Requests Per Min  : {Math.Round(total / minutes, 1)}");
            sb.AppendLine($"Burst ({WindowSeconds}s window)      : {burst}");
            sb.AppendLine($"Total This Session        : {total}");
            sb.AppendLine("```");

            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
            var body = new Newtonsoft.Json.Linq.JObject { ["content"] = sb.ToString() };
            using var content = new StringContent(body.ToString(), Encoding.UTF8, "application/json");
            await http.PostAsync(url, content);

            Log?.Invoke($"[AVTRDB] spam guard reported {burst} queries in {WindowSeconds}s");
        }
        catch (Exception ex) { CrashHandler.WriteEntry("AvtrdbSpamGuard.Report", ex); }
    }
}
