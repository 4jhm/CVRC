using Microsoft.Data.Sqlite;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace VRCNext.Services;

public class LocalFavoritesStore : IDisposable
{
    public const int MaxGroups = 100;
    public const int MaxItems  = 200;

    public class LocalGroup
    {
        public string Name        { get; set; } = "";
        public string DisplayName { get; set; } = "";
        public string Kind        { get; set; } = "";
        public int    SortIndex   { get; set; }
        public int    Count       { get; set; }
    }

    public class LocalItem
    {
        public string  Id        { get; set; } = "";
        public string  GroupName { get; set; } = "";
        public string  Kind      { get; set; } = "";
        public string  EntityId  { get; set; } = "";
        public JObject Snapshot  { get; set; } = new();
    }

    private readonly SqliteConnection _db;
    private readonly object _lock = new();
    private bool _disposed;

    private LocalFavoritesStore(SqliteConnection db) { _db = db; }

    public static LocalFavoritesStore Load()
    {
        var conn  = Database.OpenConnection();
        var store = new LocalFavoritesStore(conn);
        store.InitSchema();
        return store;
    }

    private void InitSchema()
    {
        using var g = _db.CreateCommand();
        g.CommandText = @"CREATE TABLE IF NOT EXISTS local_fav_groups (
            group_name   TEXT    PRIMARY KEY,
            kind         TEXT    NOT NULL DEFAULT '',
            display_name TEXT    NOT NULL DEFAULT '',
            sort_index   INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT    NOT NULL DEFAULT ''
        )";
        g.ExecuteNonQuery();

