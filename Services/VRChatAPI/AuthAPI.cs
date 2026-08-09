using System.Net;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace VRCNext.Services;

public class AuthAPI(VRChatApiService ctx)
{
    public async Task<VRChatApiService.LoginResult> TryResumeSessionAsync()
    {
        try
        {
            var resp = await ctx._http.GetAsync($"{VRChatApiService.BASE}/auth/user");
            var body = await resp.Content.ReadAsStringAsync();
            ctx.Log($"Resume session response: {(int)resp.StatusCode}");

            if (resp.StatusCode == HttpStatusCode.Unauthorized ||
                resp.StatusCode == HttpStatusCode.Forbidden)
                return new VRChatApiService.LoginResult { Error = "Session expired" };

            if (!resp.IsSuccessStatusCode)
                return new VRChatApiService.LoginResult { NetworkError = true, Error = $"HTTP {(int)resp.StatusCode}" };

            var json = JObject.Parse(body);

            if (json["requiresTwoFactorAuth"] != null)
                return new VRChatApiService.LoginResult { Error = "Session expired (2FA required)" };

            ctx.CurrentUserRaw = json;
            ctx.IsLoggedIn = true;
            ctx.Log($"Resumed session as: {json["displayName"]}");
            return new VRChatApiService.LoginResult { Success = true, User = json };
        }
        catch (HttpRequestException ex)
        {
            ctx.Log($"Resume session network error: {ex.Message}");
            return new VRChatApiService.LoginResult { NetworkError = true, Error = ex.Message };
        }
        catch (TaskCanceledException ex)
        {
            ctx.Log($"Resume session timeout: {ex.Message}");
            return new VRChatApiService.LoginResult { NetworkError = true, Error = "Request timed out" };
        }
        catch (Exception ex)
        {
            ctx.Log($"Resume session exception: {ex.Message}");
            return new VRChatApiService.LoginResult { NetworkError = true, Error = ex.Message };
        }
    }

