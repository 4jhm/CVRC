namespace VRCNext;

public static class AppInfo
{
    public const string Version = "2026.41.21";
    public const string ContactEmail = "4jhmweb@gmail.com";
    public const string Website = "github.com/4jhm/CVRC";
    public const string UserAgent = $"CVRC/{Version} ({ContactEmail})";

    public static string SelfExecutable
    {
        get
        {
            var appImage = Environment.GetEnvironmentVariable("APPIMAGE");
            if (!string.IsNullOrEmpty(appImage) && File.Exists(appImage)) return appImage;
            return Environment.ProcessPath ?? "";
        }
    }
}
