using System.Text;
using Newtonsoft.Json.Linq;

namespace VRCNext.Services;

public class FilesAPI(VRChatApiService ctx)
{
    public async Task<string?> UploadImageAsync(byte[] imageBytes, string mimeType = "image/png", string ext = ".png")
    {
        if (!ctx.IsLoggedIn) return null;
        try
        {
            using var form = new MultipartFormDataContent();
            form.Add(new StringContent("gallery"), "tag");
            var fileContent = new ByteArrayContent(imageBytes);
            fileContent.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse(mimeType);
            form.Add(fileContent, "file", "image" + ext);

            ctx.Log($"UploadImage mimeType={mimeType} size={imageBytes.Length}");
            var resp = await ctx._http.PostAsync($"{VRChatApiService.BASE}/file/image", form);
            var body = await resp.Content.ReadAsStringAsync();
            ctx.Log($"UploadImage response: {(int)resp.StatusCode} preview={body[..Math.Min(200, body.Length)]}");
            if (!resp.IsSuccessStatusCode) return null;
            return JObject.Parse(body)["id"]?.ToString();
        }
        catch (Exception ex) { ctx.Log($"UploadImage exception: {ex.Message}"); return null; }
    }

    public async Task<JArray> GetInventoryFilesAsync(string tag, int n = 100, int offset = 0)
    {
        if (!ctx.IsLoggedIn) return new JArray();
        try
        {
            var url = $"{VRChatApiService.BASE}/files?tag={Uri.EscapeDataString(tag)}&n={n}&offset={offset}";
            ctx.Log($"GetInventoryFiles tag={tag} n={n} offset={offset}");
            var resp = await ctx._http.GetAsync(url);
            var body = await resp.Content.ReadAsStringAsync();
            ctx.Log($"GetInventoryFiles response: {(int)resp.StatusCode} len={body.Length}");
            if (resp.IsSuccessStatusCode) return JArray.Parse(body);
            ctx.Log($"GetInventoryFiles error: {body[..Math.Min(200, body.Length)]}");
        }
        catch (Exception ex) { ctx.Log($"GetInventoryFiles exception: {ex.Message}"); }
        return new JArray();
    }

    public async Task<(bool ok, JObject? file, string error)> UploadInventoryImageAsync(byte[] bytes, string tag, string animationStyle = "", string maskTag = "")
    {
        if (!ctx.IsLoggedIn) return (false, null, "Not logged in");
        try
        {
            using var form = new MultipartFormDataContent();
            form.Add(new StringContent(tag), "tag");
            if (!string.IsNullOrEmpty(animationStyle))
                form.Add(new StringContent(animationStyle), "animationStyle");
            if (!string.IsNullOrEmpty(maskTag))
                form.Add(new StringContent(maskTag), "maskTag");
            var fileContent = new ByteArrayContent(bytes);
            fileContent.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse("image/png");
            form.Add(fileContent, "file", "upload.png");

            ctx.Log($"UploadInventoryImage tag={tag} size={bytes.Length}");
            var resp = await ctx._http.PostAsync($"{VRChatApiService.BASE}/file/image", form);
            var body = await resp.Content.ReadAsStringAsync();
            ctx.Log($"UploadInventoryImage response: {(int)resp.StatusCode} preview={body[..Math.Min(200, body.Length)]}");
            if (resp.IsSuccessStatusCode) return (true, JObject.Parse(body), "");
            var errMsg = VRChatApiService.TryGetApiError(body) ?? $"HTTP {(int)resp.StatusCode}";
            return (false, null, errMsg);
        }
        catch (Exception ex) { ctx.Log($"UploadInventoryImage exception: {ex.Message}"); return (false, null, ex.Message); }
    }

    public async Task<JObject?> GetFileAsync(string fileId)
    {
        if (!ctx.IsLoggedIn || string.IsNullOrEmpty(fileId)) return null;
        try
        {
            var resp = await ctx._http.GetAsync($"{VRChatApiService.BASE}/file/{fileId}");
            if (!resp.IsSuccessStatusCode) return null;
            return JObject.Parse(await resp.Content.ReadAsStringAsync());
        }
        catch { return null; }
    }

    public async Task<bool> DeleteInventoryFileAsync(string fileId)
    {
        if (!ctx.IsLoggedIn) return false;
        try
        {
            var resp = await ctx._http.DeleteAsync($"{VRChatApiService.BASE}/file/{fileId}");
            var body = await resp.Content.ReadAsStringAsync();
            ctx.Log($"DeleteInventoryFile {fileId}: {(int)resp.StatusCode} body={body[..Math.Min(300, body.Length)]}");
            return resp.IsSuccessStatusCode;
        }
        catch (Exception ex) { ctx.Log($"DeleteInventoryFile exception: {ex.Message}"); return false; }
    }
}
