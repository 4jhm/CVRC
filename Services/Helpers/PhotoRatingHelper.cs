namespace VRCNext.Services.Helpers;

// Reads and writes the native OS file rating. need to add linux support later.
public static class PhotoRatingHelper
{
#if WINDOWS
    private static uint StarsToRatingValue(int stars) => stars switch
    {
        1 => 1,
        2 => 25,
        3 => 50,
        4 => 75,
        5 => 99,
        _ => 0,
    };

    private static int RatingValueToStars(int value) => value switch
    {
        <= 0  => 0,
        <= 12 => 1,
        <= 37 => 2,
        <= 62 => 3,
        <= 87 => 4,
        _     => 5,
    };

    public static async Task<int> GetRatingAsync(string path)
    {
        try
        {
            var file = await Windows.Storage.StorageFile.GetFileFromPathAsync(path);
            var props = await file.Properties.RetrievePropertiesAsync(new[] { "System.Rating" });
            if (props.TryGetValue("System.Rating", out var raw) && raw != null)
                return RatingValueToStars(Convert.ToInt32(raw));
        }
        catch { }
        return 0;
    }

    public static async Task<bool> SetRatingAsync(string path, int stars)
    {
        try
        {
            var file = await Windows.Storage.StorageFile.GetFileFromPathAsync(path);
            var props = new Dictionary<string, object> { ["System.Rating"] = StarsToRatingValue(stars) };
            await file.Properties.SavePropertiesAsync(props);
            return true;
        }
        catch { return false; }
    }
#else
    public static Task<int> GetRatingAsync(string path) => Task.FromResult(0);
    public static Task<bool> SetRatingAsync(string path, int stars) => Task.FromResult(false);
#endif
}
