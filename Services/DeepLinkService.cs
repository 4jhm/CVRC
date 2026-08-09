using System.IO.Pipes;
#if WINDOWS
using Microsoft.Win32;
#endif

namespace VRCNext.Services;

public static class DeepLinkService
{
    public const string Scheme = "vrcn";
    private const string PipeName = "VRCNext_DeepLink";

    private static bool IsUuid(string s) => Guid.TryParseExact(s, "D", out _);

    public static bool IsValidUserId(string id)
    {
        if (string.IsNullOrEmpty(id) || id.Length < 10) return false;
        if (id.StartsWith("usr_", StringComparison.Ordinal)) return IsUuid(id.Substring(4));
        return id.Length == 10 && id.All(char.IsAsciiLetterOrDigit);
    }

    public static bool IsValidAvatarId(string id)
    {
        if (string.IsNullOrEmpty(id) || id.Length < 12) return false;
        if (id.StartsWith("avtr_", StringComparison.Ordinal)) return IsUuid(id.Substring(5));
        if (id.StartsWith("b_", StringComparison.Ordinal))
        {
            var rest = id.Substring(2);
            if (rest.StartsWith("blp_", StringComparison.Ordinal)) return IsUuid(rest.Substring(4));
            if (rest.Length == 10) return rest.All(char.IsAsciiLetterOrDigit);
            return IsUuid(rest);
        }
        return false;
    }

    public static bool IsValidWorldId(string id) =>
        !string.IsNullOrEmpty(id) && id.StartsWith("wrld_", StringComparison.Ordinal) && IsUuid(id.Substring(5));

    public static bool IsValidGroupId(string id) =>
        !string.IsNullOrEmpty(id) && id.StartsWith("grp_", StringComparison.Ordinal) && IsUuid(id.Substring(4));

    public static (string prefix, string id)? Parse(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;
        var s = url.Trim();
        if (!s.StartsWith(Scheme + "://", StringComparison.OrdinalIgnoreCase)) return null;
        s = s.Substring((Scheme + "://").Length).Trim().TrimEnd('/');

        var slash = s.IndexOf('/');
        if (slash <= 0 || slash >= s.Length - 1) return null;

        var type = s.Substring(0, slash).ToLowerInvariant();
        var id   = s.Substring(slash + 1);

        var cut = id.IndexOfAny(new[] { '/', '?', '#' });
        if (cut >= 0) id = id.Substring(0, cut);
        try { id = Uri.UnescapeDataString(id); } catch { }
        id = id.Trim();

        return type switch
        {
            "user"    or "users"   => IsValidUserId(id)   ? ("usr",  id) : null,
            "avatar"  or "avatars" => IsValidAvatarId(id) ? ("avtr", id) : null,
            "world"   or "worlds"  => IsValidWorldId(id)  ? ("wrld", id) : null,
            "group"   or "groups"  => IsValidGroupId(id)  ? ("grp",  id) : null,
            _ => ((string, string)?)null,
        };
    }

    public static void RegisterProtocol()
    {
#if WINDOWS
        try
        {
            var exe = Environment.ProcessPath;
            if (string.IsNullOrEmpty(exe)) return;

            using var root = Registry.CurrentUser.CreateSubKey($@"Software\Classes\{Scheme}");
            root.SetValue("", "URL:VRCNext Protocol");
            root.SetValue("URL Protocol", "");
            using (var icon = root.CreateSubKey("DefaultIcon"))
                icon.SetValue("", $"\"{exe}\",0");
            using var cmd = root.CreateSubKey(@"shell\open\command");
            cmd.SetValue("", $"\"{exe}\" \"%1\"");
        }
        catch { }
#endif
    }

    public static void Forward(string url)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            client.Connect(3000);
            using var w = new StreamWriter(client) { AutoFlush = true };
            w.WriteLine(url);
        }
        catch { }
    }

    public static void StartServer(Action<string> onLink, CancellationToken ct)
    {
        _ = Task.Run(async () =>
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    using var server = new NamedPipeServerStream(
                        PipeName, PipeDirection.In, 1,
                        PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
                    await server.WaitForConnectionAsync(ct);
                    using var r = new StreamReader(server);
                    var line = await r.ReadLineAsync(ct);
                    if (!string.IsNullOrWhiteSpace(line)) onLink(line);
                }
                catch (OperationCanceledException) { break; }
                catch { try { await Task.Delay(500, ct); } catch { break; } }
            }
        }, ct);
    }
}
