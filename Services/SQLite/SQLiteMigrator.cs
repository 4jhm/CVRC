namespace VRCNext.Services;

public static class SQLiteMigrator
{
    // Scans all photo timeline entries and removes any whose file no longer exists on disk.
    public static async Task PruneOrphanedTimelinePhotosAsync(
        TimelineService timeline,
        Action<int>?    onProgress = null,
        Action<string>? onDeleted  = null)
    {
        await Task.Delay(4000); 
        await Task.Run(() =>
        {
            onProgress?.Invoke(1);
            var deleted = timeline.PruneOrphanedPhotos(onProgress);
            foreach (var id in deleted)
                onDeleted?.Invoke(id);
            onProgress?.Invoke(-1);
        });
    }
}