        using var i = _db.CreateCommand();
        i.CommandText = @"CREATE TABLE IF NOT EXISTS local_fav_items (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            group_name   TEXT    NOT NULL DEFAULT '',
            kind         TEXT    NOT NULL DEFAULT '',
            entity_id    TEXT    NOT NULL DEFAULT '',
            name         TEXT    NOT NULL DEFAULT '',
            thumbnail    TEXT    NOT NULL DEFAULT '',
            author_name  TEXT    NOT NULL DEFAULT '',
            author_id    TEXT    NOT NULL DEFAULT '',
            meta_json    TEXT    NOT NULL DEFAULT '{}',
            added_at     TEXT    NOT NULL DEFAULT '',
            UNIQUE(group_name, entity_id)
        )";
        i.ExecuteNonQuery();

        using var idx = _db.CreateCommand();
        idx.CommandText = "CREATE INDEX IF NOT EXISTS idx_lfi_group ON local_fav_items(group_name)";
        try { idx.ExecuteNonQuery(); } catch { }
    }

    public List<LocalGroup> GetGroups(string kind)
    {
        var list = new List<LocalGroup>();
        lock (_lock)
        {
            if (_disposed) return list;
            using var cmd = _db.CreateCommand();
            cmd.CommandText = @"SELECT g.group_name, g.display_name, g.sort_index,
                (SELECT COUNT(*) FROM local_fav_items it WHERE it.group_name = g.group_name) AS cnt
                FROM local_fav_groups g WHERE g.kind = $k ORDER BY g.sort_index ASC";
            cmd.Parameters.AddWithValue("$k", kind);
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                list.Add(new LocalGroup
                {
                    Name        = r.GetString(0),
                    DisplayName = r.GetString(1),
                    Kind        = kind,
                    SortIndex   = r.GetInt32(2),
                    Count       = r.GetInt32(3),
                });
            }
        }
        return list;
    }

    public (bool ok, string error, LocalGroup? group) CreateGroup(string kind, string displayName)
    {
        var name = (displayName ?? "").Trim();
        if (string.IsNullOrEmpty(name)) return (false, "empty_name", null);
        if (name.Length > 64) name = name[..64];
        lock (_lock)
        {
            if (_disposed) return (false, "disposed", null);
            var used = new HashSet<int>();
            int count = 0;
            using (var q = _db.CreateCommand())
            {
                q.CommandText = "SELECT group_name FROM local_fav_groups WHERE kind = $k";
                q.Parameters.AddWithValue("$k", kind);
                using var r = q.ExecuteReader();
                while (r.Read())
                {
                    count++;
                    var gn = r.GetString(0);
                    var us = gn.LastIndexOf('_');
                    if (us >= 0 && int.TryParse(gn[(us + 1)..], out var n)) used.Add(n);
                }
            }
            if (count >= MaxGroups) return (false, "group_limit", null);

            int slot = 1;
            while (used.Contains(slot)) slot++;
            var groupName = $"local{kind}_{slot}";
            var now = DateTime.UtcNow.ToString("o");
            using (var ins = _db.CreateCommand())
            {
                ins.CommandText = @"INSERT INTO local_fav_groups (group_name, kind, display_name, sort_index, created_at)
                    VALUES ($gn, $k, $dn, $si, $ca)";
                ins.Parameters.AddWithValue("$gn", groupName);
                ins.Parameters.AddWithValue("$k",  kind);
                ins.Parameters.AddWithValue("$dn", name);
                ins.Parameters.AddWithValue("$si", slot);
                ins.Parameters.AddWithValue("$ca", now);
                ins.ExecuteNonQuery();
            }
            return (true, "", new LocalGroup { Name = groupName, DisplayName = name, Kind = kind, SortIndex = slot, Count = 0 });
        }
    }

    public bool RenameGroup(string groupName, string displayName)
    {
        var name = (displayName ?? "").Trim();
        if (string.IsNullOrEmpty(name)) return false;
        if (name.Length > 64) name = name[..64];
        lock (_lock)
        {
            if (_disposed) return false;
            using var cmd = _db.CreateCommand();
            cmd.CommandText = "UPDATE local_fav_groups SET display_name = $dn WHERE group_name = $gn";
            cmd.Parameters.AddWithValue("$dn", name);
            cmd.Parameters.AddWithValue("$gn", groupName);
            return cmd.ExecuteNonQuery() > 0;
        }
    }

    public bool DeleteGroup(string groupName)
    {
        lock (_lock)
        {
            if (_disposed) return false;
            using (var di = _db.CreateCommand())
            {
                di.CommandText = "DELETE FROM local_fav_items WHERE group_name = $gn";
                di.Parameters.AddWithValue("$gn", groupName);
                di.ExecuteNonQuery();
            }
            using var dg = _db.CreateCommand();
            dg.CommandText = "DELETE FROM local_fav_groups WHERE group_name = $gn";
            dg.Parameters.AddWithValue("$gn", groupName);
            return dg.ExecuteNonQuery() > 0;
        }
    }

    public bool IsLocalGroup(string groupName) =>
        !string.IsNullOrEmpty(groupName) && groupName.StartsWith("local");

    public static bool IsLocalId(string? id) =>
        !string.IsNullOrEmpty(id) && id!.StartsWith("local:");

    public (bool ok, string error, string localId) AddItem(string groupName, string kind, string entityId, JObject snapshot)
    {
        if (string.IsNullOrEmpty(entityId)) return (false, "no_entity", "");
        lock (_lock)
        {
            if (_disposed) return (false, "disposed", "");

            string gKind;
            using (var gk = _db.CreateCommand())
            {
                gk.CommandText = "SELECT kind FROM local_fav_groups WHERE group_name = $gn";
                gk.Parameters.AddWithValue("$gn", groupName);
                var res = gk.ExecuteScalar();
                if (res == null) return (false, "no_group", "");
                gKind = res.ToString() ?? "";
            }
            if (!string.IsNullOrEmpty(kind) && gKind != kind) return (false, "kind_mismatch", "");

            using (var existing = _db.CreateCommand())
            {
                existing.CommandText = "SELECT id FROM local_fav_items WHERE group_name = $gn AND entity_id = $eid";
                existing.Parameters.AddWithValue("$gn", groupName);
                existing.Parameters.AddWithValue("$eid", entityId);
                var ex = existing.ExecuteScalar();
                if (ex != null) return (true, "", $"local:{ex}");
            }

            int count;
            using (var c = _db.CreateCommand())
            {
                c.CommandText = "SELECT COUNT(*) FROM local_fav_items WHERE group_name = $gn";
                c.Parameters.AddWithValue("$gn", groupName);
                count = Convert.ToInt32(c.ExecuteScalar());
            }
            if (count >= MaxItems) return (false, "item_limit", "");

            var snap = snapshot ?? new JObject();
            var name   = snap["name"]?.ToString() ?? "";
            var thumb  = snap["thumbnailImageUrl"]?.ToString() ?? snap["imageUrl"]?.ToString() ?? "";
            var author = snap["authorName"]?.ToString() ?? "";
            var authId = snap["authorId"]?.ToString() ?? "";
            var now    = DateTime.UtcNow.ToString("o");

            using var ins = _db.CreateCommand();
            ins.CommandText = @"INSERT INTO local_fav_items (group_name, kind, entity_id, name, thumbnail, author_name, author_id, meta_json, added_at)
                VALUES ($gn, $k, $eid, $nm, $th, $an, $ai, $mj, $at);
                SELECT last_insert_rowid();";
            ins.Parameters.AddWithValue("$gn", groupName);
            ins.Parameters.AddWithValue("$k",  gKind);
            ins.Parameters.AddWithValue("$eid", entityId);
            ins.Parameters.AddWithValue("$nm", name);
            ins.Parameters.AddWithValue("$th", thumb);
            ins.Parameters.AddWithValue("$an", author);
            ins.Parameters.AddWithValue("$ai", authId);
            ins.Parameters.AddWithValue("$mj", JsonConvert.SerializeObject(snap));
            ins.Parameters.AddWithValue("$at", now);
            var rowid = ins.ExecuteScalar();
            return (true, "", $"local:{rowid}");
        }
    }

    public bool RemoveItem(string localId)
    {
        if (!IsLocalId(localId)) return false;
        var raw = localId["local:".Length..];
        if (!long.TryParse(raw, out var rowid)) return false;
        lock (_lock)
        {
            if (_disposed) return false;
            using var cmd = _db.CreateCommand();
            cmd.CommandText = "DELETE FROM local_fav_items WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", rowid);
            return cmd.ExecuteNonQuery() > 0;
        }
    }

    public List<LocalItem> GetItems(string kind)
    {
        var list = new List<LocalItem>();
        lock (_lock)
        {
            if (_disposed) return list;
            using var cmd = _db.CreateCommand();
            cmd.CommandText = "SELECT id, group_name, entity_id, meta_json FROM local_fav_items WHERE kind = $k ORDER BY id ASC";
            cmd.Parameters.AddWithValue("$k", kind);
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                JObject snap;
                try { snap = JObject.Parse(r.GetString(3)); } catch { snap = new JObject(); }
                list.Add(new LocalItem
                {
                    Id        = $"local:{r.GetInt64(0)}",
                    GroupName = r.GetString(1),
                    Kind      = kind,
                    EntityId  = r.GetString(2),
                    Snapshot  = snap,
                });
            }
        }
        return list;
    }

    public void Dispose()
    {
        lock (_lock)
        {
            if (_disposed) return;
            _disposed = true;
            try { _db.Dispose(); } catch { }
        }
    }
}
