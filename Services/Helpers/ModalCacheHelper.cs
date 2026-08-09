using System.Collections.Concurrent;

namespace VRCNext.Services.Helpers;

// Blocks REST API calls for recently opened modals.
// SQLite already handles data caching — this only suppresses redundant network fetches.
public static class ModalCacheHelper
{
    // Cache Timer
    private const int CacheDurationSeconds = 300;
    private const int GroupsMutualsCacheSeconds = 60;

    private static readonly ConcurrentDictionary<string, DateTime> _timestamps = new();
    private static readonly ConcurrentDictionary<string, DateTime> _groupsMutualsTimestamps = new();

    // Returns true if the entity was opened within the cache window (no REST call needed).
    public static bool IsCached(string entityId)
    {
        if (!_timestamps.TryGetValue(entityId, out var time)) return false;
        if (DateTime.UtcNow - time < TimeSpan.FromSeconds(CacheDurationSeconds)) return true;
        _timestamps.TryRemove(entityId, out _);
        return false;
    }

    public static void Mark(string entityId)
    {
        _timestamps[entityId] = DateTime.UtcNow;
    }

    public static bool IsGroupsMutualsCached(string entityId)
    {
        if (!_groupsMutualsTimestamps.TryGetValue(entityId, out var time)) return false;
        if (DateTime.UtcNow - time < TimeSpan.FromSeconds(GroupsMutualsCacheSeconds)) return true;
        _groupsMutualsTimestamps.TryRemove(entityId, out _);
        return false;
    }

    public static void MarkGroupsMutuals(string entityId)
    {
        _groupsMutualsTimestamps[entityId] = DateTime.UtcNow;
    }

    public static void Invalidate(string entityId)
    {
        _timestamps.TryRemove(entityId, out _);
        _groupsMutualsTimestamps.TryRemove(entityId, out _);
    }
}
