using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace VRCNext.Services;

internal static class Database
{
    private static readonly string BaseDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "VRCNext");
    private static readonly string PrimaryDbPath = Path.Combine(BaseDir, "VRCNData.db");

    private static string _currentDbPath = PrimaryDbPath;
    internal static string DbPath => _currentDbPath;

    private static readonly Regex VrcUserIdRegex =
        new(@"^usr_[a-zA-Z0-9-]+$", RegexOptions.Compiled);

    // Validates VRChat UserId format for DB-path resolution and API-response checks.
    internal static bool IsValidVrcUserId(string? id) =>
        !string.IsNullOrEmpty(id) && VrcUserIdRegex.IsMatch(id!);

    // Sets the active DB path from the account, throwing if a secondary lacks a valid UserId.
    internal static void SetActiveAccount(VrcAccount? account)
    {
        if (account == null || account.IsPrimary)
        {
            _currentDbPath = PrimaryDbPath;
            return;
        }
        if (!IsValidVrcUserId(account.UserId))
        {
            throw new InvalidOperationException(
                $"Secondary account '{account.AccountId}' has missing or invalid UserId — cannot resolve DB path.");
        }
        _currentDbPath = Path.Combine(BaseDir, $"{account.UserId}_VRCNData.db");
    }

    internal static SqliteConnection OpenConnection()
    {
        var dir = Path.GetDirectoryName(_currentDbPath)!;
        if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);

        var conn = new SqliteConnection($"Data Source={_currentDbPath}");
        conn.Open();

        using var cmd = conn.CreateCommand();
        cmd.CommandText = "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-1024;";
        cmd.ExecuteNonQuery();

        return conn;
    }

    private static readonly string MediaDbPath = Path.Combine(BaseDir, "MediaLibrary.db");

    internal static SqliteConnection OpenMediaConnection()
    {
        if (!Directory.Exists(BaseDir)) Directory.CreateDirectory(BaseDir);

        var conn = new SqliteConnection($"Data Source={MediaDbPath}");
        conn.Open();

        using var cmd = conn.CreateCommand();
        cmd.CommandText = "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-1024;";
        cmd.ExecuteNonQuery();

        return conn;
    }

    private static readonly string VRCNPlusDbPath = Path.Combine(BaseDir, "VRCNPlus.sqlite");

    internal static SqliteConnection OpenVRCNPlusConnection()
    {
        if (!Directory.Exists(BaseDir)) Directory.CreateDirectory(BaseDir);

        var conn = new SqliteConnection($"Data Source={VRCNPlusDbPath}");
        conn.Open();

        using var cmd = conn.CreateCommand();
        cmd.CommandText = "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-1024;";
        cmd.ExecuteNonQuery();

        return conn;
    }
}
