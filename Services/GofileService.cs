using System.Net;
using System.Net.Http.Headers;
using Newtonsoft.Json.Linq;

namespace VRCNext.Services;

// Client for Gofile's upload API — used by Avatar Logger to upload avatar files to a
// throwaway guest account (or a user-supplied account/folder). Folder *listing* used to
// live here too (for the Avatar Database tool), but Gofile's official listing endpoint is
// Premium-only, and their internal website fallback is signed with an anti-bot secret that
// Gofile rotates server-side specifically to defeat exactly this kind of reverse-engineering
// — a stale/rejected token there can get the caller's IP banned. Avatar Database now reads a
// manifest generated offline instead (see AvatarDatabaseController + .github/workflows), so
// nothing here touches that endpoint anymore.
public class GofileService
{
    private const string UserAgent = "Mozilla/5.0";

    // 30 min ceiling so large avatar uploads have room; the per-call CancellationTokenSource
    // below applies the same bound explicitly.
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(30) };
    private readonly Action<string> _log;

    public GofileService(Action<string> log) { _log = log; }

    // Reason the most recent upload failed, for surfacing in the UI.
    public string LastUploadError { get; private set; } = "";

    // Uploads a file (anonymously, or into the given account/folder when a token is supplied)
    // and returns its shareable Gofile download page link, or null on failure (see LastUploadError).
    // onProgress(bytesSent, totalBytes) fires as the request body is actually streamed out —
    // HttpClient has no built-in upload-progress API, so this rides a custom HttpContent
    // (see ProgressStreamContent below), the standard workaround for this.
    public async Task<string?> UploadFileAsync(string filePath, string fileName, string? token = null,
        string? folderId = null, Action<long, long>? onProgress = null)
    {
        LastUploadError = "";
        var totalBytes = new FileInfo(filePath).Length;

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

            // Gofile's upload fleet auto-routes to the best storage region behind this one
            // fixed hostname — there's no separate "pick a server" call anymore.
            using var req = new HttpRequestMessage(HttpMethod.Post, "https://upload.gofile.io/uploadfile") { Content = content };
            req.Headers.UserAgent.ParseAdd(UserAgent);
            if (!string.IsNullOrEmpty(token)) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(30));
            using var resp = await _http.SendAsync(req, cts.Token);
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
            {
                LastUploadError = $"HTTP {(int)resp.StatusCode}: {body[..Math.Min(150, body.Length)]}";
                return null;
            }
            var link = JObject.Parse(body)["data"]?["downloadPage"]?.ToString();
            if (!string.IsNullOrEmpty(link)) return link;
            LastUploadError = $"no link in response: {body[..Math.Min(150, body.Length)]}";
            return null;
        }
        catch (Exception ex)
        {
            LastUploadError = $"{ex.GetType().Name}: {ex.Message}";
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
