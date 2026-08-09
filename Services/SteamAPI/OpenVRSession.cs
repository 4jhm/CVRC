using System.Threading;
using Valve.VR;

namespace VRCNext.Services;

internal static class OpenVRSession
{
    private static int _refCount;

    public static void Acquire() => Interlocked.Increment(ref _refCount);

    public static bool Release()
    {
        var n = Interlocked.Decrement(ref _refCount);
        if (n <= 0)
        {
            try { OpenVR.Shutdown(); } catch { }
            Interlocked.Exchange(ref _refCount, 0);
            return true;
        }
        return false;
    }
}
