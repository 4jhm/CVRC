using Microsoft.Data.Sqlite;
using Newtonsoft.Json;

namespace VRCNext.Services;

public class MediaLibraryStore : IDisposable
{
    public class PhotoRow
    {
        public string Path        { get; set; } = "";
        public string Name        { get; set; } = "";
        public string Folder      { get; set; } = "";
        public string Type        { get; set; } = "";
        public long   SizeBytes   { get; set; }
        public string CreatedAt   { get; set; } = "";
        public int    ImgW        { get; set; }
        public int    ImgH        { get; set; }
        public string WorldId     { get; set; } = "";
        public string PlayersJson { get; set; } = "[]";
        public string AuthorName  { get; set; } = "";
        public string AuthorId    { get; set; } = "";
        public bool   Favorited   { get; set; }
        public int    Rating      { get; set; }
    }

    private readonly SqliteConnection _db;
    private readonly object _lock = new();
    private bool _disposed;

    private MediaLibraryStore(SqliteConnection db) { _db = db; }

    public static MediaLibraryStore Load()
    {
        var store = new MediaLibraryStore(Database.OpenMediaConnection());
        store.InitSchema();
        return store;
    }

    public bool NeedsLegacyMigration()
    {
        lock (_lock)
        {
            if (_disposed) return false;
            try { return GetMeta("migrated_json") != "1"; }
            catch { return false; }
        }
    }

    private void InitSchema()
    {
        using var t = _db.CreateCommand();
        t.CommandText = @"CREATE TABLE IF NOT EXISTS user_photos (
            path         TEXT    PRIMARY KEY,
            name         TEXT    NOT NULL DEFAULT '',
            folder       TEXT    NOT NULL DEFAULT '',
            type         TEXT    NOT NULL DEFAULT '',
            size_bytes   INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT    NOT NULL DEFAULT '',
            img_w        INTEGER NOT NULL DEFAULT 0,
            img_h        INTEGER NOT NULL DEFAULT 0,
            world_id     TEXT    NOT NULL DEFAULT '',
            players_json TEXT    NOT NULL DEFAULT '[]',
            author_name  TEXT    NOT NULL DEFAULT '',
            author_id    TEXT    NOT NULL DEFAULT '',
            favorited    INTEGER NOT NULL DEFAULT 0,
            rating       INTEGER NOT NULL DEFAULT 0
        )";
        t.ExecuteNonQuery();

