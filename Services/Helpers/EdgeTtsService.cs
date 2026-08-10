using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace VRCNext.Services.Helpers;

public static class EdgeTtsService
{
    private const string Token = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
    private const string Chromium = "143.0.3650.75";
    private const string ChromiumMajor = "143";
    private const string UserAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/" + ChromiumMajor + ".0.0.0 Safari/537.36 Edg/" + ChromiumMajor + ".0.0.0";

    public static Action<string>? Log;

    private static List<JObject>? _voiceCache;
    private static DateTime _voiceCacheAt;

    private static string SecMsGec()
    {
        long seconds = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 11644473600L;
        seconds -= seconds % 300L;
        long ticks = seconds * 10_000_000L;
        var bytes = SHA256.HashData(Encoding.ASCII.GetBytes(ticks.ToString() + Token));
        return Convert.ToHexString(bytes).ToUpperInvariant();
    }

    private static string Query(string basePath) =>
        $"{basePath}?TrustedClientToken={Token}&Sec-MS-GEC={SecMsGec()}&Sec-MS-GEC-Version=1-{Chromium}";

    public static async Task<List<JObject>> GetVoicesAsync()
    {
        if (_voiceCache != null && (DateTime.UtcNow - _voiceCacheAt).TotalHours < 12) return _voiceCache;
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
            http.DefaultRequestVersion = System.Net.HttpVersion.Version20;
            http.DefaultVersionPolicy = System.Net.Http.HttpVersionPolicy.RequestVersionOrLower;
            http.DefaultRequestHeaders.Add("User-Agent", UserAgent);
            var url = Query("https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list");
            var json = await http.GetStringAsync(url);
            _voiceCache = JArray.Parse(json).OfType<JObject>().ToList();
            _voiceCacheAt = DateTime.UtcNow;
            return _voiceCache;
        }
        catch (Exception ex)
        {
            Log?.Invoke($"[TTS] Edge voice list failed: {ex.Message}");
            return _voiceCache ?? new List<JObject>();
        }
    }

    public static async Task<byte[]> SynthesizeAsync(string text, string voice, int rate, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(voice)) voice = "en-US-AriaNeural";

        using var ws = new ClientWebSocket();
        ws.Options.SetRequestHeader("User-Agent", UserAgent);
        ws.Options.SetRequestHeader("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold");
        ws.Options.SetRequestHeader("Pragma", "no-cache");
        ws.Options.SetRequestHeader("Cache-Control", "no-cache");
        ws.Options.SetRequestHeader("Accept-Language", "en-US,en;q=0.9");

        var uri = new Uri(Query("wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1")
                          + "&ConnectionId=" + Guid.NewGuid().ToString("N"));
        await ws.ConnectAsync(uri, ct);

        string stamp = DateTime.UtcNow.ToString("R");
        await SendTextAsync(ws,
            $"X-Timestamp:{stamp}\r\n" +
            "Content-Type:application/json; charset=utf-8\r\n" +
            "Path:speech.config\r\n\r\n" +
            "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{" +
            "\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"}," +
            "\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}", ct);

        int pct = Math.Clamp(rate, -10, 10) * 10;
        string ssml =
            "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
            $"<voice name='{voice}'><prosody rate='{(pct >= 0 ? "+" : "")}{pct}%' pitch='+0Hz'>" +
            Escape(text) + "</prosody></voice></speak>";

        await SendTextAsync(ws,
            $"X-RequestId:{Guid.NewGuid():N}\r\n" +
            "Content-Type:application/ssml+xml\r\n" +
            $"X-Timestamp:{stamp}Z\r\n" +
            "Path:ssml\r\n\r\n" + ssml, ct);

        using var audio = new MemoryStream();
        var buf = new byte[16 * 1024];
        while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            using var frame = new MemoryStream();
            WebSocketReceiveResult res;
            do
            {
                res = await ws.ReceiveAsync(new ArraySegment<byte>(buf), ct);
                if (res.MessageType == WebSocketMessageType.Close) break;
                frame.Write(buf, 0, res.Count);
            } while (!res.EndOfMessage);

            if (res.MessageType == WebSocketMessageType.Close) break;
            var data = frame.ToArray();

            if (res.MessageType == WebSocketMessageType.Text)
            {
                if (Encoding.UTF8.GetString(data).Contains("Path:turn.end")) break;
                continue;
            }

            if (data.Length < 2) continue;
            int headerLen = (data[0] << 8) | data[1];
            int start = 2 + headerLen;
            if (start < data.Length) audio.Write(data, start, data.Length - start);
        }

        try { await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None); } catch { }
        return audio.ToArray();
    }

    private static Task SendTextAsync(ClientWebSocket ws, string msg, CancellationToken ct) =>
        ws.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(msg)),
                     WebSocketMessageType.Text, true, ct);

    private static string Escape(string s) =>
        s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;")
         .Replace("\"", "&quot;").Replace("'", "&apos;");
}