    public async Task<VRChatApiService.LoginResult> LoginAsync(string username, string password)
    {
        try
        {
            var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(
                $"{Uri.EscapeDataString(username)}:{Uri.EscapeDataString(password)}"));

            var req = new HttpRequestMessage(HttpMethod.Get, $"{VRChatApiService.BASE}/auth/user");
            req.Headers.TryAddWithoutValidation("Authorization", $"Basic {encoded}");

            var resp = await ctx._http.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();

            ctx.Log($"Login response: {(int)resp.StatusCode}");
            ctx.Log($"Body preview: {(body.Length > 200 ? body[..200] : body)}");

            var cookies = ctx._cookies.GetCookies(new Uri("https://api.vrchat.cloud"));
            ctx.Log($"Cookies after login: {string.Join(", ", cookies.Cast<Cookie>().Select(c => $"{c.Name}={c.Value[..Math.Min(8, c.Value.Length)]}..."))}");

            JObject json;
            try { json = JObject.Parse(body); }
            catch { return new VRChatApiService.LoginResult { Error = $"Invalid response: {body[..Math.Min(100, body.Length)]}" }; }

            var require2fa = json["requiresTwoFactorAuth"];
            if (require2fa != null && require2fa.Type == JTokenType.Array)
            {
                var methods = require2fa.ToObject<List<string>>() ?? new();
                ctx.Log($"2FA required: {string.Join(", ", methods)}");
                var type = methods.Contains("totp") ? "totp" :
                           methods.Contains("emailOtp") ? "emailotp" :
                           methods.Contains("otp") ? "totp" :
                           methods.FirstOrDefault() ?? "totp";
                return new VRChatApiService.LoginResult { Requires2FA = true, TwoFactorType = type };
            }

            if (!resp.IsSuccessStatusCode)
            {
                var errMsg = json["error"]?["message"]?.ToString() ?? body[..Math.Min(100, body.Length)];
                return new VRChatApiService.LoginResult { Error = errMsg };
            }

            ctx.CurrentUserRaw = json;
            ctx.IsLoggedIn = true;
            ctx.Log($"Logged in as: {json["displayName"]}  status: {json["status"]}");
            return new VRChatApiService.LoginResult { Success = true, User = json };
        }
        catch (Exception ex)
        {
            ctx.Log($"Login exception: {ex.Message}");
            return new VRChatApiService.LoginResult { Error = ex.Message };
        }
    }

    public async Task<VRChatApiService.LoginResult> Verify2FAAsync(string code, string type)
    {
        try
        {
            string endpoint = type == "emailotp"
                ? $"{VRChatApiService.BASE}/auth/twofactorauth/emailotp/verify"
                : $"{VRChatApiService.BASE}/auth/twofactorauth/totp/verify";

            var json = JsonConvert.SerializeObject(new Dictionary<string, string> { { "code", code } });
            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var resp = await ctx._http.PostAsync(endpoint, content);
            var body = await resp.Content.ReadAsStringAsync();

            ctx.Log($"2FA verify response: {(int)resp.StatusCode} body: {body}");

            var cookies = ctx._cookies.GetCookies(new Uri("https://api.vrchat.cloud"));
            ctx.Log($"Cookies after 2FA: {string.Join(", ", cookies.Cast<Cookie>().Select(c => $"{c.Name}={c.Value[..Math.Min(8, c.Value.Length)]}..."))}");

            if (!resp.IsSuccessStatusCode)
                return new VRChatApiService.LoginResult { Error = $"2FA failed ({(int)resp.StatusCode}): {body}" };

            var result = JObject.Parse(body);
            if (result["verified"]?.Value<bool>() != true)
                return new VRChatApiService.LoginResult { Error = "2FA code invalid or expired" };

            await Task.Delay(300);
            var userResp = await ctx._http.GetAsync($"{VRChatApiService.BASE}/auth/user");
            var userBody = await userResp.Content.ReadAsStringAsync();

            ctx.Log($"Post-2FA user fetch: {(int)userResp.StatusCode}");

            if (!userResp.IsSuccessStatusCode)
                return new VRChatApiService.LoginResult { Error = $"Failed to get user after 2FA: {(int)userResp.StatusCode}" };

            var user = JObject.Parse(userBody);
            if (user["requiresTwoFactorAuth"] != null)
                return new VRChatApiService.LoginResult { Error = "Still requires 2FA after verification" };

            ctx.CurrentUserRaw = user;
            ctx.IsLoggedIn = true;
            ctx.Log($"Logged in after 2FA: {user["displayName"]}  status: {user["status"]}");
            return new VRChatApiService.LoginResult { Success = true, User = user };
        }
        catch (Exception ex)
        {
            ctx.Log($"2FA exception: {ex.Message}");
            return new VRChatApiService.LoginResult { Error = ex.Message };
        }
    }

    // Isolated login variant for the add-account flow that leaves ctx.IsLoggedIn and CurrentUserRaw untouched.
    public async Task<VRChatApiService.LoginResult> LoginIsolatedAsync(
        string username, string password, HttpClient http, CookieContainer cookies)
    {
        try
        {
            var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(
                $"{Uri.EscapeDataString(username)}:{Uri.EscapeDataString(password)}"));

            var req = new HttpRequestMessage(HttpMethod.Get, $"{VRChatApiService.BASE}/auth/user");
            req.Headers.TryAddWithoutValidation("Authorization", $"Basic {encoded}");

            var resp = await http.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();

            ctx.Log($"[isolated] Login response: {(int)resp.StatusCode}");

            JObject json;
            try { json = JObject.Parse(body); }
            catch { return new VRChatApiService.LoginResult { Error = $"Invalid response: {body[..Math.Min(100, body.Length)]}" }; }

            var require2fa = json["requiresTwoFactorAuth"];
            if (require2fa != null && require2fa.Type == JTokenType.Array)
            {
                var methods = require2fa.ToObject<List<string>>() ?? new();
                var type = methods.Contains("totp") ? "totp" :
                           methods.Contains("emailOtp") ? "emailotp" :
                           methods.Contains("otp") ? "totp" :
                           methods.FirstOrDefault() ?? "totp";
                return new VRChatApiService.LoginResult { Requires2FA = true, TwoFactorType = type };
            }

            if (!resp.IsSuccessStatusCode)
            {
                var errMsg = json["error"]?["message"]?.ToString() ?? body[..Math.Min(100, body.Length)];
                return new VRChatApiService.LoginResult { Error = errMsg };
            }

            return new VRChatApiService.LoginResult { Success = true, User = json };
        }
        catch (Exception ex)
        {
            ctx.Log($"[isolated] Login exception: {ex.Message}");
            return new VRChatApiService.LoginResult { Error = ex.Message };
        }
    }

    public async Task<VRChatApiService.LoginResult> Verify2FAIsolatedAsync(
        string code, string type, HttpClient http, CookieContainer cookies)
    {
        try
        {
            string endpoint = type == "emailotp"
                ? $"{VRChatApiService.BASE}/auth/twofactorauth/emailotp/verify"
                : $"{VRChatApiService.BASE}/auth/twofactorauth/totp/verify";

            var json = JsonConvert.SerializeObject(new Dictionary<string, string> { { "code", code } });
            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var resp = await http.PostAsync(endpoint, content);
            var body = await resp.Content.ReadAsStringAsync();

            ctx.Log($"[isolated] 2FA verify response: {(int)resp.StatusCode}");

            if (!resp.IsSuccessStatusCode)
                return new VRChatApiService.LoginResult { Error = $"2FA failed ({(int)resp.StatusCode}): {body}" };

            var result = JObject.Parse(body);
            if (result["verified"]?.Value<bool>() != true)
                return new VRChatApiService.LoginResult { Error = "2FA code invalid or expired" };

            await Task.Delay(300);
            var userResp = await http.GetAsync($"{VRChatApiService.BASE}/auth/user");
            var userBody = await userResp.Content.ReadAsStringAsync();

            if (!userResp.IsSuccessStatusCode)
                return new VRChatApiService.LoginResult { Error = $"Failed to get user after 2FA: {(int)userResp.StatusCode}" };

            var user = JObject.Parse(userBody);
            if (user["requiresTwoFactorAuth"] != null)
                return new VRChatApiService.LoginResult { Error = "Still requires 2FA after verification" };

            return new VRChatApiService.LoginResult { Success = true, User = user };
        }
        catch (Exception ex)
        {
            ctx.Log($"[isolated] 2FA exception: {ex.Message}");
            return new VRChatApiService.LoginResult { Error = ex.Message };
        }
    }

    public async Task LogoutAsync()
    {
        try { await ctx._http.PutAsync($"{VRChatApiService.BASE}/logout", null); } catch { }
        ctx.IsLoggedIn = false;
        ctx.CurrentUserRaw = null;
    }

    public async Task<JObject?> RefreshCurrentUserAsync()
    {
        if (!ctx.IsLoggedIn) return null;
        try
        {
            var resp = await ctx._http.GetAsync($"{VRChatApiService.BASE}/auth/user");
            if (resp.IsSuccessStatusCode)
            {
                var json = JObject.Parse(await resp.Content.ReadAsStringAsync());
                if (json["requiresTwoFactorAuth"] == null)
                {
                    ctx.CurrentUserRaw = json;
                    return json;
                }
            }
        }
        catch (Exception ex) { ctx.Log($"RefreshCurrentUser exception: {ex.Message}"); }
        return ctx.CurrentUserRaw;
    }

    public async Task<string?> GetCurrentUserLocationAsync()
    {
        if (!ctx.IsLoggedIn) return null;
        try
        {
            var resp = await ctx._http.GetAsync($"{VRChatApiService.BASE}/auth/user");
            if (!resp.IsSuccessStatusCode) return null;
            var obj = JObject.Parse(await resp.Content.ReadAsStringAsync());
            ctx.CurrentUserRaw = obj;
            return obj["currentLocation"]?.ToString();
        }
        catch { return null; }
    }
}