        using var m = _db.CreateCommand();
        m.CommandText = @"CREATE TABLE IF NOT EXISTS media_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT ''
        )";
        m.ExecuteNonQuery();

        foreach (var sql in new[]
        {
            "CREATE INDEX IF NOT EXISTS idx_up_favorited ON user_photos(favorited)",
            "CREATE INDEX IF NOT EXISTS idx_up_rating    ON user_photos(rating)",
            "CREATE INDEX IF NOT EXISTS idx_up_created   ON user_photos(created_at DESC)",
        })
        {
            using var idx = _db.CreateCommand();
            idx.CommandText = sql;
            try { idx.ExecuteNonQuery(); } catch (Exception ex) { CrashHandler.WriteEntry("MediaLibraryStore.Index", ex); }
        }
    }

    private string GetMeta(string key)
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = "SELECT value FROM media_meta WHERE key=$k";
        cmd.Parameters.AddWithValue("$k", key);
        return cmd.ExecuteScalar()?.ToString() ?? "";
    }

    private void SetMeta(string key, string value)
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = "INSERT INTO media_meta(key,value) VALUES($k,$v) ON CONFLICT(key) DO UPDATE SET value=excluded.value";
        cmd.Parameters.AddWithValue("$k", key);
        cmd.Parameters.AddWithValue("$v", value);
        cmd.ExecuteNonQuery();
    }

    public bool MigrateLegacyJson()
    {
        lock (_lock)
        {
            if (_disposed) return false;
            try
            {
                if (GetMeta("migrated_json") == "1") return false;

                var baseDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "VRCNext");
                var favPath = Path.Combine(baseDir, "favorited_images.json");
                var ratPath = Path.Combine(baseDir, "photo_ratings.json");

                using var tx = _db.BeginTransaction();

                if (File.Exists(favPath))
                {
                    var list = JsonConvert.DeserializeObject<List<string>>(File.ReadAllText(favPath)) ?? new();
                    foreach (var p in list.Where(p => !string.IsNullOrEmpty(p)))
                        UpsertFlagLocked(tx, p, "favorited", 1);
                }

                if (File.Exists(ratPath))
                {
                    var map = JsonConvert.DeserializeObject<Dictionary<string, int>>(File.ReadAllText(ratPath)) ?? new();
                    foreach (var kv in map.Where(kv => !string.IsNullOrEmpty(kv.Key) && kv.Value > 0))
                        UpsertFlagLocked(tx, kv.Key, "rating", kv.Value);
                }

                tx.Commit();
                SetMeta("migrated_json", "1");
                return true;
            }
            catch (Exception ex) { CrashHandler.WriteEntry("MediaLibraryStore.MigrateLegacyJson", ex); }
            return false;
        }
    }

    private void UpsertFlagLocked(SqliteTransaction tx, string path, string column, int value)
    {
        using var cmd = _db.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = $@"INSERT INTO user_photos(path,name,{column}) VALUES($p,$n,$v)
            ON CONFLICT(path) DO UPDATE SET {column}=excluded.{column}";
        cmd.Parameters.AddWithValue("$p", path);
        cmd.Parameters.AddWithValue("$n", System.IO.Path.GetFileName(path));
        cmd.Parameters.AddWithValue("$v", value);
        cmd.ExecuteNonQuery();
    }

    public List<PhotoRow> GetAll()
    {
        var list = new List<PhotoRow>();
        lock (_lock)
        {
            if (_disposed) return list;
            try
            {
                using var cmd = _db.CreateCommand();
                cmd.CommandText = @"SELECT path,name,folder,type,size_bytes,created_at,img_w,img_h,
                    world_id,players_json,author_name,author_id,favorited,rating
                    FROM user_photos WHERE folder != '' ORDER BY created_at DESC";
                using var r = cmd.ExecuteReader();
                while (r.Read())
                {
                    list.Add(new PhotoRow
                    {
                        Path        = r.GetString(0),
                        Name        = r.GetString(1),
                        Folder      = r.GetString(2),
                        Type        = r.GetString(3),
                        SizeBytes   = r.GetInt64(4),
                        CreatedAt   = r.GetString(5),
                        ImgW        = r.GetInt32(6),
                        ImgH        = r.GetInt32(7),
                        WorldId     = r.GetString(8),
                        PlayersJson = r.GetString(9),
                        AuthorName  = r.GetString(10),
                        AuthorId    = r.GetString(11),
                        Favorited   = r.GetInt32(12) != 0,
                        Rating      = r.GetInt32(13),
                    });
                }
            }
            catch (Exception ex) { CrashHandler.WriteEntry("MediaLibraryStore.GetAll", ex); }
        }
        return list;
    }

    public Dictionary<string, (long SizeBytes, string CreatedAt, int ImgW, int ImgH)> GetFileState()
    {
        var map = new Dictionary<string, (long, string, int, int)>(StringComparer.OrdinalIgnoreCase);
        lock (_lock)
        {
            if (_disposed) return map;
            try
            {
                using var cmd = _db.CreateCommand();
                cmd.CommandText = "SELECT path,size_bytes,created_at,img_w,img_h FROM user_photos";
                using var r = cmd.ExecuteReader();
                while (r.Read())
                    map[r.GetString(0)] = (r.GetInt64(1), r.GetString(2), r.GetInt32(3), r.GetInt32(4));
            }
            catch (Exception ex) { CrashHandler.WriteEntry("MediaLibraryStore.GetFileState", ex); }
        }
        return map;
    }

    public void UpsertFiles(IEnumerable<PhotoRow> rows)
    {
        lock (_lock)
        {
            if (_disposed) return;
            try
            {
                using var tx = _db.BeginTransaction();
                using var cmd = _db.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText = @"INSERT INTO user_photos(path,name,folder,type,size_bytes,created_at,img_w,img_h)
                    VALUES($p,$n,$f,$t,$s,$c,$w,$h)
                    ON CONFLICT(path) DO UPDATE SET
                        name=excluded.name, folder=excluded.folder, type=excluded.type,
                        size_bytes=excluded.size_bytes, created_at=excluded.created_at,
                        img_w=excluded.img_w, img_h=excluded.img_h";
                var pP = cmd.Parameters.Add("$p", SqliteType.Text);
                var pN = cmd.Parameters.Add("$n", SqliteType.Text);
                var pF = cmd.Parameters.Add("$f", SqliteType.Text);
                var pT = cmd.Parameters.Add("$t", SqliteType.Text);
                var pS = cmd.Parameters.Add("$s", SqliteType.Integer);
                var pC = cmd.Parameters.Add("$c", SqliteType.Text);
                var pW = cmd.Parameters.Add("$w", SqliteType.Integer);
                var pH = cmd.Parameters.Add("$h", SqliteType.Integer);
                foreach (var row in rows)
                {
                    pP.Value = row.Path;      pN.Value = row.Name;
                    pF.Value = row.Folder;    pT.Value = row.Type;
                    pS.Value = row.SizeBytes; pC.Value = row.CreatedAt;
                    pW.Value = row.ImgW;      pH.Value = row.ImgH;
                    cmd.ExecuteNonQuery();
                }
                tx.Commit();
            }
            catch (Exception ex) { CrashHandler.WriteEntry("MediaLibraryStore.UpsertFiles", ex); }
        }
    }

    public void PruneMissing(HashSet<string> existingPaths)
    {
        lock (_lock)
        {
            if (_disposed) return;
            try
            {
                var stale = new List<string>();
                using (var sel = _db.CreateCommand())
                {
                    sel.CommandText = "SELECT path FROM user_photos WHERE folder != ''";
                    using var r = sel.ExecuteReader();
                    while (r.Read())
                    {
                        var p = r.GetString(0);
                        if (!existingPaths.Contains(p)) stale.Add(p);
                    }
                }
                if (stale.Count == 0) return;

                using var tx = _db.BeginTransaction();
                using var del = _db.CreateCommand();
                del.Transaction = tx;
                del.CommandText = "DELETE FROM user_photos WHERE path=$p";
                var pP = del.Parameters.Add("$p", SqliteType.Text);
                foreach (var p in stale) { pP.Value = p; del.ExecuteNonQuery(); }
                tx.Commit();
            }
            catch (Exception ex) { CrashHandler.WriteEntry("MediaLibraryStore.PruneMissing", ex); }
        }
    }

    public void SetAuthor(string path, string authorName, string authorId)
        => UpdateRow(path, "author_name=$a, author_id=$b", authorName, authorId);

    public void SetWorldId(string path, string worldId)
        => UpdateRow(path, "world_id=$a", worldId, null);

    private void UpdateRow(string path, string setClause, string a, string? b)
    {
        lock (_lock)
        {
            if (_disposed) return;
            try
            {
                using var cmd = _db.CreateCommand();
                cmd.CommandText = $"UPDATE user_photos SET {setClause} WHERE path=$p";
                cmd.Parameters.AddWithValue("$p", path);
                cmd.Parameters.AddWithValue("$a", a);
                if (b != null) cmd.Parameters.AddWithValue("$b", b);
                cmd.ExecuteNonQuery();
            }
            catch (Exception ex) { CrashHandler.WriteEntry("MediaLibraryStore.UpdateRow", ex); }
        }
    }

    public void SetFavorite(string path, bool favorited)
    {
        lock (_lock)
        {
            if (_disposed) return;
            try
            {
                using var cmd = _db.CreateCommand();
                cmd.CommandText = @"INSERT INTO user_photos(path,name,favorited) VALUES($p,$n,$v)
                    ON CONFLICT(path) DO UPDATE SET favorited=excluded.favorited";
                cmd.Parameters.AddWithValue("$p", path);
                cmd.Parameters.AddWithValue("$n", System.IO.Path.GetFileName(path));
                cmd.Parameters.AddWithValue("$v", favorited ? 1 : 0);
                cmd.ExecuteNonQuery();
            }
            catch (Exception ex) { CrashHandler.WriteEntry("MediaLibraryStore.SetFavorite", ex); }
        }
    }

    public void SetRating(string path, int stars)
    {
        lock (_lock)
        {
            if (_disposed) return;
            try
            {
                using var cmd = _db.CreateCommand();
                cmd.CommandText = @"INSERT INTO user_photos(path,name,rating) VALUES($p,$n,$v)
                    ON CONFLICT(path) DO UPDATE SET rating=excluded.rating";
                cmd.Parameters.AddWithValue("$p", path);
                cmd.Parameters.AddWithValue("$n", System.IO.Path.GetFileName(path));
                cmd.Parameters.AddWithValue("$v", stars);
                cmd.ExecuteNonQuery();
            }
            catch (Exception ex) { CrashHandler.WriteEntry("MediaLibraryStore.SetRating", ex); }
        }
    }

    public void SetRatings(IEnumerable<KeyValuePair<string, int>> items)
    {
        lock (_lock)
        {
            if (_disposed) return;
            try
            {
                using var tx = _db.BeginTransaction();
                using var cmd = _db.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText = @"INSERT INTO user_photos(path,name,rating) VALUES($p,$n,$v)
                    ON CONFLICT(path) DO UPDATE SET rating=excluded.rating";
                var pP = cmd.Parameters.Add("$p", SqliteType.Text);
                var pN = cmd.Parameters.Add("$n", SqliteType.Text);
                var pV = cmd.Parameters.Add("$v", SqliteType.Integer);
                foreach (var kv in items)
                {
                    pP.Value = kv.Key;
                    pN.Value = System.IO.Path.GetFileName(kv.Key);
                    pV.Value = kv.Value;
                    cmd.ExecuteNonQuery();
                }
                tx.Commit();
            }
            catch (Exception ex) { CrashHandler.WriteEntry("MediaLibraryStore.SetRatings", ex); }
        }
    }

    public void Delete(string path)
    {
        lock (_lock)
        {
            if (_disposed) return;
            try
            {
                using var cmd = _db.CreateCommand();
                cmd.CommandText = "DELETE FROM user_photos WHERE path=$p";
                cmd.Parameters.AddWithValue("$p", path);
                cmd.ExecuteNonQuery();
            }
            catch (Exception ex) { CrashHandler.WriteEntry("MediaLibraryStore.Delete", ex); }
        }
    }

    public List<string> GetFavorites()
    {
        var list = new List<string>();
        lock (_lock)
        {
            if (_disposed) return list;
            try
            {
                using var cmd = _db.CreateCommand();
                cmd.CommandText = "SELECT path FROM user_photos WHERE favorited=1";
                using var r = cmd.ExecuteReader();
                while (r.Read()) list.Add(r.GetString(0));
            }
            catch (Exception ex) { CrashHandler.WriteEntry("MediaLibraryStore.GetFavorites", ex); }
        }
        return list;
    }

    public Dictionary<string, int> GetRatings()
    {
        var map = new Dictionary<string, int>();
        lock (_lock)
        {
            if (_disposed) return map;
            try
            {
                using var cmd = _db.CreateCommand();
                cmd.CommandText = "SELECT path,rating FROM user_photos WHERE rating > 0";
                using var r = cmd.ExecuteReader();
                while (r.Read()) map[r.GetString(0)] = r.GetInt32(1);
            }
            catch (Exception ex) { CrashHandler.WriteEntry("MediaLibraryStore.GetRatings", ex); }
        }
        return map;
    }

    public void Dispose()
    {
        lock (_lock)
        {
            if (_disposed) return;
            _disposed = true;
            try { _db.Dispose(); } catch (Exception ex) { CrashHandler.WriteEntry("MediaLibraryStore.Dispose", ex); }
        }
    }
}
