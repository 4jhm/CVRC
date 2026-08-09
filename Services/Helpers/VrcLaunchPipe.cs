using System.IO.Pipes;
using System.Text;

namespace VRCNext.Services.Helpers;

public static class VrcLaunchPipe
{
    private const string PipeName = "VRChatURLLaunchPipe";

    public static async Task<bool> SendAsync(string launchUrl)
    {
        if (string.IsNullOrEmpty(launchUrl)) return false;
        NamedPipeClientStream? pipe = null;
        try
        {
            pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut);
            await pipe.ConnectAsync(1000);
            if (!pipe.IsConnected) return false;

            var bytes = Encoding.UTF8.GetBytes(launchUrl);
            await pipe.WriteAsync(bytes);
            await pipe.FlushAsync();

            var result = new byte[1];
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            await pipe.ReadExactlyAsync(result, 0, 1, cts.Token);
            return result[0] == 1;
        }
        catch
        {
            return false;
        }
        finally
        {
            try { pipe?.Dispose(); } catch { }
        }
    }
}
