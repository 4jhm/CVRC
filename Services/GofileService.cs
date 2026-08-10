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

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(20) };
    private readonly Action<string> _log;

    private string? _accountToken;
    private DateTime _accountTokenAt = DateTime.MinValue;

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
}
