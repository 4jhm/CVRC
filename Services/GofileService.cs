using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json.Linq;

namespace VRCNext.Services;

public record GofileEntry(string Name, string Type, long SizeBytes, long CreateTimeUnix, string DownloadLink);

// Client for Gofile's unofficial-but-stable public API — used to list files in a public
// folder (name, size, upload date, direct link) so they can be browsed/sorted in-app.
// Gofile requires a throwaway "guest" account token for every session, and every request
// carries an "X-Website-Token" that their own web client derives from a fixed formula
// (documented by multiple community downloader tools); there is no scraping involved.
public class GofileService
{
    private const string UserAgent = "Mozilla/5.0";
    private const string WebsiteTokenSalt = "9844d94d963d30";

    // 30 min ceiling so large avatar uploads have room; per-call CancellationTokenSources
    // still apply their own (shorter) timeouts for the quick listing/account calls.
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(30) };
    private readonly Action<string> _log;

    private string? _accountToken;
    private DateTime _accountTokenAt = DateTime.MinValue;
    private string? _uploadServer;
    private DateTime _uploadServerAt = DateTime.MinValue;

    public GofileService(Action<string> log) { _log = log; }

    private static string GenerateWebsiteToken(string accountToken)
    {
        var timeSlot = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 14400;
        var raw = $"{UserAgent}::en-US::{accountToken}::{timeSlot}::{WebsiteTokenSalt}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexStringLower(hash);
    }

    private async Task<string?> GetAccountTokenAsync()
    {
        // Guest tokens are effectively long-lived; reuse for an hour before minting a new one.
        if (_accountToken != null && (DateTime.UtcNow - _accountTokenAt).TotalMinutes < 60)
            return _accountToken;

        try
        {
            var wt = GenerateWebsiteToken("");
            using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.gofile.io/accounts");
            req.Headers.Add("X-Website-Token", wt);
            req.Headers.Add("X-BL", "en-US");
            req.Headers.UserAgent.ParseAdd(UserAgent);
            using var resp = await _http.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode) { _log($"[Gofile] Account creation failed: {(int)resp.StatusCode}"); return null; }

            var token = JObject.Parse(body)["data"]?["token"]?.ToString();
            if (string.IsNullOrEmpty(token)) { _log("[Gofile] Account creation returned no token."); return null; }

            _accountToken = token;
            _accountTokenAt = DateTime.UtcNow;
            return token;
        }
        catch (Exception ex)
        {
            _log($"[Gofile] Account creation error: {ex.Message}");
            return null;
        }
    }

    // Reason the most recent upload failed, for surfacing in the UI.
    public string LastUploadError { get; private set; } = "";

    private async Task<string?> GetUploadServerAsync()
    {
        // Avoids an extra round-trip before every single upload — the assigned server doesn't
        // change on a whim, so reuse it for a while instead of asking again each time.
        if (_uploadServer != null && (DateTime.UtcNow - _uploadServerAt).TotalMinutes < 10)
            return _uploadServer;

        foreach (var (url, pick) in new (string, Func<JObject, string?>)[]
        {
            ("https://api.gofile.io/servers",   d => d["data"]?["servers"]?.FirstOrDefault()?["name"]?.ToString()),
            ("https://api.gofile.io/getServer", d => d["data"]?["server"]?.ToString()),
        })
        {
            try
            {
                using var resp = await _http.GetAsync(url);
                if (!resp.IsSuccessStatusCode) continue;
                var body = await resp.Content.ReadAsStringAsync();
                var name = pick(JObject.Parse(body));
                if (!string.IsNullOrEmpty(name))
                {
                    _uploadServer = name;
                    _uploadServerAt = DateTime.UtcNow;
                    return name;
                }
            }
            catch { }
        }
        return null;
    }

    // Uploads a file (anonymously, or into the given account/folder when a token is supplied)
    // and returns its shareable Gofile download page link, or null on failure (see LastUploadError).
    // onProgress(bytesSent, totalBytes) fires as the request body is actually streamed out —
    // HttpClient has no built-in upload-progress API, so this rides a custom HttpContent
    // (see ProgressStreamContent below), the standard workaround for this.
    public async Task<string?> UploadFileAsync(string filePath, string fileName, string? token = null,
        string? folderId = null, Action<long, long>? onProgress = null)
    {
        LastUploadError = "";
        var server = await GetUploadServerAsync();
        if (server == null) { LastUploadError = "couldn't reach a GoFile upload server"; return null; }
        var totalBytes = new FileInfo(filePath).Length;

        foreach (var path in new[] { "contents/uploadfile", "uploadFile" })
        {
            try
            {
                using var content = new MultipartFormDataContent();
                // FileOptions.Asynchronous is required for ReadAsync to actually use OS-level async
                // I/O — File.OpenRead() omits it, which silently downgrades every "async" read to a
                // synchronous read wrapped in a Task. SequentialScan hints the OS to read ahead
                // aggressively, which matters here since the whole file is read start-to-finish once.
                await using var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read,
                    bufferSize: 4096, FileOptions.Asynchronous | FileOptions.SequentialScan);
                using var fileContent = new ProgressStreamContent(fs, totalBytes, onProgress);
                fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
                content.Add(fileContent, "file", fileName);
                if (!string.IsNullOrEmpty(folderId) && !string.IsNullOrEmpty(token))
                    content.Add(new StringContent(folderId), "folderId");

                using var req = new HttpRequestMessage(HttpMethod.Post, $"https://{server}.gofile.io/{path}") { Content = content };
                req.Headers.UserAgent.ParseAdd(UserAgent);
                if (!string.IsNullOrEmpty(token)) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

                using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(30));
                using var resp = await _http.SendAsync(req, cts.Token);
                var body = await resp.Content.ReadAsStringAsync();
                if (!resp.IsSuccessStatusCode)
                {
                    LastUploadError = $"HTTP {(int)resp.StatusCode}: {body[..Math.Min(150, body.Length)]}";
                    continue;
                }
                var link = JObject.Parse(body)["data"]?["downloadPage"]?.ToString();
                if (!string.IsNullOrEmpty(link)) return link;
                LastUploadError = $"no link in response: {body[..Math.Min(150, body.Length)]}";
            }
            catch (Exception ex) { LastUploadError = $"{ex.GetType().Name}: {ex.Message}"; }
        }
        // Whatever went wrong, don't keep handing out a possibly-bad cached server next time.
        _uploadServer = null; _uploadServerAt = DateTime.MinValue;
        return null;
    }

    public Task<List<GofileEntry>?> ListFolderAsync(string contentId) => ListFolderAsync(contentId, allowRetry: true);

    private async Task<List<GofileEntry>?> ListFolderAsync(string contentId, bool allowRetry)
    {
        var accountToken = await GetAccountTokenAsync();
        if (accountToken == null) return null;

        try
        {
            var wt = GenerateWebsiteToken(accountToken);
            var url = $"https://api.gofile.io/contents/{contentId}?cache=true&sortField=createTime&sortDirection=1";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Add("X-Website-Token", wt);
            req.Headers.Add("X-BL", "en-US");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accountToken);
            req.Headers.UserAgent.ParseAdd(UserAgent);
            using var resp = await _http.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();

            // Gofile can return HTTP 200 with a logical error embedded in the JSON body (e.g. a
            // stale/rate-limited guest token) — checking only the HTTP status misses those and
            // previously fell through to "empty folder", showing a misleading "No files found".
            var root = string.IsNullOrEmpty(body) ? null : JObject.Parse(body);
            var status = root?["status"]?.ToString() ?? "";
            if (!resp.IsSuccessStatusCode || status != "ok")
            {
                _log($"[Gofile] Folder listing failed (HTTP {(int)resp.StatusCode}, status='{status}'): {body[..Math.Min(200, body.Length)]}");
                if (allowRetry)
                {
                    _log("[Gofile] Retrying once with a fresh guest account token...");
                    _accountToken = null; _accountTokenAt = DateTime.MinValue;
                    return await ListFolderAsync(contentId, allowRetry: false);
                }
                return null;
            }

            var children = root!["data"]?["children"] as JObject;
            if (children == null)
            {
                _log($"[Gofile] Folder listing had no 'children' object despite status=ok: {body[..Math.Min(200, body.Length)]}");
                return null;
            }

            var result = new List<GofileEntry>();
            foreach (var prop in children.Properties())
            {
                var c = prop.Value as JObject;
                if (c == null) continue;
                result.Add(new GofileEntry(
                    Name: c["name"]?.ToString() ?? "unknown",
                    Type: c["type"]?.ToString() ?? "file",
                    SizeBytes: c["size"]?.Value<long>() ?? 0,
                    CreateTimeUnix: c["createTime"]?.Value<long>() ?? 0,
                    DownloadLink: c["link"]?.ToString() ?? ""
                ));
            }
            return result;
        }
        catch (Exception ex)
        {
            _log($"[Gofile] Folder listing error: {ex.Message}");
            return null;
        }
    }

    // Wraps a readable stream as HttpContent, reporting (bytesSent, totalBytes) as it's
    // actually written out to the request — HttpClient/StreamContent has no progress hook,
    // so overriding SerializeToStreamAsync is the standard way to observe upload progress.
    private sealed class ProgressStreamContent : HttpContent
    {
        // 1 MB chunks instead of the previous 80 KB — for a ~120 MB avatar file that's ~120
        // read/write/await round-trips instead of ~1500, which is where most of the "the
        // network's fine but this feels slow" overhead was actually coming from.
        private const int BufferSize = 1024 * 1024;
        private readonly Stream _source;
        private readonly long _totalBytes;
        private readonly Action<long, long>? _onProgress;

        public ProgressStreamContent(Stream source, long totalBytes, Action<long, long>? onProgress)
        {
            _source = source;
            _totalBytes = totalBytes;
            _onProgress = onProgress;
        }

        protected override async Task SerializeToStreamAsync(Stream stream, TransportContext? context)
        {
            var buffer = new byte[BufferSize];
            long sent = 0;
            int read;
            while ((read = await _source.ReadAsync(buffer, 0, buffer.Length)) > 0)
            {
                await stream.WriteAsync(buffer.AsMemory(0, read));
                sent += read;
                _onProgress?.Invoke(sent, _totalBytes);
            }
        }

        protected override bool TryComputeLength(out long length)
        {
            length = _totalBytes;
            return true;
        }
    }
}
