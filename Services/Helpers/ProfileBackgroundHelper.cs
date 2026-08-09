namespace VRCNext.Services.Helpers;

// VRC+ profile backgrounds. Unlike icon frames these are not inventory items but a
// fixed set of CDN assets, so the file list lives here and the download goes through
// the same VRCPlus image cache as the other decorations.
public static class ProfileBackgroundHelper
{
    private const string AssetBase = "https://assets.vrchat.com/www/profile_decorations/profile_backgrounds/";

    private static readonly Dictionary<string, string> Files = new()
    {
        ["grid"]            = "BG_Grid.png",
        ["filigree"]        = "BG_Cascade.png",
        ["bit-mountain"]    = "BG_GRID_BITS.png",
        ["approach"]        = "BG_Approach.png",
        ["planet-fall"]     = "BG_PlanetFall.png",
        ["jungle"]          = "BG_Jungle.png",
        ["light-streams"]   = "BG_LightStream.png",
        ["koi"]             = "Koi_Layer.png",
        ["moonlight"]       = "BG_Cloud.png",
        ["machine"]         = "TechWallLayer.png",
        ["topology"]        = "TOPOLOGY.png",
        ["circuit"]         = "BG_Circuit.png",
        ["kawaii-cupcakes"] = "BG_Kawaii_cupcakes.png",
        ["bokeh"]           = "BG_Bokeh.png",
        ["hologram"]        = "BG_Shatter.png",
        ["flow"]            = "BG_Flow_Horizontal.png",
        ["jelly"]           = "BG_Jelly.png",
        ["cheese"]          = "BG_Cheese.png",
        ["alchemy"]         = "BG_Alchemy.png",
        ["sunset-mountain"] = "BG_MountainSun.png",
        ["magic-rocks"]     = "BG_MagicRocks.png",
        ["city-stillness"]  = "BG_FutureCityStillness.png",
        ["music"]           = "BG_Music.png",
        ["wolf-running"]    = "BG_WolfRunning.png",
        ["dragon-smoke"]    = "BG_DragonSmoke.png",
        ["night-rain"]      = "BG_NightRain.png",
        ["butterfly-zero"]  = "BG_ButterFlyZERO.png",
        ["i-am-speed"]      = "void.png",
        ["ronin"]           = "BG_Ronin.png",
        ["abduction"]       = "BG_Abduction.png",
        ["cat-dream"]       = "BG_CatDream.png",
        ["virtual-waves"]   = "BG_VirtualWaves.png",
        ["bolt-and-snail"]  = "BG_BoltNSnail.png",
        ["escape"]          = "BG_Escape.png",
    };

    // Prefixed so a texture id can never collide with an inventory template id inside
    // the shared VRCPlus cache folder.
    private static string CacheKey(string textureId) => "bg_" + textureId;

    public static string AssetUrlFor(string? textureId)
    {
        if (string.IsNullOrEmpty(textureId)) return "";
        return Files.TryGetValue(textureId, out var file) ? AssetBase + file : "";
    }

    // Returns the local cached URL when available. On a miss the download is kicked off
    // and the CDN URL is returned, so the image shows immediately and is local next time.
    public static string UrlFor(string? textureId)
    {
        if (string.IsNullOrEmpty(textureId)) return "";
        var assetUrl = AssetUrlFor(textureId);
        if (string.IsNullOrEmpty(assetUrl)) return "";

        var cached = ImageCacheHelper.GetVrcPlusUrlIfCached(CacheKey(textureId));
        if (!string.IsNullOrEmpty(cached)) return cached;

        _ = ImageCacheHelper.CacheVrcPlusAsync(CacheKey(textureId), assetUrl);
        return assetUrl;
    }
}
