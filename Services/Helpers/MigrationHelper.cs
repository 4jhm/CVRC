using Microsoft.Data.Sqlite;
using Newtonsoft.Json;

namespace VRCNext.Services.Helpers;

public static class FavoritedImagesStore
{
    private static readonly string FilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "VRCNext", "favorited_images.json");

    public static List<string> Load()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                var json = File.ReadAllText(FilePath);
                return JsonConvert.DeserializeObject<List<string>>(json) ?? new();
            }
        }
        catch { }
        return new();
    }

    public static void Save(List<string> items)
    {
        try
        {
            var dir = Path.GetDirectoryName(FilePath)!;
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            File.WriteAllText(FilePath, JsonConvert.SerializeObject(items, Formatting.Indented));
        }
        catch { }
    }
}

public static class MigrationHelper
{
    public static void MigrateFavorites(AppSettings settings)
    {
        if (settings.Favorites.Count == 0) return;

        var existing = FavoritedImagesStore.Load();
        foreach (var path in settings.Favorites)
            if (!existing.Contains(path))
                existing.Add(path);

        FavoritedImagesStore.Save(existing);

        settings.Favorites.Clear();
        settings.Save();
    }

    public static void MigrateBuiltInDashboardTheme(AppSettings settings)
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "VRCNext", "custom-themes", "Dashboard Theme");
        try { if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true); } catch { }

        bool changed = settings.ActiveCustomThemes.Remove("Dashboard Theme");
        if (!settings.ActiveCustomThemes.Contains("VRCNext v2 Preview"))
        {
            settings.ActiveCustomThemes.Insert(0, "VRCNext v2 Preview");
            changed = true;
        }
        if (changed) settings.Save();
    }

    public static async Task MigrateUserTrackingCountsAsync(AppSettings settings, Action<int>? onProgress = null)
    {
        if (settings.UserTrackingCountsMigrated) return;

        // Wait for the app to finish loading before touching the DB
        await Task.Delay(5000);
        onProgress?.Invoke(1);

        try
        {
            using var db = Database.OpenConnection();

            // Phase 1: one scan for all meet_again counts (uses idx_events_type index)
            var meetCounts = new Dictionary<string, long>();
            using (var cmd = db.CreateCommand())
            {
                cmd.CommandText = "SELECT user_id, COUNT(*) FROM events WHERE type='meet_again' AND user_id!='' GROUP BY user_id";
                using var r = cmd.ExecuteReader();
                while (r.Read()) meetCounts[r.GetString(0)] = r.GetInt64(1);
            }
            onProgress?.Invoke(15);

            // Phase 2: one scan for all first_meet dates
            var firstMeets = new Dictionary<string, string>();
            using (var cmd = db.CreateCommand())
            {
                cmd.CommandText = "SELECT user_id, MIN(timestamp) FROM events WHERE type='first_meet' AND user_id!='' GROUP BY user_id";
                using var r = cmd.ExecuteReader();
                while (r.Read()) firstMeets[r.GetString(0)] = r.GetString(1);
            }
            onProgress?.Invoke(25);

            // Phase 3: write in small batches so SQLite is never locked for long
            var allIds = new HashSet<string>(meetCounts.Keys);
            allIds.UnionWith(firstMeets.Keys);
            var total = Math.Max(allIds.Count, 1);
            int done  = 0;

            var batch = new List<string>(50);
            foreach (var uid in allIds)
            {
                batch.Add(uid);
                if (batch.Count >= 50)
                {
                    ApplyMeetCountBatch(db, batch, meetCounts, firstMeets);
                    done += batch.Count;
                    batch.Clear();
                    onProgress?.Invoke(25 + (int)(done * 73.0 / total));
                    await Task.Delay(20);
                }
            }
            if (batch.Count > 0)
            {
                ApplyMeetCountBatch(db, batch, meetCounts, firstMeets);
                done += batch.Count;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Migration] MigrateUserTrackingCounts failed: {ex.Message}");
            onProgress?.Invoke(-1);
            return;
        }

        onProgress?.Invoke(100);
        settings.UserTrackingCountsMigrated = true;
        settings.Save();
    }

    private static void ApplyMeetCountBatch(
        SqliteConnection db,
        List<string> userIds,
        Dictionary<string, long> meetCounts,
        Dictionary<string, string> firstMeets)
    {
        using var tx  = db.BeginTransaction();
        using var ins = db.CreateCommand();
        using var upd = db.CreateCommand();
        ins.Transaction = tx;
        upd.Transaction = tx;

        ins.CommandText = @"INSERT OR IGNORE INTO user_tracking
            (user_id, total_seconds, last_seen, last_seen_location, display_name, image, first_meet_date, meet_again_count)
            VALUES ($uid, 0, '', '', '', '', $fm, $ma)";
        var pInsUid = ins.Parameters.Add("$uid", SqliteType.Text);
        var pInsFm  = ins.Parameters.Add("$fm",  SqliteType.Text);
        var pInsMa  = ins.Parameters.Add("$ma",  SqliteType.Integer);

        upd.CommandText = @"UPDATE user_tracking SET
            meet_again_count = $ma,
            first_meet_date  = CASE WHEN first_meet_date = '' THEN $fm ELSE first_meet_date END
            WHERE user_id = $uid";
        var pUpdUid = upd.Parameters.Add("$uid", SqliteType.Text);
        var pUpdFm  = upd.Parameters.Add("$fm",  SqliteType.Text);
        var pUpdMa  = upd.Parameters.Add("$ma",  SqliteType.Integer);

        foreach (var uid in userIds)
        {
            var ma = meetCounts.TryGetValue(uid, out var mc) ? mc : 0L;
            var fm = firstMeets.TryGetValue(uid, out var fd) ? fd : "";

            pInsUid.Value = uid; pInsFm.Value = fm; pInsMa.Value = ma;
            ins.ExecuteNonQuery();

            pUpdUid.Value = uid; pUpdFm.Value = fm; pUpdMa.Value = ma;
            upd.ExecuteNonQuery();
        }
        tx.Commit();
    }

    public static async Task MigrateEventPlayerSessionsAsync(AppSettings settings, Action<int>? onProgress = null)
    {
        if (settings.EventPlayerSessionsMigrated) return;

        // Wait briefly so the DB isn't contended at startup
        await Task.Delay(6000);
        onProgress?.Invoke(1);

        try
        {
            using var db = Database.OpenConnection();

            // Skip rows already in JSON array form (start with '[').
            var rows = new List<(string EventId, string UserId, string Ja, string La)>();
            using (var cmd = db.CreateCommand())
            {
                cmd.CommandText = @"SELECT event_id, user_id, joined_at, left_at FROM event_players
                                    WHERE (joined_at != '' AND joined_at NOT LIKE '[%')
                                       OR (left_at   != '' AND left_at   NOT LIKE '[%')";
                using var r = cmd.ExecuteReader();
                while (r.Read())
                {
                    rows.Add((
                        r.GetString(0),
                        r.GetString(1),
                        r.IsDBNull(2) ? "" : r.GetString(2),
                        r.IsDBNull(3) ? "" : r.GetString(3)));
                }
            }
            onProgress?.Invoke(15);

            var total = Math.Max(rows.Count, 1);
            int done  = 0;
            var batch = new List<(string, string, string, string)>(100);

            foreach (var row in rows)
            {
                batch.Add(row);
                if (batch.Count >= 100)
                {
                    ApplyEventPlayerSessionsBatch(db, batch);
                    done += batch.Count;
                    batch.Clear();
                    onProgress?.Invoke(15 + (int)(done * 80.0 / total));
                    await Task.Delay(15);
                }
            }
            if (batch.Count > 0)
            {
                ApplyEventPlayerSessionsBatch(db, batch);
                done += batch.Count;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Migration] MigrateEventPlayerSessions failed: {ex.Message}");
            onProgress?.Invoke(-1);
            return;
        }

        onProgress?.Invoke(100);
        settings.EventPlayerSessionsMigrated = true;
        settings.Save();
    }

    private static void ApplyEventPlayerSessionsBatch(
        SqliteConnection db,
        List<(string EventId, string UserId, string Ja, string La)> rows)
    {
        using var tx  = db.BeginTransaction();
        using var upd = db.CreateCommand();
        upd.Transaction = tx;
        upd.CommandText = "UPDATE event_players SET joined_at=$ja, left_at=$la WHERE event_id=$eid AND user_id=$uid";
        var pJa  = upd.Parameters.Add("$ja",  SqliteType.Text);
        var pLa  = upd.Parameters.Add("$la",  SqliteType.Text);
        var pEid = upd.Parameters.Add("$eid", SqliteType.Text);
        var pUid = upd.Parameters.Add("$uid", SqliteType.Text);

        foreach (var (eid, uid, ja, la) in rows)
        {
            pJa.Value  = WrapAsJsonArrayIfPlain(ja);
            pLa.Value  = WrapAsJsonArrayIfPlain(la);
            pEid.Value = eid;
            pUid.Value = uid;
            upd.ExecuteNonQuery();
        }
        tx.Commit();
    }

    private static string WrapAsJsonArrayIfPlain(string raw)
    {
        if (string.IsNullOrEmpty(raw)) return "";
        var trimmed = raw.TrimStart();
        if (trimmed.StartsWith("[")) return raw;
        return JsonConvert.SerializeObject(new[] { raw });
    }

    public static async Task CleanDuplicateFriendRemovedAsync(AppSettings settings)
    {
        if (settings.DuplicateFriendRemovedCleaned) return;
        await Task.Delay(7000);

        try
        {
            using var db = Database.OpenConnection();

            using var cmd = db.CreateCommand();
            cmd.CommandText = @"
                DELETE FROM friend_events
                WHERE type = 'friend_removed'
                  AND friend_name = ''
                  AND friend_id <> ''
                  AND EXISTS (
                    SELECT 1 FROM friend_events f2
                    WHERE f2.friend_id = friend_events.friend_id
                      AND f2.type = 'friend_removed'
                      AND f2.friend_name <> ''
                  )";
            cmd.ExecuteNonQuery();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Migration] CleanDuplicateFriendRemoved failed: {ex.Message}");
            return;
        }

        settings.DuplicateFriendRemovedCleaned = true;
        settings.Save();
    }

    public static void MigrateCachesToSubdir()
    {
        var root  = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "VRCNext");
        var subdir = Path.Combine(root, "Caches");

        string[] files =
        [
            "fav_worlds_cache.json",
            "avatars_cache.json",
            "groups_cache.json",
            "friends_cache.json",
            "mutual_cache.json",
        ];

        try { Directory.CreateDirectory(subdir); } catch { }

        foreach (var name in files)
        {
            var oldPath = Path.Combine(root, name);
            var newPath = Path.Combine(subdir, name);
            if (!File.Exists(oldPath)) continue;
            try
            {
                if (!File.Exists(newPath))
                    File.Move(oldPath, newPath);
                else
                    File.Delete(oldPath);
            }
            catch { }
        }
    }

    public static void MigrateAutoStartShortcuts(AppSettings settings)
    {
        if (settings.ExtraExeAutoStartMigrated) return;

        AutoStartShortcutHelper.Sync(settings.ExtraExeDesktop, vr: false);
        AutoStartShortcutHelper.Sync(settings.ExtraExeVR, vr: true);

        settings.ExtraExeAutoStartMigrated = true;
        settings.Save();
    }
}
