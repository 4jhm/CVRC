using Newtonsoft.Json.Linq;

namespace VRCNext.Services;

public class EconomyAPI(VRChatApiService ctx)
{
    public async Task<int> GetBalanceAsync()
    {
        if (!ctx.IsLoggedIn) return -1;
        try
        {
            var resp = await ctx._http.GetAsync($"{VRChatApiService.BASE}/user/{ctx.CurrentUserId}/balance");
            if (resp.IsSuccessStatusCode)
            {
                var obj = JObject.Parse(await resp.Content.ReadAsStringAsync());
                return obj["balance"]?.Value<int>() ?? obj["varBalance"]?.Value<int>() ?? -1;
            }
            ctx.Log($"GetBalance failed: {(int)resp.StatusCode} — {await resp.Content.ReadAsStringAsync()}");
        }
        catch (Exception ex) { ctx.Log($"GetBalance exception: {ex.Message}"); }
        return -1;
    }

    public async Task<int> GetOnlineCountAsync()
    {
        try
        {
            var resp = await ctx._http.GetAsync($"{VRChatApiService.BASE}/visits");
            var body = await resp.Content.ReadAsStringAsync();
            if (resp.IsSuccessStatusCode && int.TryParse(body.Trim(), out var count))
                return count;
        }
        catch (Exception ex) { ctx.Log($"GetOnlineCount exception: {ex.Message}"); }
        return 0;
    }
}
