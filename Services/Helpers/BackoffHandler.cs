using System.Collections.Concurrent;
using System.Net;

namespace VRCNext.Services.Helpers;

public class BackoffHandler : DelegatingHandler
{
    public const string NoBackoffHeader = "X-VRCNext-NoBackoff";

    private static readonly int[] _delays = [30, 60, 300, 900];
    private readonly ConcurrentDictionary<string, int> _attempts = new();
    private readonly Action<string>? _log;

    public BackoffHandler(HttpMessageHandler inner, Action<string>? log = null) : base(inner) => _log = log;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        if (request.Headers.Contains(NoBackoffHeader))
        {
            request.Headers.Remove(NoBackoffHeader);
            return await base.SendAsync(request, ct);
        }

        byte[]? body = null;
        string? contentType = null;
        if (request.Content != null)
        {
            body = await request.Content.ReadAsByteArrayAsync(ct);
            contentType = request.Content.Headers.ContentType?.ToString();
        }

        var key = request.RequestUri?.PathAndQuery ?? "";

        while (true)
        {
            var clone = Clone(request, body, contentType);
            var resp = await base.SendAsync(clone, ct);
            if (resp.StatusCode != HttpStatusCode.TooManyRequests)
            {
                _attempts.TryRemove(key, out _);
                return resp;
            }
            var n = _attempts.AddOrUpdate(key, 1, (_, v) => v + 1);
            var delay = _delays[Math.Min(n - 1, _delays.Length - 1)];
            _log?.Invoke($"[Backoff] 429 on {key} (attempt {n}), waiting {delay}s");
            resp.Dispose();
            await Task.Delay(TimeSpan.FromSeconds(delay), ct);
        }
    }

    private static HttpRequestMessage Clone(HttpRequestMessage src, byte[]? body, string? contentType)
    {
        var m = new HttpRequestMessage(src.Method, src.RequestUri);
        foreach (var h in src.Headers)
            m.Headers.TryAddWithoutValidation(h.Key, h.Value);
        if (body != null)
        {
            m.Content = new ByteArrayContent(body);
            if (contentType != null)
                m.Content.Headers.TryAddWithoutValidation("Content-Type", contentType);
        }
        return m;
    }
}
