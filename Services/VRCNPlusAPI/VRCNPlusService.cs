using Microsoft.Data.Sqlite;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace VRCNext.Services.VRCNPlusAPI;

// Profile color customization — stored locally only. Previously gated behind a remote
// "VRCN+" subscription check against the original VRCNext developer's own paid server;
// CVRC drops that dependency entirely so the feature is free and works offline for
// everyone, at the cost of no longer syncing/showing other users' chosen colors.
public class VRCNPlusService : IDisposable
{
    private readonly SqliteConnection _db;
    private bool _disposed;

    public VRCNPlusService()
    {
        _db = Database.OpenVRCNPlusConnection();
        InitSchema();
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

    public (bool ok, string? error, JObject? theme) SaveLocalTheme(string userId, JObject colors)
    {
        try
        {
            var updatedAt = DateTime.UtcNow.ToString("o");
            UpsertLocalTheme(userId, colors, updatedAt);
            return (true, null, new JObject
            {
                ["userId"]    = userId,
                ["colors"]    = colors,
                ["updatedAt"] = updatedAt,
            });
        }
        catch (Exception e) { return (false, e.Message, null); }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { _db.Dispose(); } catch { }
    }
}
