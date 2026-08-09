namespace VRCNext.Services.Helpers;

public static class IconFrameHelper
{
    public static string UrlFor(string? templateId, InventoryAPI? inventory)
    {
        if (string.IsNullOrEmpty(templateId)) return "";
        var cached = ImageCacheHelper.GetVrcPlusUrlIfCached(templateId);
        if (!string.IsNullOrEmpty(cached)) return cached;
        if (inventory != null) _ = inventory.ResolveDecorationAsync(templateId);
        return "";
    }
}
