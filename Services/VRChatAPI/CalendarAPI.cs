using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace VRCNext.Services;

public class CalendarAPI(VRChatApiService ctx)
{
    public async Task<JArray> GetCalendarEventsAsync(string filter = "all", int year = 0, int month = 0)
    {
        if (!ctx.IsLoggedIn) return new JArray();
        try
        {
            var now = DateTime.UtcNow;
            int y = year  > 0 ? year  : now.Year;
            int m = month > 0 ? month : now.Month;
            var dateStr = Uri.EscapeDataString(new DateTime(y, m, 1, 0, 0, 0, DateTimeKind.Utc).ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));

            var allEvents  = new JArray();
            int pageOffset = 0;
            const int pageSize = 100;

            while (true)
            {
                var endpoint = filter switch {
                    "following" => $"{VRChatApiService.BASE}/calendar/following?n={pageSize}&offset={pageOffset}&date={dateStr}",
                    _           => $"{VRChatApiService.BASE}/calendar?n={pageSize}&offset={pageOffset}&date={dateStr}",
                };
                var resp = await ctx._http.GetAsync(endpoint);
                var body = await resp.Content.ReadAsStringAsync();
                ctx.Log($"GetCalendarEvents({filter},{y}/{m},off={pageOffset}): {(int)resp.StatusCode}, len={body.Length}, preview={body[..Math.Min(300, body.Length)]}");
                if (!resp.IsSuccessStatusCode) break;

                JArray? page = null;
                var token = JToken.Parse(body);
                if (token is JArray arr) page = arr;
                else if (token is JObject obj)
                    foreach (var key in new[] { "results", "events", "data", "items" })
                        if (obj[key] is JArray found) { page = found; break; }

                if (page == null || page.Count == 0) break;
                foreach (var ev in page) allEvents.Add(ev);
                if (page.Count < pageSize) break;
                pageOffset += pageSize;
                if (pageOffset >= pageSize * 5) break;
            }

            ctx.Log($"GetCalendarEvents({filter},{y}/{m}): total={allEvents.Count}");
            return allEvents;
        }
        catch (Exception ex) { ctx.Log($"GetCalendarEvents exception: {ex.Message}"); }
        return new JArray();
    }

    public async Task<JObject?> GetCalendarEventAsync(string groupId, string calendarId)
    {
        if (!ctx.IsLoggedIn) return null;
        try
        {
            var resp = await ctx._http.GetAsync($"{VRChatApiService.BASE}/calendar/{groupId}/{calendarId}");
            var body = await resp.Content.ReadAsStringAsync();
            ctx.Log($"GetCalendarEvent({groupId},{calendarId}): {(int)resp.StatusCode}");
            if (resp.IsSuccessStatusCode) return JObject.Parse(body);
        }
        catch (Exception ex) { ctx.Log($"GetCalendarEvent exception: {ex.Message}"); }
        return null;
    }

    public async Task<JArray> GetGroupEventsAsync(string groupId, int n = 60)
    {
        if (!ctx.IsLoggedIn) return new JArray();
        try
        {
            var resp = await ctx._http.GetAsync($"{VRChatApiService.BASE}/calendar/{groupId}?n={n}&offset=0");
            if (resp.IsSuccessStatusCode)
            {
                var body = await resp.Content.ReadAsStringAsync();
                JToken token;
                using (var reader = new Newtonsoft.Json.JsonTextReader(new System.IO.StringReader(body)) { DateParseHandling = Newtonsoft.Json.DateParseHandling.None })
                    token = JToken.Load(reader);
                if (token is JArray arr) return arr;
                if (token is JObject obj && obj["results"] is JArray results) return results;
                ctx.Log($"GetGroupEvents({groupId}): unexpected shape");
                return new JArray();
            }
            ctx.Log($"GetGroupEvents({groupId}): {(int)resp.StatusCode}");
        }
        catch (Exception ex) { ctx.Log($"GetGroupEvents exception: {ex.Message}"); }
        return new JArray();
    }

    public async Task<JObject?> CreateGroupEventAsync(string groupId, string title, string description, string startsAt, string endsAt, string category, string accessType, bool sendCreationNotification, string? imageId)
    {
        if (!ctx.IsLoggedIn) return null;
        try
        {
            var body = new JObject
            {
                ["title"]                    = title,
                ["description"]              = description,
                ["startsAt"]                 = startsAt,
                ["endsAt"]                   = endsAt,
                ["category"]                 = category,
                ["accessType"]               = accessType,
                ["sendCreationNotification"] = sendCreationNotification,
                ["isDraft"]                  = false,
            };
            if (!string.IsNullOrEmpty(imageId)) body["imageId"] = imageId;
            var resp = await ctx._http.PostAsync($"{VRChatApiService.BASE}/calendar/{groupId}/event",
                new StringContent(body.ToString(Newtonsoft.Json.Formatting.None), Encoding.UTF8, "application/json"));
            var respBody = await resp.Content.ReadAsStringAsync();
            var retryAfter = resp.Headers.TryGetValues("Retry-After", out var ra) ? string.Join(",", ra) : null;
            ctx.Log($"CreateGroupEvent({groupId}): {(int)resp.StatusCode}{(retryAfter != null ? $" retry-after={retryAfter}s" : "")}");
            if (!resp.IsSuccessStatusCode) { ctx.Log($"CreateGroupEvent body: {respBody}"); return null; }
            return JObject.Parse(respBody);
        }
        catch (Exception ex) { ctx.Log($"CreateGroupEvent exception: {ex.Message}"); return null; }
    }

    public async Task<bool> DeleteGroupEventAsync(string groupId, string eventId)
    {
        if (!ctx.IsLoggedIn) return false;
        try
        {
            var resp = await ctx._http.DeleteAsync($"{VRChatApiService.BASE}/calendar/{groupId}/{eventId}");
            ctx.Log($"DeleteGroupEvent({groupId}/{eventId}): {(int)resp.StatusCode}");
            if (!resp.IsSuccessStatusCode)
                ctx.Log($"DeleteGroupEvent body: {await resp.Content.ReadAsStringAsync()}");
            return resp.IsSuccessStatusCode;
        }
        catch (Exception ex) { ctx.Log($"DeleteGroupEvent exception: {ex.Message}"); return false; }
    }

    public async Task<bool> FollowEventAsync(string groupId, string calendarId, bool follow)
    {
        if (!ctx.IsLoggedIn) return false;
        try
        {
            var content = new StringContent($"{{\"isFollowing\":{(follow ? "true" : "false")}}}", Encoding.UTF8, "application/json");
            var resp    = await ctx._http.PostAsync($"{VRChatApiService.BASE}/calendar/{groupId}/{calendarId}/follow", content);
            ctx.Log($"FollowEvent({groupId},{calendarId},{follow}): {(int)resp.StatusCode}");
            return resp.IsSuccessStatusCode;
        }
        catch (Exception ex) { ctx.Log($"FollowEvent exception: {ex.Message}"); return false; }
    }
}
