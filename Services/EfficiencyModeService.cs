using System.Diagnostics;
using System.Runtime.InteropServices;

namespace VRCNext.Services;

// Windows Efficiency Mode (EcoQoS)
public static class EfficiencyModeService
{
    private const int ProcessPowerThrottlingInfo = 4;
    private const uint PROCESS_POWER_THROTTLING_CURRENT_VERSION = 1;
    private const uint PROCESS_POWER_THROTTLING_EXECUTION_SPEED = 0x1;
    private const uint PROCESS_SET_INFORMATION = 0x0200;
    private const uint TH32CS_SNAPPROCESS = 0x2;

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_POWER_THROTTLING_STATE
    {
        public uint Version;
        public uint ControlMask;
        public uint StateMask;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PROCESSENTRY32W
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetProcessInformation(IntPtr hProcess, int ProcessInformationClass, ref PROCESS_POWER_THROTTLING_STATE ProcessInformation, int ProcessInformationSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool Process32FirstW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool Process32NextW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

    private static System.Timers.Timer? _timer;
    private static bool _enabled;

    public static void Apply(bool enabled)
    {
        if (!OperatingSystem.IsWindows()) return;
        _enabled = enabled;
        ApplyNow();
        if (enabled)
        {
            if (_timer == null)
            {
                _timer = new System.Timers.Timer(60000) { AutoReset = true };
                _timer.Elapsed += (_, _) => { if (_enabled) ApplyNow(); };
            }
            _timer.Start();
        }
        else
        {
            _timer?.Stop();
        }
    }

    private static void ApplyNow()
    {
        try
        {
            var self = Process.GetCurrentProcess();
            SetThrottle(self.Handle, _enabled);
            TrySetPriority(self, _enabled);
            foreach (var (pid, isWebView) in GetDescendants(Environment.ProcessId))
            {
                if (isWebView)
                {
                    IntPtr h = OpenProcess(PROCESS_SET_INFORMATION, false, pid);
                    if (h != IntPtr.Zero)
                    {
                        try { SetThrottle(h, _enabled); }
                        finally { CloseHandle(h); }
                    }
                    try { TrySetPriority(Process.GetProcessById(pid), _enabled); } catch { }
                }
                else if (_enabled)
                {
                    try { TrySetPriority(Process.GetProcessById(pid), false); } catch { }
                }
            }
        }
        catch { }
    }

    private static void TrySetPriority(Process p, bool on)
    {
        try
        {
            if (on)
            {
                if (p.PriorityClass != ProcessPriorityClass.Idle) p.PriorityClass = ProcessPriorityClass.Idle;
            }
            else if (p.PriorityClass == ProcessPriorityClass.Idle)
            {
                p.PriorityClass = ProcessPriorityClass.Normal;
            }
        }
        catch { }
    }

    private static void SetThrottle(IntPtr hProcess, bool on)
    {
        var state = new PROCESS_POWER_THROTTLING_STATE
        {
            Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION,
            ControlMask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
            StateMask = on ? PROCESS_POWER_THROTTLING_EXECUTION_SPEED : 0,
        };
        SetProcessInformation(hProcess, ProcessPowerThrottlingInfo, ref state, Marshal.SizeOf<PROCESS_POWER_THROTTLING_STATE>());
    }

    private static List<(int Pid, bool IsWebView)> GetDescendants(int rootPid)
    {
        var result = new List<(int Pid, bool IsWebView)>();
        var byParent = new Dictionary<int, List<(int Pid, string Exe)>>();
        IntPtr snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snap == IntPtr.Zero || snap == new IntPtr(-1)) return result;
        try
        {
            var entry = new PROCESSENTRY32W { dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32W>() };
            if (Process32FirstW(snap, ref entry))
            {
                do
                {
                    int ppid = (int)entry.th32ParentProcessID;
                    if (!byParent.TryGetValue(ppid, out var list)) byParent[ppid] = list = new();
                    list.Add(((int)entry.th32ProcessID, entry.szExeFile ?? ""));
                } while (Process32NextW(snap, ref entry));
            }
        }
        finally { CloseHandle(snap); }

        var visited = new HashSet<int> { rootPid };
        var queue = new Queue<int>();
        queue.Enqueue(rootPid);
        while (queue.Count > 0)
        {
            int pid = queue.Dequeue();
            if (!byParent.TryGetValue(pid, out var kids)) continue;
            foreach (var (kidPid, exe) in kids)
            {
                if (!visited.Add(kidPid)) continue;
                queue.Enqueue(kidPid);
                result.Add((kidPid, exe.Equals("msedgewebview2.exe", StringComparison.OrdinalIgnoreCase)));
            }
        }
        return result;
    }
}
