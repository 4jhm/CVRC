using Microsoft.Data.Sqlite;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace VRCNext.Services.VRCNPlusAPI;

public class VRCNPlusService : IDisposable
{
    public const string ApiBase = "https://vrcn.shinyflvres.com/api/api.php";
    private static readonly TimeSpan CacheFreshness = TimeSpan.FromMinutes(15);

    private readonly SqliteConnection _db;
    private readonly HttpClient _http;
    private bool _disposed;

    public VRCNPlusService()
    {
        _db = Database.OpenVRCNPlusConnection();
        InitSchema();
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("VRCNext/1.0");
    }

    private void InitSchema()
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = @"
            CREATE TABLE IF NOT EXISTS profile_themes (
                user_id     TEXT PRIMARY KEY,
                colors_json TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                fetched_at  TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS entitlement_cache (
                user_id     TEXT PRIMARY KEY,
                is_plus     INTEGER NOT NULL,
                checked_at  TEXT NOT NULL
            );";
        cmd.ExecuteNonQuery();
    }

    public JObject? GetLocalTheme(string userId)
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = "SELECT colors_json, updated_at, fetched_at FROM profile_themes WHERE user_id = $id";
        cmd.Parameters.AddWithValue("$id", userId);
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return null;
        try
        {
            var colors = JObject.Parse(r.GetString(0));
            return new JObject
            {
                ["userId"]    = userId,
                ["colors"]    = colors,
                ["updatedAt"] = r.GetString(1),
                ["fetchedAt"] = r.GetString(2),
            };
        }
        catch { return null; }
    }

    public bool IsCacheFresh(string userId)
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = "SELECT fetched_at FROM profile_themes WHERE user_id = $id";
        cmd.Parameters.AddWithValue("$id", userId);
        var s = cmd.ExecuteScalar() as string;
        if (string.IsNullOrEmpty(s)) return false;
        if (!DateTime.TryParse(s, out var t)) return false;
        return (DateTime.UtcNow - t.ToUniversalTime()) < CacheFreshness;
    }

    private void UpsertLocalTheme(string userId, JObject colors, string updatedAt)
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO profile_themes (user_id, colors_json, updated_at, fetched_at)
            VALUES ($id, $json, $upd, $fetched)
            ON CONFLICT(user_id) DO UPDATE SET
                colors_json = excluded.colors_json,
                updated_at  = excluded.updated_at,
                fetched_at  = excluded.fetched_at";
        cmd.Parameters.AddWithValue("$id", userId);
        cmd.Parameters.AddWithValue("$json", colors.ToString(Formatting.None));
        cmd.Parameters.AddWithValue("$upd", string.IsNullOrEmpty(updatedAt) ? DateTime.UtcNow.ToString("o") : updatedAt);
        cmd.Parameters.AddWithValue("$fetched", DateTime.UtcNow.ToString("o"));
        cmd.ExecuteNonQuery();
    }

    private void DeleteLocalTheme(string userId)
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = "DELETE FROM profile_themes WHERE user_id = $id";
        cmd.Parameters.AddWithValue("$id", userId);
        cmd.ExecuteNonQuery();
    }

    public async Task<bool> CheckEntitlementAsync(string userId, bool forceRefresh = false)
    {
        if (!forceRefresh)
        {
            using var rd = _db.CreateCommand();
            rd.CommandText = "SELECT is_plus, checked_at FROM entitlement_cache WHERE user_id = $id";
            rd.Parameters.AddWithValue("$id", userId);
            using var r = rd.ExecuteReader();
            if (r.Read())
            {
                var checkedAt = r.GetString(1);
                if (DateTime.TryParse(checkedAt, out var t) &&
                    (DateTime.UtcNow - t.ToUniversalTime()) < TimeSpan.FromMinutes(5))
                {
                    return r.GetInt32(0) == 1;
                }
            }
        }

        var isPlus = false;
        try
        {
            var url  = $"{ApiBase}?action=checkEntitlement&userId={Uri.EscapeDataString(userId)}";
            var resp = await _http.GetAsync(url);
            if (resp.IsSuccessStatusCode)
            {
                var body = JObject.Parse(await resp.Content.ReadAsStringAsync());
                isPlus = body["ok"]?.Value<bool>() == true && body["isPlus"]?.Value<bool>() == true;
            }
        }
        catch { return false; }

        using var up = _db.CreateCommand();
        up.CommandText = @"
            INSERT INTO entitlement_cache (user_id, is_plus, checked_at)
            VALUES ($id, $p, $t)
            ON CONFLICT(user_id) DO UPDATE SET is_plus = excluded.is_plus, checked_at = excluded.checked_at";
        up.Parameters.AddWithValue("$id", userId);
        up.Parameters.AddWithValue("$p", isPlus ? 1 : 0);
        up.Parameters.AddWithValue("$t", DateTime.UtcNow.ToString("o"));
        up.ExecuteNonQuery();
        return isPlus;
    }

    public async Task<(JObject? theme, bool? isPlus)> FetchRemoteThemeAsync(string userId)
    {
        try
        {
            var url  = $"{ApiBase}?action=getTheme&userId={Uri.EscapeDataString(userId)}";
            var resp = await _http.GetAsync(url);
            if (!resp.IsSuccessStatusCode) return (null, null);
            var body = JObject.Parse(await resp.Content.ReadAsStringAsync());
            if (body["ok"]?.Value<bool>() != true) return (null, null);

            bool? isPlus = body["isPlus"]?.Type == JTokenType.Boolean ? body["isPlus"]!.Value<bool>() : (bool?)null;

            var theme = body["theme"] as JObject;
            if (theme == null)
            {
                DeleteLocalTheme(userId);
                return (new JObject { ["userId"] = userId, ["colors"] = null }, isPlus);
            }
            var colors    = theme["colors"] as JObject ?? new JObject();
            var updatedAt = theme["updatedAt"]?.ToString() ?? DateTime.UtcNow.ToString("o");
            UpsertLocalTheme(userId, colors, updatedAt);
            return (new JObject
            {
                ["userId"]    = userId,
                ["colors"]    = colors,
                ["updatedAt"] = updatedAt,
            }, isPlus);
        }
        catch { return (null, null); }
    }

    public async Task<(bool ok, string? error, JObject? theme)> SaveRemoteThemeAsync(string userId, JObject colors)
    {
        try
        {
            var url     = $"{ApiBase}?action=saveTheme&userId={Uri.EscapeDataString(userId)}";
            var payload = new JObject { ["colors"] = colors }.ToString(Formatting.None);
            var content = new StringContent(payload, System.Text.Encoding.UTF8, "application/json");
            var resp    = await _http.PostAsync(url, content);
            var raw     = await resp.Content.ReadAsStringAsync();
            JObject? body = null;
            try { body = JObject.Parse(raw); }
            catch { return (false, $"HTTP {(int)resp.StatusCode}: server returned non-JSON ({raw.Length}b): {raw.Substring(0, Math.Min(200, raw.Length))}", null); }
            if (body["ok"]?.Value<bool>() != true)
                return (false, body["error"]?.ToString() ?? $"HTTP {(int)resp.StatusCode}", null);

            var theme    = body["theme"] as JObject ?? new JObject { ["colors"] = colors };
            var cleaned  = theme["colors"] as JObject ?? colors;
            UpsertLocalTheme(userId, cleaned, DateTime.UtcNow.ToString("o"));
            return (true, null, new JObject
            {
                ["userId"]    = userId,
                ["colors"]    = cleaned,
                ["updatedAt"] = DateTime.UtcNow.ToString("o"),
            });
        }
        catch (Exception e) { return (false, e.Message, null); }
    }

    public async Task<(bool ok, string? error, bool? isPlus)> AdminCallAsync(string action, string callerUserId, string targetUserId, string? note = null)
    {
        try
        {
            var url     = $"{ApiBase}?action={Uri.EscapeDataString(action)}&userId={Uri.EscapeDataString(targetUserId)}";
            var payload = new JObject {
                ["callerUserId"] = callerUserId,
                ["adminToken"]   = BuildSecrets.VrcnPlusAdminToken,
            };
            if (!string.IsNullOrEmpty(note)) payload["note"] = note;
            var content = new StringContent(payload.ToString(Formatting.None), System.Text.Encoding.UTF8, "application/json");
            var resp    = await _http.PostAsync(url, content);
            var raw     = await resp.Content.ReadAsStringAsync();
            JObject? body = null;
            try { body = JObject.Parse(raw); }
            catch { return (false, $"HTTP {(int)resp.StatusCode}: non-JSON response: {raw.Substring(0, Math.Min(200, raw.Length))}", null); }
            if (body["ok"]?.Value<bool>() != true)
                return (false, body["error"]?.ToString() ?? $"HTTP {(int)resp.StatusCode}", null);
            bool? isPlus = body["isPlus"]?.Type == JTokenType.Boolean ? body["isPlus"]!.Value<bool>() : (bool?)null;
            return (true, null, isPlus);
        }
        catch (Exception e) { return (false, e.Message, null); }
    }

    public async Task<(bool ok, string? error)> DeleteRemoteThemeAsync(string userId)
    {
        try
        {
            var url     = $"{ApiBase}?action=deleteTheme&userId={Uri.EscapeDataString(userId)}";
            var content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
            var resp    = await _http.PostAsync(url, content);
            var body    = JObject.Parse(await resp.Content.ReadAsStringAsync());
            if (body["ok"]?.Value<bool>() != true)
                return (false, body["error"]?.ToString() ?? $"HTTP {(int)resp.StatusCode}");
            DeleteLocalTheme(userId);
            return (true, null);
        }
        catch (Exception e) { return (false, e.Message); }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { _http.Dispose(); } catch { }
        try { _db.Dispose();   } catch { }
    }
}
