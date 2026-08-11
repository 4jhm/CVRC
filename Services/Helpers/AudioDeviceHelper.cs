namespace VRCNext.Services.Helpers;

// Central audio device handling for every tool. tries to fix stored NAudio devives.
public static class AudioDeviceHelper
{
    public const int SystemDefault = -1;

    public static Action<string>? Log;

    public static string[] GetOutputNames()
    {
#if WINDOWS
        try
        {
            var count = NAudio.Wave.WaveOut.DeviceCount;
            var names = new string[count];
            for (int i = 0; i < count; i++)
                names[i] = NAudio.Wave.WaveOut.GetCapabilities(i).ProductName ?? "";
            return names;
        }
        catch (Exception ex) { Log?.Invoke($"[Audio] Output device list failed: {ex.Message}"); }
#endif
        return Array.Empty<string>();
    }

    public static string[] GetInputNames()
    {
#if WINDOWS
        try
        {
            var count = NAudio.Wave.WaveInEvent.DeviceCount;
            var names = new string[count];
            for (int i = 0; i < count; i++)
                names[i] = NAudio.Wave.WaveInEvent.GetCapabilities(i).ProductName ?? "";
            return names;
        }
        catch (Exception ex) { Log?.Invoke($"[Audio] Input device list failed: {ex.Message}"); }
#endif
        return Array.Empty<string>();
    }

    // WASAPI endpoints, used where a stable device id is needed.
    public static (string Id, string Label)[] GetWasapiEndpoints()
    {
#if WINDOWS
        try
        {
            var list = new List<(string, string)>();
            var en = new NAudio.CoreAudioApi.MMDeviceEnumerator();
            foreach (var d in en.EnumerateAudioEndPoints(
                         NAudio.CoreAudioApi.DataFlow.Capture, NAudio.CoreAudioApi.DeviceState.Active))
                list.Add((d.ID, d.FriendlyName));
            foreach (var d in en.EnumerateAudioEndPoints(
                         NAudio.CoreAudioApi.DataFlow.Render, NAudio.CoreAudioApi.DeviceState.Active))
                list.Add(($"loopback:{d.ID}", $"{d.FriendlyName} (System Audio)"));
            return list.ToArray();
        }
        catch (Exception ex) { Log?.Invoke($"[Audio] WASAPI endpoint list failed: {ex.Message}"); }
#endif
        return Array.Empty<(string, string)>();
    }

#if WINDOWS
    // Resolves a stored WASAPI id (optionally "loopback:"-prefixed) to its endpoint.
    public static NAudio.CoreAudioApi.MMDevice? GetWasapiDevice(string deviceId, out bool isLoopback)
    {
        isLoopback = deviceId.StartsWith("loopback:", StringComparison.Ordinal);
        var id = isLoopback ? deviceId["loopback:".Length..] : deviceId;
        if (string.IsNullOrEmpty(id)) return null;
        try { return new NAudio.CoreAudioApi.MMDeviceEnumerator().GetDevice(id); }
        catch (Exception ex)
        {
            Log?.Invoke($"[Audio] WASAPI device '{id}' unavailable: {ex.Message}");
            return null;
        }
    }
#endif

    public static string OutputNameAt(int index) => NameAt(GetOutputNames(), index);
    public static string InputNameAt(int index)  => NameAt(GetInputNames(), index);

    private static string NameAt(string[] names, int index)
        => index >= 0 && index < names.Length ? names[index] : "";

    public static int ResolveOutput(int savedIndex, string? savedName)
        => Resolve(GetOutputNames(), savedIndex, savedName, "output");

    public static int ResolveInput(int savedIndex, string? savedName)
        => Resolve(GetInputNames(), savedIndex, savedName, "input");

    // WinMM truncates device names to 31 characters.. matched by prefix as well before giving up on it.
    // need to improve this later.
    private static int IndexOfName(string[] names, string name)
    {
        for (int i = 0; i < names.Length; i++)
            if (string.Equals(names[i], name, StringComparison.Ordinal)) return i;

        for (int i = 0; i < names.Length; i++)
            if (names[i].Length > 0 && name.StartsWith(names[i], StringComparison.Ordinal)) return i;

        return -1;
    }

    private static int Resolve(string[] names, int savedIndex, string? savedName, string kind)
    {
        if (names.Length == 0) return SystemDefault;

        if (!string.IsNullOrEmpty(savedName))
        {
            var byName = IndexOfName(names, savedName!);
            if (byName >= 0) return byName;
            Log?.Invoke($"[Audio] {kind} device '{savedName}' not found, using system default.");
            return SystemDefault;
        }

        if (savedIndex >= 0 && savedIndex < names.Length) return savedIndex;
        if (savedIndex >= names.Length)
            Log?.Invoke($"[Audio] {kind} device {savedIndex} is gone, using system default.");

        return SystemDefault;
    }
}
