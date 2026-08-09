#if WINDOWS
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Numerics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.CompilerServices;
using NAudio.Wave;
using Valve.VR;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace VRCNext.Services
{
    public class FrameShotService : IDisposable
    {
        // Config
        public uint LeftButtonId  { get; private set; } = (uint)EVRButtonId.k_EButton_Grip;
        public uint RightButtonId { get; private set; } = (uint)EVRButtonId.k_EButton_Grip;
        public uint LeftRecordButton  { get; private set; } = 0;
        public uint RightRecordButton { get; private set; } = 0;
        public uint LeftVideoButton   { get; private set; } = 0;
        public uint RightVideoButton  { get; private set; } = 0;
        public float ActivationRadius { get; private set; } = 0.15f;
        public bool  UseHmdRotations  { get; private set; } = false;

        // State
        public bool IsConnected { get; private set; }
        public bool IsFraming   { get; private set; }
        public bool IsRecording      { get; private set; }
        public bool IsVideoRecording { get; private set; }
        public string? LastError { get; private set; }

        // Events
        public event Action<object>? OnStateUpdate;
        public event Action? OnVRQuit;
        public event Action<string>? OnPhotoSaved;

        // OpenVR
        private CVRSystem? _vrSystem;
        private bool _ownedInit;
        private ulong _overlayHandle;
        private CancellationTokenSource? _cts;
        private Task? _pollTask;
        private bool _running;
        private bool _disposed;
        private readonly Action<string> _log;

        // Controller tracking
        private uint _leftIdx  = OpenVR.k_unTrackedDeviceIndexInvalid;
        private uint _rightIdx = OpenVR.k_unTrackedDeviceIndexInvalid;
        private readonly TrackedDevicePose_t[] _poses = new TrackedDevicePose_t[OpenVR.k_unMaxTrackedDeviceCount];

        // Button state
        private bool _leftHeld;
        private bool _rightHeld;
        private bool _leftHeldPrev;
        private bool _rightHeldPrev;
        private bool _leftRecHeld;
        private bool _rightRecHeld;
        private bool _leftVidHeld;
        private bool _rightVidHeld;

        private string _videoDeviceA = "";
        private string _videoDeviceB = "";
        private int    _videoTargetW = 1920;
        private int    _videoTargetH = 1080;
        private string _videoBitrateQuality = "medium";
        private int    _videoAudioKbps = 256;
        private const int VIDEO_MAX_MS  = 30_000;
        private int _videoFps      = 30;
        private int _videoFrameMs  = 1000 / 30;
        private CancellationTokenSource? _videoCts;
        private DateTime _videoStartUtc;
        private System.Diagnostics.Process? _videoFfmpegProc;
        private Stream? _videoFfmpegStdin;
        private string? _videoEncodedPath;
        private int _videoFrameCount;
        private readonly object _videoRawLock = new();
        private volatile bool _videoAutoStop;
        private string?  _videoSessionDir;
        private NAudio.Wave.IWaveIn? _audioCapA;
        private NAudio.Wave.IWaveIn? _audioCapB;
        private NAudio.Wave.WaveFileWriter? _audioWriterA;
        private NAudio.Wave.WaveFileWriter? _audioWriterB;
        private int _videoFrameWBytes;
        private int _videoFrameHBytes;

        // Recording state — captured frames + locked geometry at record-start
        private const int   GIF_MAX_MS           = 8_000;
        private const float RECORD_VISUAL_SCALE  = 1.15f;
        private int _gifFps     = 10;
        private int _gifMaxDim  = 512;
        private int GifFrameMs  => 1000 / Math.Max(1, _gifFps);
        private int GifMaxFrames => _gifFps * GIF_MAX_MS / 1000;
        private readonly List<Bitmap> _recordFrames = new();
        private CancellationTokenSource? _recordCts;
        private Vector3 _recordHeadLocalOffset;
        private float   _recordLockedWidth;
        private float   _recordLockedHeight;
        private System.Drawing.Rectangle _recordCrop;
        private volatile bool _gifAutoStop;

        // Frame geometry (cached for capture after release)
        private Vector3 _lastLeftPos;
        private Vector3 _lastRightPos;
        private float _lastFrameWidth;
        private float _lastFrameHeight;

        // Latched flag: framing started with a valid HMD pose. Used as a guard
        // in UpdateFrameAndRender so we don't render before the HMD pose was
        // ever valid (transient init period).
        private bool _framingBasisLocked;

        // D3D11 — overlay frame texture (light blue border)
        private ID3D11Device?        _d3dDevice;
        private ID3D11DeviceContext? _d3dContext;
        private readonly object _d3dLock = new();
        private ID3D11Texture2D?     _overlayTex;
        private ID3D11Texture2D?     _stagingTex;
        private const int FRAME_TEX_W = 1024;
        private const int FRAME_TEX_H = 1024;
        private readonly byte[] _frameUploadBuf = new byte[FRAME_TEX_W * FRAME_TEX_H * 4];
        private Bitmap? _frameBitmap;
        private int _lastDrawnW   = -1;
        private int _lastDrawnH   = -1;

        // Mirror texture for capture — acquired ONCE per session and reused across captures.
        // Per OpenVR docs the compositor continuously updates the texture content, so the
        // same SRV reflects the current frame on every CopyResource.
        private IntPtr                   _mirrorSrv     = IntPtr.Zero;
        private ID3D11ShaderResourceView? _mirrorSrvObj;
        private ID3D11Texture2D?         _mirrorTexCached;
        private ID3D11Texture2D?         _mirrorStaging;
        private int     _mirrorW;
        private int     _mirrorH;
        private Format  _mirrorTexFormat;
        private Format  _mirrorSrvFormat;

        // Output directory
        private static readonly string OutputDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),
            "VRCN", "FrameShots");

        // Sound assets — copied to <out>/frameshot/*.wav by VRCNext.csproj
        private static readonly string SoundDir = Path.Combine(
            AppDomain.CurrentDomain.BaseDirectory, "frameshot");

        // Output device — -1 means "system default". Each Play() creates a NEW
        // WaveOutEvent so a device change applies immediately without restart.
        private int _outputDeviceIndex = -1;

        public void SetOutputDevice(int idx) => _outputDeviceIndex = idx;

        [DllImport("winmm.dll")] private static extern int waveOutGetNumDevs();
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
        private struct WAVEOUTCAPS
        {
            public ushort wMid, wPid;
            public uint vDriverVersion;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname;
            public uint dwFormats;
            public ushort wChannels, wReserved1;
            public uint dwSupport;
        }
        [DllImport("winmm.dll", CharSet = CharSet.Ansi)]
        private static extern int waveOutGetDevCaps(IntPtr deviceID, out WAVEOUTCAPS caps, int size);

        public static string[] GetOutputDevices()
        {
            int count = waveOutGetNumDevs();
            var names = new string[count];
            for (int i = 0; i < count; i++)
            {
                waveOutGetDevCaps(new IntPtr(i), out var caps, Marshal.SizeOf<WAVEOUTCAPS>());
                names[i] = caps.szPname ?? "";
            }
            return names;
        }

        private void PlaySoundAsync(string fileName)
        {
            var path = Path.Combine(SoundDir, fileName);
            if (!File.Exists(path)) return;
            int devIdx = _outputDeviceIndex; // snapshot at trigger time
            _ = Task.Run(() =>
            {
                try
                {
                    var reader  = new WaveFileReader(path);
                    // Fresh WaveOutEvent per play, so the device chosen NOW takes effect
                    // immediately — no app restart needed when the user switches output.
                    var waveOut = new WaveOutEvent { DeviceNumber = devIdx };
                    waveOut.PlaybackStopped += (_, __) =>
                    {
                        try { waveOut.Dispose(); } catch { }
                        try { reader.Dispose();  } catch { }
                    };
                    waveOut.Init(reader);
                    waveOut.Play();
                }
                catch (Exception ex) { _log($"[FrameShot] Sound '{fileName}': {ex.Message}"); }
            });
        }

        // Looping playback used for the recording sound — runs from record start
        // until StopRecordSoundLoop() is called.
        private WaveOutEvent? _recordWaveOut;
        private WaveStream?   _recordWaveReader;

        private sealed class LoopWaveStream : WaveStream
        {
            private readonly WaveStream _src;
            public LoopWaveStream(WaveStream src) { _src = src; }
            public override WaveFormat WaveFormat => _src.WaveFormat;
            public override long Length => long.MaxValue;
            public override long Position { get => _src.Position; set => _src.Position = value; }
            public override int Read(byte[] buf, int offset, int count)
            {
                int total = 0;
                while (total < count)
                {
                    int read = _src.Read(buf, offset + total, count - total);
                    if (read == 0)
                    {
                        if (_src.Position == 0) break; // empty source
                        _src.Position = 0;
                        continue;
                    }
                    total += read;
                }
                return total;
            }
            protected override void Dispose(bool disposing)
            {
                if (disposing) _src?.Dispose();
                base.Dispose(disposing);
            }
        }

        private void StartRecordSoundLoop(string fileName)
        {
            var path = Path.Combine(SoundDir, fileName);
            if (!File.Exists(path)) return;
            int devIdx = _outputDeviceIndex;
            // Run on thread pool so file IO + device init doesn't stall the poll loop.
            _ = Task.Run(() =>
            {
                try
                {
                    StopRecordSoundLoop(); // safety: kill any previous loop
                    _recordWaveReader = new LoopWaveStream(new WaveFileReader(path));
                    _recordWaveOut    = new WaveOutEvent { DeviceNumber = devIdx };
                    _recordWaveOut.Init(_recordWaveReader);
                    _recordWaveOut.Play();
                }
                catch (Exception ex) { _log($"[FrameShot] Record loop sound: {ex.Message}"); }
            });
        }

        private void StopRecordSoundLoop()
        {
            try { _recordWaveOut?.Stop();    } catch { }
            try { _recordWaveOut?.Dispose(); } catch { }
            try { _recordWaveReader?.Dispose(); } catch { }
            _recordWaveOut    = null;
            _recordWaveReader = null;
        }

        public FrameShotService(Action<string> log) => _log = log;

        public bool Connect()
        {
            if (IsConnected) return true;
            LastError = null;

            try
            {
                if (OpenVR.System != null)
                {
                    _vrSystem  = OpenVR.System;
                    _log("[FrameShot] Reusing existing OpenVR session");
                }
                else
                {
                    var err = EVRInitError.None;
                    _vrSystem = OpenVR.Init(ref err, EVRApplicationType.VRApplication_Overlay);
                    if (err != EVRInitError.None)
                    {
                        try { OpenVR.Shutdown(); } catch { }
                        err = EVRInitError.None;
                        _vrSystem = OpenVR.Init(ref err, EVRApplicationType.VRApplication_Background);
                        if (err != EVRInitError.None)
                        {
                            LastError = $"OpenVR init failed: {err}";
                            _log($"[FrameShot] {LastError}");
                            return false;
                        }
                    }
                    _log("[FrameShot] OpenVR initialized");
                }
                OpenVRSession.Acquire();
                _ownedInit = true;

                if (OpenVR.Overlay == null)
                {
                    LastError = "IVROverlay not available";
                    return false;
                }

                var oErr = OpenVR.Overlay.CreateOverlay("vrcnext.frameshot", "VRCNext FrameShot", ref _overlayHandle);
                if (oErr == EVROverlayError.KeyInUse)
                    OpenVR.Overlay.FindOverlay("vrcnext.frameshot", ref _overlayHandle);
                else if (oErr != EVROverlayError.None)
                {
                    LastError = $"CreateOverlay: {oErr}";
                    return false;
                }

                OpenVR.Overlay.SetOverlayAlpha(_overlayHandle, 1.0f);
                OpenVR.Overlay.SetOverlayInputMethod(_overlayHandle, VROverlayInputMethod.None);
                OpenVR.Overlay.SetOverlayFlag(_overlayHandle, VROverlayFlags.SortWithNonSceneOverlays, true);

                try
                {
                    D3D11.D3D11CreateDevice(null, DriverType.Hardware, DeviceCreationFlags.None,
                        [FeatureLevel.Level_11_0, FeatureLevel.Level_10_1],
                        out _d3dDevice, out _d3dContext);

                    _overlayTex = _d3dDevice!.CreateTexture2D(new Texture2DDescription
                    {
                        Width = FRAME_TEX_W, Height = FRAME_TEX_H, MipLevels = 1, ArraySize = 1,
                        Format = Format.B8G8R8A8_UNorm,
                        SampleDescription = new SampleDescription(1, 0),
                        Usage = ResourceUsage.Default,
                        BindFlags = BindFlags.ShaderResource,
                    });
                    _stagingTex = _d3dDevice.CreateTexture2D(new Texture2DDescription
                    {
                        Width = FRAME_TEX_W, Height = FRAME_TEX_H, MipLevels = 1, ArraySize = 1,
                        Format = Format.B8G8R8A8_UNorm,
                        SampleDescription = new SampleDescription(1, 0),
                        Usage = ResourceUsage.Staging,
                        CPUAccessFlags = CpuAccessFlags.Write,
                    });
                    _frameBitmap = new Bitmap(FRAME_TEX_W, FRAME_TEX_H, PixelFormat.Format32bppArgb);
                    _log("[FrameShot] D3D11 device + textures ready");
                }
                catch (Exception ex)
                {
                    LastError = $"D3D11 init failed: {ex.Message}";
                    _log($"[FrameShot] {LastError}");
                    return false;
                }

                UpdateControllerIndices();

                try { Directory.CreateDirectory(OutputDir); } catch { }

                IsConnected = true;
                _log("[FrameShot] Connected");
                EmitState();
                return true;
            }
            catch (Exception ex)
            {
                LastError = ex.Message;
                _log($"[FrameShot] Connect error: {ex.Message}");
                return false;
            }
        }

        public void Disconnect()
        {
            StopPolling();
            try { _recordCts?.Cancel(); } catch { }
            _recordCts = null;
            StopRecordSoundLoop();
            if (!IsConnected) return;

            if (_overlayHandle != 0 && OpenVR.Overlay != null)
            {
                try { OpenVR.Overlay.HideOverlay(_overlayHandle); } catch { }
                try { OpenVR.Overlay.DestroyOverlay(_overlayHandle); } catch { }
                _overlayHandle = 0;
            }

            lock (_d3dLock)
            {
                try { _mirrorStaging?.Dispose();   } catch { } _mirrorStaging   = null;
                try { _mirrorTexCached?.Dispose(); } catch { } _mirrorTexCached = null;
                try { _mirrorSrvObj?.Dispose();    } catch { } _mirrorSrvObj    = null;
                if (_mirrorSrv != IntPtr.Zero && OpenVR.Compositor != null)
                {
                    try { OpenVR.Compositor.ReleaseMirrorTextureD3D11(_mirrorSrv); } catch { }
                }
                _mirrorSrv = IntPtr.Zero;

                _stagingTex?.Dispose(); _stagingTex = null;
                _overlayTex?.Dispose(); _overlayTex = null;
                _d3dContext?.Dispose(); _d3dContext = null;
                _d3dDevice?.Dispose();  _d3dDevice  = null;
                _frameBitmap?.Dispose(); _frameBitmap = null;
            }

            if (_ownedInit)
            {
                OpenVRSession.Release();
                _ownedInit = false;
            }

            IsConnected = false;
            IsFraming   = false;
            _vrSystem   = null;
            _log("[FrameShot] Disconnected");
            EmitState();
        }

        public void StartPolling()
        {
            if (_running) return;
            _cts     = new CancellationTokenSource();
            _running = true;
            _pollTask = PollLoopAsync(_cts.Token);
            StartVrserverMonitor(_cts.Token);
        }

        public void StopPolling()
        {
            _running = false;
            _cts?.Cancel();
            try { _pollTask?.Wait(2000); } catch { }
            _pollTask = null;
        }

        public void ApplyConfig(uint leftButton, uint rightButton, float activationRadius,
                                uint leftRecordButton, uint rightRecordButton,
                                int gifMaxDim, int gifFps, bool useHmdRotations,
                                uint leftVideoButton, uint rightVideoButton,
                                string videoDeviceA, string videoDeviceB,
                                int videoFps, string videoQuality, string videoBitrateQuality, int audioKbps)
        {
            LeftButtonId       = leftButton;
            RightButtonId      = rightButton;
            LeftRecordButton   = leftRecordButton;
            RightRecordButton  = rightRecordButton;
            ActivationRadius   = Math.Clamp(activationRadius, 0.05f, 0.30f);
            _gifMaxDim         = gifMaxDim > 0 ? gifMaxDim : 512;
            _gifFps            = gifFps    > 0 ? gifFps    : 10;
            UseHmdRotations    = useHmdRotations;
            LeftVideoButton    = leftVideoButton;
            RightVideoButton   = rightVideoButton;
            _videoDeviceA      = videoDeviceA ?? "";
            _videoDeviceB      = videoDeviceB ?? "";
            _videoFps          = videoFps is 25 or 30 or 60 ? videoFps : 30;
            _videoFrameMs      = 1000 / _videoFps;
            switch (videoQuality)
            {
                case "720p":  _videoTargetW = 1280; _videoTargetH = 720;  break;
                case "1440p": _videoTargetW = 2560; _videoTargetH = 1440; break;
                default:      _videoTargetW = 1920; _videoTargetH = 1080; break;
            }
            _videoBitrateQuality = string.IsNullOrEmpty(videoBitrateQuality) ? "medium" : videoBitrateQuality;
            _videoAudioKbps      = audioKbps > 0 ? audioKbps : 256;
        }

        private async Task PollLoopAsync(CancellationToken ct)
        {
            try
            {
                while (!ct.IsCancellationRequested)
                {
                    try
                    {
                        ProcessFrame();
                        EmitState();
                        await Task.Delay(11, ct);
                    }
                    catch (OperationCanceledException) { break; }
                    catch (Exception ex)
                    {
                        _log($"[FrameShot] {ex.Message}");
                        try { await Task.Delay(500, ct); }
                        catch (OperationCanceledException) { break; }
                    }
                }
            }
            catch { }
            _running = false;
        }

        private void ProcessFrame()
        {
            if (_vrSystem == null) return;

            var evt = new VREvent_t();
            while (_vrSystem.PollNextEvent(ref evt, (uint)Marshal.SizeOf<VREvent_t>()))
            {
                if ((EVREventType)evt.eventType == EVREventType.VREvent_Quit)
                {
                    _vrSystem = null;
                    try { OpenVR.System?.AcknowledgeQuit_Exiting(); } catch { }
                    _cts?.Cancel();
                    _ = Task.Run(() => OnVRQuit?.Invoke());
                    return;
                }
            }

            _vrSystem.GetDeviceToAbsoluteTrackingPose(
                ETrackingUniverseOrigin.TrackingUniverseStanding, 0, _poses);
            UpdateControllerIndices();

            _leftHeldPrev  = _leftHeld;
            _rightHeldPrev = _rightHeld;
            _leftHeld     = IsButtonHeld(_leftIdx,  LeftButtonId);
            _rightHeld    = IsButtonHeld(_rightIdx, RightButtonId);
            _leftRecHeld  = LeftRecordButton  != 0 && IsButtonHeld(_leftIdx,  LeftRecordButton);
            _rightRecHeld = RightRecordButton != 0 && IsButtonHeld(_rightIdx, RightRecordButton);
            _leftVidHeld  = LeftVideoButton   != 0 && IsButtonHeld(_leftIdx,  LeftVideoButton);
            _rightVidHeld = RightVideoButton  != 0 && IsButtonHeld(_rightIdx, RightVideoButton);

            bool wasFraming        = IsFraming;
            bool wasRecording      = IsRecording;
            bool wasVideoRecording = IsVideoRecording;
            bool keysHeld          = _leftHeld && _rightHeld;
            bool recHeld           = _leftRecHeld || _rightRecHeld;
            bool vidHeld           = _leftVidHeld || _rightVidHeld;

            // Activation: only START framing when hands are within ActivationRadius.
            // Once framing has begun, the user is free to pull hands apart — the
            // gesture continues as long as both keys stay held.
            if (!keysHeld)
            {
                IsFraming = false;
            }
            else if (wasFraming)
            {
                IsFraming = true; // continue, no distance check
            }
            else
            {
                IsFraming = AreHandsWithinActivationRadius();
            }

            if (IsFraming && !wasFraming)
            {
                uint hmdIdx = (uint)OpenVR.k_unTrackedDeviceIndex_Hmd;
                if (_poses[hmdIdx].bPoseIsValid) _framingBasisLocked = true;
                PlaySoundAsync("Start.wav");
            }
            if (!IsFraming) _framingBasisLocked = false;
            if (!recHeld) _gifAutoStop = false;
            if (!vidHeld) _videoAutoStop = false;
            bool nowRecording      = IsFraming && recHeld && !_gifAutoStop && !IsVideoRecording;
            bool nowVideoRecording = IsFraming && vidHeld && !_videoAutoStop && !IsRecording;
            IsRecording      = nowRecording;
            IsVideoRecording = nowVideoRecording;

            if (IsRecording && !wasRecording)             StartRecording();
            if (!IsRecording && wasRecording)             StopRecordingAndSave();
            if (IsVideoRecording && !wasVideoRecording)   StartVideoRecording();
            if (!IsVideoRecording && wasVideoRecording)   StopVideoRecordingAndSave();

            if (IsFraming)
            {
                UpdateFrameAndRender();
            }
            else if (wasFraming)
            {
                // Released — distinguish photo vs cancel
                bool rightReleased = _rightHeldPrev && !_rightHeld;
                bool leftReleased  = _leftHeldPrev  && !_leftHeld;

                if (OpenVR.Overlay != null && _overlayHandle != 0)
                {
                    try { OpenVR.Overlay.HideOverlay(_overlayHandle); } catch { }
                }

                if (rightReleased && !leftReleased)
                {
                    // If we were just recording, the GIF replaces the photo.
                    if (!wasRecording)
                    {
                        PlaySoundAsync("Shot.wav");
                        _ = Task.Run(CaptureAndSave);
                    }
                }
                else if (leftReleased)
                {
                    PlaySoundAsync("Stop.wav");
                    _log("[FrameShot] Cancelled");
                }
            }
        }

        private bool AreHandsWithinActivationRadius()
        {
            if (_leftIdx == OpenVR.k_unTrackedDeviceIndexInvalid ||
                _rightIdx == OpenVR.k_unTrackedDeviceIndexInvalid ||
                !_poses[_leftIdx].bPoseIsValid || !_poses[_rightIdx].bPoseIsValid)
                return false;
            var L = PosFromMatrix(_poses[_leftIdx].mDeviceToAbsoluteTracking);
            var R = PosFromMatrix(_poses[_rightIdx].mDeviceToAbsoluteTracking);
            return (R - L).Length() <= ActivationRadius;
        }

        // Recording: GIF capture loop. Frame geometry is locked at record-start
        // (head-relative position + size). Crop on the mirror is constant since
        // the head-local frame doesn't move relative to the eye.
        private void StartRecording()
        {
            uint hmdIdx = (uint)OpenVR.k_unTrackedDeviceIndex_Hmd;
            if (!_poses[hmdIdx].bPoseIsValid)
            {
                IsRecording = false;
                return;
            }

            // Snapshot head-local offset of current hand midpoint
            var hmdM   = _poses[hmdIdx].mDeviceToAbsoluteTracking;
            var hmdPos = PosFromMatrix(hmdM);
            var hmdRot = RotFromMatrix(hmdM);
            var right  = Vector3.Transform(Vector3.UnitX,  hmdRot);
            var up     = Vector3.Transform(Vector3.UnitY,  hmdRot);
            var fwd    = Vector3.Transform(-Vector3.UnitZ, hmdRot);
            var mid    = (_lastLeftPos + _lastRightPos) * 0.5f;
            var off    = mid - hmdPos;
            _recordHeadLocalOffset = new Vector3(
                Vector3.Dot(off, right),
                Vector3.Dot(off, up),
                Vector3.Dot(off, fwd));

            _recordLockedWidth  = _lastFrameWidth;
            _recordLockedHeight = _lastFrameHeight;

            if (OpenVR.Overlay != null && _overlayHandle != 0)
            {
                var hmdLocal = new HmdMatrix34_t
                {
                    m0 = 1, m1 = 0, m2 = 0, m3 = _recordHeadLocalOffset.X,
                    m4 = 0, m5 = 1, m6 = 0, m7 = _recordHeadLocalOffset.Y,
                    m8 = 0, m9 = 0, m10 = 1, m11 = -_recordHeadLocalOffset.Z,
                };
                OpenVR.Overlay.SetOverlayTransformTrackedDeviceRelative(_overlayHandle, hmdIdx, ref hmdLocal);
            }

            lock (_recordFrames)
            {
                foreach (var b in _recordFrames) { try { b.Dispose(); } catch { } }
                _recordFrames.Clear();
            }
            _gifAutoStop = false;
            if (_lastDrawnW > 0 && _lastDrawnH > 0)
                DrawFrameTexture(_lastDrawnW, _lastDrawnH, true);
            _recordCts   = new CancellationTokenSource();
            _ = Task.Run(() => RecordCaptureLoopAsync(_recordCts.Token));
            StartRecordSoundLoop("Record.wav");
            _log("[FrameShot] Recording started");
        }

        private async Task RecordCaptureLoopAsync(CancellationToken ct)
        {
            if (!EnsureMirrorPipeline())
            {
                _gifAutoStop = true;
                return;
            }

            try { await Task.Delay(120, ct); }
            catch (OperationCanceledException) { return; }

            var start = DateTime.UtcNow;
            int frameIdx = 0;
            try
            {
                while (!ct.IsCancellationRequested)
                {
                    double elapsedMs = (DateTime.UtcNow - start).TotalMilliseconds;
                    if (elapsedMs > GIF_MAX_MS) { _gifAutoStop = true; break; }
                    if (frameIdx >= GifMaxFrames) { _gifAutoStop = true; break; }
                    var crop = ComputeRecordingCrop(_mirrorW, _mirrorH);
                    var bmp = CaptureMirrorCrop(crop);
                    if (bmp != null)
                    {
                        lock (_recordFrames) _recordFrames.Add(bmp);
                        frameIdx++;
                    }

                    double nextAt = frameIdx * GifFrameMs;
                    double wait = nextAt - (DateTime.UtcNow - start).TotalMilliseconds;
                    if (wait > 0) await Task.Delay((int)wait, ct);
                }
            }
            catch (OperationCanceledException) { }
            catch (Exception ex) { _log($"[FrameShot] Record loop: {ex.Message}"); }
        }
        private System.Drawing.Rectangle ComputeRecordingCrop(int mw, int mh)
        {
            uint hmdIdx = (uint)OpenVR.k_unTrackedDeviceIndex_Hmd;
            if (_vrSystem == null || !_poses[hmdIdx].bPoseIsValid)
                return _recordCrop;

            var hmdM   = _poses[hmdIdx].mDeviceToAbsoluteTracking;
            var hmdRot = RotFromMatrix(hmdM);
            var hmdPos = PosFromMatrix(hmdM);

            Vector3 hmdRight = Vector3.Transform(Vector3.UnitX,  hmdRot);
            Vector3 hmdUp    = Vector3.Transform(Vector3.UnitY,  hmdRot);
            Vector3 hmdFwd   = Vector3.Transform(-Vector3.UnitZ, hmdRot);
            Vector3 center = hmdPos
                + hmdRight * _recordHeadLocalOffset.X
                + hmdUp    * _recordHeadLocalOffset.Y
                + hmdFwd   * _recordHeadLocalOffset.Z;

            float halfW = _recordLockedWidth  * 0.5f;
            float halfH = _recordLockedHeight * 0.5f;

            var eyeToHead = _vrSystem.GetEyeToHeadTransform(EVREye.Eye_Left);
            var hmdWorld  = ToMatrix4x4(hmdM);
            var eyeOffset = ToMatrix4x4(eyeToHead);
            var eyeWorld  = eyeOffset * hmdWorld;
            Matrix4x4.Invert(eyeWorld, out var view);
            var proj = ToMatrix4x4Proj(_vrSystem.GetProjectionMatrix(EVREye.Eye_Left, 0.05f, 50f));
            var vp = view * proj;

            Vector3[] corners =
            {
                center - hmdRight * halfW - hmdUp * halfH,
                center + hmdRight * halfW - hmdUp * halfH,
                center + hmdRight * halfW + hmdUp * halfH,
                center - hmdRight * halfW + hmdUp * halfH,
            };

            int minX = int.MaxValue, minY = int.MaxValue, maxX = int.MinValue, maxY = int.MinValue;
            foreach (var w in corners)
            {
                var clip = Vector4.Transform(new Vector4(w, 1f), vp);
                if (clip.W <= 0) continue;
                float ndcX = clip.X / clip.W;
                float ndcY = clip.Y / clip.W;
                int px = (int)((ndcX * 0.5f + 0.5f) * mw);
                int py = (int)((1f - (ndcY * 0.5f + 0.5f)) * mh);
                if (px < minX) minX = px;
                if (py < minY) minY = py;
                if (px > maxX) maxX = px;
                if (py > maxY) maxY = py;
            }
            if (minX == int.MaxValue) return _recordCrop;

            int x0 = Math.Clamp(minX, 0, mw - 1);
            int y0 = Math.Clamp(minY, 0, mh - 1);
            int x1 = Math.Clamp(maxX, 0, mw - 1);
            int y1 = Math.Clamp(maxY, 0, mh - 1);
            return new System.Drawing.Rectangle(x0, y0, Math.Max(2, x1 - x0), Math.Max(2, y1 - y0));
        }

        private void StopRecordingAndSave()
        {
            try { _recordCts?.Cancel(); } catch { }
            _recordCts = null;
            StopRecordSoundLoop();

            List<Bitmap> frames;
            lock (_recordFrames)
            {
                frames = new List<Bitmap>(_recordFrames);
                _recordFrames.Clear();
            }

            // Hide overlay during the brief save window
            if (OpenVR.Overlay != null && _overlayHandle != 0)
            {
                try { OpenVR.Overlay.HideOverlay(_overlayHandle); } catch { }
            }

            if (frames.Count < 2)
            {
                foreach (var f in frames) { try { f.Dispose(); } catch { } }
                _log($"[FrameShot] Recording too short ({frames.Count} frame), discarded");
                return;
            }

            PlaySoundAsync("Record_Done.wav");
            _ = Task.Run(() => SaveAnimatedGif(frames));
        }

        private Bitmap? CaptureMirrorCrop(System.Drawing.Rectangle crop) => CaptureMirrorCrop(crop, true);

        private Bitmap? CaptureMirrorCrop(System.Drawing.Rectangle crop, bool applyGifDownscale)
        {
            try
            {
                Bitmap? bmp = null;
                lock (_d3dLock)
                {
                    if (_d3dContext == null || _mirrorStaging == null || _mirrorTexCached == null) return null;
                    var srcBox = new Vortice.Mathematics.Box(crop.X, crop.Y, 0, crop.X + crop.Width, crop.Y + crop.Height, 1);
                    _d3dContext.CopySubresourceRegion(_mirrorStaging, 0, (uint)crop.X, (uint)crop.Y, 0, _mirrorTexCached, 0, srcBox);
                    var box = _d3dContext.Map(_mirrorStaging, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None);
                    try
                    {
                        bmp = new Bitmap(crop.Width, crop.Height, PixelFormat.Format32bppArgb);
                        var rect  = new System.Drawing.Rectangle(0, 0, crop.Width, crop.Height);
                        var bData = bmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                        try
                        {
                            var fmtName = _mirrorSrvFormat.ToString();
                            bool swapRB = !fmtName.StartsWith("B8G8R8A8", StringComparison.Ordinal);
                            var rowBuf  = new byte[crop.Width * 4];
                            for (int y = 0; y < crop.Height; y++)
                            {
                                var srcRowPtr = box.DataPointer
                                                + (nint)((long)(y + crop.Y) * box.RowPitch)
                                                + (nint)(crop.X * 4);
                                Marshal.Copy(srcRowPtr, rowBuf, 0, crop.Width * 4);
                                if (swapRB)
                                {
                                    for (int x = 0; x < crop.Width; x++)
                                    {
                                        byte r = rowBuf[x * 4 + 0];
                                        byte b = rowBuf[x * 4 + 2];
                                        rowBuf[x * 4 + 0] = b;
                                        rowBuf[x * 4 + 2] = r;
                                        rowBuf[x * 4 + 3] = 255;
                                    }
                                }
                                else
                                {
                                    for (int x = 0; x < crop.Width; x++) rowBuf[x * 4 + 3] = 255;
                                }
                                Marshal.Copy(rowBuf, 0, bData.Scan0 + (nint)(y * bData.Stride), crop.Width * 4);
                            }
                        }
                        finally { bmp.UnlockBits(bData); }
                    }
                    finally { _d3dContext.Unmap(_mirrorStaging, 0); }
                }
                return applyGifDownscale ? DownscaleIfNeeded(bmp, _gifMaxDim) : bmp;
            }
            catch (Exception ex)
            {
                _log($"[FrameShot] CaptureMirrorCrop: {ex.Message}");
                return null;
            }
        }

        private static Bitmap DownscaleIfNeeded(Bitmap src, int maxDim)
        {
            if (src.Width <= maxDim && src.Height <= maxDim) return src;
            double scale = Math.Min((double)maxDim / src.Width, (double)maxDim / src.Height);
            int tw = Math.Max(1, (int)Math.Round(src.Width  * scale));
            int th = Math.Max(1, (int)Math.Round(src.Height * scale));
            var dst = new Bitmap(tw, th, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(dst))
            {
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
                g.PixelOffsetMode   = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                g.DrawImage(src, 0, 0, tw, th);
            }
            src.Dispose();
            return dst;
        }

        // ====================== VIDEO RECORDING (MP4) ======================

        public static (string id, string label)[] GetAudioDevices()
        {
            var list = new List<(string, string)>();
            try
            {
                var en = new NAudio.CoreAudioApi.MMDeviceEnumerator();
                foreach (var d in en.EnumerateAudioEndPoints(NAudio.CoreAudioApi.DataFlow.Capture, NAudio.CoreAudioApi.DeviceState.Active))
                    list.Add((d.ID, $"{d.FriendlyName}"));
                foreach (var d in en.EnumerateAudioEndPoints(NAudio.CoreAudioApi.DataFlow.Render, NAudio.CoreAudioApi.DeviceState.Active))
                    list.Add(($"loopback:{d.ID}", $"{d.FriendlyName} (System Audio)"));
            }
            catch { }
            return list.ToArray();
        }

        private NAudio.Wave.IWaveIn? StartAudioCapture(string deviceId, string wavPath, out NAudio.Wave.WaveFileWriter? writer)
        {
            writer = null;
            if (string.IsNullOrEmpty(deviceId)) return null;
            try
            {
                var en = new NAudio.CoreAudioApi.MMDeviceEnumerator();
                NAudio.Wave.IWaveIn cap;
                if (deviceId.StartsWith("loopback:", StringComparison.Ordinal))
                {
                    var id = deviceId.Substring("loopback:".Length);
                    var dev = en.GetDevice(id);
                    cap = new NAudio.Wave.WasapiLoopbackCapture(dev);
                }
                else
                {
                    var dev = en.GetDevice(deviceId);
                    cap = new NAudio.CoreAudioApi.WasapiCapture(dev);
                }
                var w = new NAudio.Wave.WaveFileWriter(wavPath, cap.WaveFormat);
                writer = w;
                cap.DataAvailable += (s, e) =>
                {
                    try { w.Write(e.Buffer, 0, e.BytesRecorded); } catch { }
                };
                cap.StartRecording();
                return cap;
            }
            catch (Exception ex)
            {
                _log($"[FrameShot] Audio capture '{deviceId}': {ex.Message}");
                return null;
            }
        }

        private void StartVideoRecording()
        {
            uint hmdIdx = (uint)OpenVR.k_unTrackedDeviceIndex_Hmd;
            if (!_poses[hmdIdx].bPoseIsValid) { IsVideoRecording = false; return; }
            if (_lastFrameWidth <= 0.001f || _lastFrameHeight <= 0.001f) { IsVideoRecording = false; return; }

            var hmdM   = _poses[hmdIdx].mDeviceToAbsoluteTracking;
            var hmdPos = PosFromMatrix(hmdM);
            var hmdRot = RotFromMatrix(hmdM);
            var right  = Vector3.Transform(Vector3.UnitX,  hmdRot);
            var up     = Vector3.Transform(Vector3.UnitY,  hmdRot);
            var fwd    = Vector3.Transform(-Vector3.UnitZ, hmdRot);
            var mid    = (_lastLeftPos + _lastRightPos) * 0.5f;
            var off    = mid - hmdPos;
            _recordHeadLocalOffset = new Vector3(
                Vector3.Dot(off, right),
                Vector3.Dot(off, up),
                Vector3.Dot(off, fwd));
            _recordLockedWidth  = _lastFrameWidth;
            _recordLockedHeight = _lastFrameHeight;

            float aspect = _lastFrameHeight / Math.Max(0.001f, _lastFrameWidth);
            _videoFrameWBytes = _videoTargetW;
            _videoFrameHBytes = Math.Max(2, (int)Math.Round(_videoTargetW * aspect));
            if (_videoFrameHBytes > _videoTargetH)
            {
                _videoFrameHBytes = _videoTargetH;
                _videoFrameWBytes = Math.Max(2, (int)Math.Round(_videoTargetH / aspect));
            }
            if ((_videoFrameWBytes & 1) == 1) _videoFrameWBytes++;
            if ((_videoFrameHBytes & 1) == 1) _videoFrameHBytes++;

            try
            {
                _videoSessionDir = Path.Combine(Path.GetTempPath(), "VRCNext_FrameShot_" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(_videoSessionDir);
            }
            catch (Exception ex)
            {
                _log($"[FrameShot] Video temp dir: {ex.Message}");
                IsVideoRecording = false;
                return;
            }

            if (OpenVR.Overlay != null && _overlayHandle != 0)
            {
                var hmdLocal = new HmdMatrix34_t
                {
                    m0 = 1, m1 = 0, m2 = 0, m3 = _recordHeadLocalOffset.X,
                    m4 = 0, m5 = 1, m6 = 0, m7 = _recordHeadLocalOffset.Y,
                    m8 = 0, m9 = 0, m10 = 1, m11 = -_recordHeadLocalOffset.Z,
                };
                OpenVR.Overlay.SetOverlayTransformTrackedDeviceRelative(_overlayHandle, hmdIdx, ref hmdLocal);
            }

            _videoFrameCount = 0;
            _videoAutoStop = false;
            _videoFfmpegProc = null;
            _videoFfmpegStdin = null;
            _videoEncodedPath = Path.Combine(_videoSessionDir, "v-only.mp4");

            if (_lastDrawnW > 0 && _lastDrawnH > 0) DrawFrameTexture(_lastDrawnW, _lastDrawnH, true);

            PlaySoundAsync("Video_Start.wav");

            _videoCts = new CancellationTokenSource();
            var ct = _videoCts.Token;
            string sessDir = _videoSessionDir;
            _ = Task.Run(async () =>
            {
                try { await Task.Delay(500, ct); } catch (OperationCanceledException) { return; }
                if (!EnsureMirrorPipeline()) { _videoAutoStop = true; return; }
                try { await Task.Delay(120, ct); } catch (OperationCanceledException) { return; }
                _audioCapA = StartAudioCapture(_videoDeviceA, Path.Combine(sessDir, "a.wav"), out _audioWriterA);
                _audioCapB = StartAudioCapture(_videoDeviceB, Path.Combine(sessDir, "b.wav"), out _audioWriterB);
                _videoStartUtc = DateTime.UtcNow;
                await VideoCaptureLoopAsync(ct);
            });
            _log("[FrameShot] Video recording started");
        }

        private async Task VideoCaptureLoopAsync(CancellationToken ct)
        {
            var start = DateTime.UtcNow;
            int frameIdx = 0;
            int nativeW = 0, nativeH = 0;
            try
            {
                while (!ct.IsCancellationRequested)
                {
                    double elapsedMs = (DateTime.UtcNow - start).TotalMilliseconds;
                    if (elapsedMs > VIDEO_MAX_MS) { _videoAutoStop = true; break; }

                    var crop = ComputeRecordingCrop(_mirrorW, _mirrorH);
                    if (nativeW == 0)
                    {
                        nativeW = crop.Width  & ~1;
                        nativeH = crop.Height & ~1;
                        if (nativeW < 2 || nativeH < 2) { await Task.Delay(_videoFrameMs, ct); continue; }
                        _videoFrameWBytes = nativeW;
                        _videoFrameHBytes = nativeH;
                        if (!StartLiveEncoder(nativeW, nativeH)) { _videoAutoStop = true; break; }
                    }
                    var lockedCrop = new System.Drawing.Rectangle(
                        Math.Clamp(crop.X, 0, _mirrorW - nativeW),
                        Math.Clamp(crop.Y, 0, _mirrorH - nativeH),
                        nativeW, nativeH);
                    var bytes = CaptureMirrorCropRaw(lockedCrop, nativeW, nativeH);
                    if (bytes != null)
                    {
                        lock (_videoRawLock)
                        {
                            try { _videoFfmpegStdin?.Write(bytes, 0, bytes.Length); _videoFrameCount++; frameIdx++; }
                            catch (Exception ex) { _log($"[FrameShot] Video write: {ex.Message}"); _videoAutoStop = true; break; }
                        }
                    }

                    double nextAt = frameIdx * _videoFrameMs;
                    double wait = nextAt - (DateTime.UtcNow - start).TotalMilliseconds;
                    if (wait > 0) await Task.Delay((int)wait, ct);
                }
            }
            catch (OperationCanceledException) { }
            catch (Exception ex) { _log($"[FrameShot] Video loop: {ex.Message}"); }
        }

        private byte[]? CaptureMirrorCropRaw(System.Drawing.Rectangle crop, int outW, int outH)
        {
            var bmp = CaptureMirrorCrop(crop, false);
            if (bmp == null) return null;
            try
            {
                Bitmap scaled = bmp;
                if (bmp.Width != outW || bmp.Height != outH)
                {
                    scaled = new Bitmap(outW, outH, PixelFormat.Format32bppArgb);
                    using (var g = Graphics.FromImage(scaled))
                    {
                        g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Bilinear;
                        g.DrawImage(bmp, 0, 0, outW, outH);
                    }
                    bmp.Dispose();
                }
                var bytes = new byte[outW * outH * 4];
                var bData = scaled.LockBits(new Rectangle(0, 0, outW, outH), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                try
                {
                    for (int y = 0; y < outH; y++)
                        Marshal.Copy(bData.Scan0 + y * bData.Stride, bytes, y * outW * 4, outW * 4);
                }
                finally { scaled.UnlockBits(bData); }
                scaled.Dispose();
                return bytes;
            }
            catch (Exception ex)
            {
                _log($"[FrameShot] VideoFrame: {ex.Message}");
                return null;
            }
        }

        private void StopVideoRecordingAndSave()
        {
            try { _videoCts?.Cancel(); } catch { }
            _videoCts = null;

            try { _audioCapA?.StopRecording(); } catch { }
            try { _audioCapB?.StopRecording(); } catch { }
            try { _audioWriterA?.Dispose();   } catch { }
            try { _audioWriterB?.Dispose();   } catch { }
            try { _audioCapA?.Dispose();      } catch { }
            try { _audioCapB?.Dispose();      } catch { }
            _audioWriterA = null; _audioWriterB = null;
            _audioCapA = null;    _audioCapB = null;

            int frameCount;
            System.Diagnostics.Process? encProc;
            string? encodedPath;
            lock (_videoRawLock)
            {
                try { _videoFfmpegStdin?.Flush(); _videoFfmpegStdin?.Close(); _videoFfmpegStdin?.Dispose(); } catch { }
                _videoFfmpegStdin = null;
                encProc = _videoFfmpegProc;
                _videoFfmpegProc = null;
                encodedPath = _videoEncodedPath;
                frameCount = _videoFrameCount;
            }
            _videoAutoStop = false;

            if (OpenVR.Overlay != null && _overlayHandle != 0)
                try { OpenVR.Overlay.HideOverlay(_overlayHandle); } catch { }

            if (frameCount < 2)
            {
                _log($"[FrameShot] Video too short ({frameCount} frame), discarded");
                TryDeleteSessionDir();
                return;
            }

            PlaySoundAsync("Video_Done.wav");
            string sessionDir = _videoSessionDir ?? "";
            int audioKbps = _videoAudioKbps;
            double realSec = Math.Max(0.1, (DateTime.UtcNow - _videoStartUtc).TotalSeconds);
            double actualFps = Math.Max(1.0, frameCount / realSec);
            _log($"[FrameShot] Captured {frameCount} frames in {realSec:0.00}s ({actualFps:0.0} fps, target {_videoFps})");
            _ = Task.Run(() =>
            {
                try { FinalizeVideo(encProc, encodedPath ?? "", sessionDir, audioKbps, actualFps); }
                catch (Exception ex) { _log($"[FrameShot] Finalize task crashed: {ex.GetType().Name}: {ex.Message}"); }
            });
        }

        private void TryDeleteSessionDir()
        {
            if (string.IsNullOrEmpty(_videoSessionDir)) return;
            try { Directory.Delete(_videoSessionDir, true); } catch { }
            _videoSessionDir = null;
        }

        private static string? FindFfmpegPath()
        {
            var local = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ffmpeg.exe");
            if (File.Exists(local)) return local;
            var sub = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ffmpeg", "ffmpeg.exe");
            if (File.Exists(sub)) return sub;
            var pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (var dir in pathEnv.Split(';'))
            {
                if (string.IsNullOrWhiteSpace(dir)) continue;
                try
                {
                    var candidate = Path.Combine(dir.Trim(), "ffmpeg.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }
            return null;
        }

        private bool StartLiveEncoder(int nativeW, int nativeH)
        {
            var ffmpeg = FindFfmpegPath();
            if (ffmpeg == null)
            {
                _log("[FrameShot] ffmpeg.exe not found — install or place next to VRCNext.exe");
                return false;
            }
            int targetW = _videoTargetW, targetH = _videoTargetH;
            int crf = _videoBitrateQuality switch { "low" => 28, "high" => 18, _ => 23 };
            string fpsStr = _videoFps.ToString(System.Globalization.CultureInfo.InvariantCulture);

            var args = new System.Text.StringBuilder();
            args.Append($"-hide_banner -loglevel error -nostats -y -f rawvideo -pix_fmt bgra -s {nativeW}x{nativeH} -r {fpsStr} -i pipe:0 ");
            bool needScale = nativeW > targetW || nativeH > targetH;
            if (needScale)
                args.Append($"-vf \"scale={targetW}:{targetH}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=fast_bilinear\" ");
            args.Append($"-an -c:v libx264 -preset ultrafast -tune zerolatency -threads 0 -crf {crf} -pix_fmt yuv420p -movflags +faststart \"{_videoEncodedPath}\"");

            try
            {
                var psi = new System.Diagnostics.ProcessStartInfo(ffmpeg, args.ToString())
                {
                    UseShellExecute        = false,
                    CreateNoWindow         = true,
                    RedirectStandardInput  = true,
                    RedirectStandardError  = true,
                    RedirectStandardOutput = true,
                };
                var proc = System.Diagnostics.Process.Start(psi);
                if (proc == null) { _log("[FrameShot] live encoder start failed"); return false; }
                proc.ErrorDataReceived  += (_, e) => { if (!string.IsNullOrEmpty(e.Data)) _log($"[FrameShot] enc: {e.Data}"); };
                proc.OutputDataReceived += (_, _) => { };
                proc.BeginErrorReadLine();
                proc.BeginOutputReadLine();
                _videoFfmpegProc  = proc;
                _videoFfmpegStdin = proc.StandardInput.BaseStream;
                return true;
            }
            catch (Exception ex)
            {
                _log($"[FrameShot] live encoder exception: {ex.Message}");
                return false;
            }
        }

        private void FinalizeVideo(System.Diagnostics.Process? encProc, string encodedPath, string sessionDir, int audioKbps, double actualFps)
        {
            try
            {
                if (encProc == null || string.IsNullOrEmpty(encodedPath))
                {
                    _log("[FrameShot] FinalizeVideo: no encoder state");
                    TryDeleteSessionDir();
                    return;
                }

                if (!encProc.WaitForExit(15_000))
                {
                    try { encProc.Kill(); } catch { }
                    _log("[FrameShot] live encoder timed out");
                    TryDeleteSessionDir();
                    return;
                }
                if (encProc.ExitCode != 0)
                {
                    _log($"[FrameShot] live encoder failed exit={encProc.ExitCode}");
                    TryDeleteSessionDir();
                    return;
                }
                try { encProc.Dispose(); } catch { }

                var ffmpeg = FindFfmpegPath();
                if (ffmpeg == null) { TryDeleteSessionDir(); return; }

                try { Directory.CreateDirectory(OutputDir); } catch { }
                var finalName = $"{DateTime.Now:yyyy-MM-dd_HH-mm-ss}.mp4";
                var outPath   = Path.Combine(OutputDir, finalName);
                var tmpPath   = Path.Combine(sessionDir, "out.mp4");

                var aPath = Path.Combine(sessionDir, "a.wav");
                var bPath = Path.Combine(sessionDir, "b.wav");
                bool hasA = File.Exists(aPath) && new FileInfo(aPath).Length > 1024;
                bool hasB = File.Exists(bPath) && new FileInfo(bPath).Length > 1024;

                string fpsStr = actualFps.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
                var args = new System.Text.StringBuilder();
                args.Append($"-hide_banner -loglevel error -nostats -y -r {fpsStr} -i \"{encodedPath}\" ");
                int audioCount = 0;
                if (hasA) { args.Append($"-i \"{aPath}\" "); audioCount++; }
                if (hasB) { args.Append($"-i \"{bPath}\" "); audioCount++; }
                if (audioCount == 2)
                    args.Append("-filter_complex \"[1:a][2:a]amix=inputs=2:duration=shortest:dropout_transition=0[a]\" -map 0:v -map \"[a]\" ");
                else if (audioCount == 1)
                    args.Append("-map 0:v -map 1:a ");
                else
                    args.Append("-map 0:v ");
                args.Append("-c:v copy -movflags +faststart ");
                if (audioCount > 0) args.Append($"-c:a aac -b:a {audioKbps}k ");
                args.Append($"\"{tmpPath}\"");

                var psi = new System.Diagnostics.ProcessStartInfo(ffmpeg, args.ToString())
                {
                    UseShellExecute = false,
                    CreateNoWindow  = true,
                    RedirectStandardError  = true,
                    RedirectStandardOutput = true,
                };
                using var muxProc = System.Diagnostics.Process.Start(psi);
                if (muxProc == null) { _log("[FrameShot] mux start failed"); TryDeleteSessionDir(); return; }
                var errBuf = new System.Text.StringBuilder();
                muxProc.ErrorDataReceived  += (_, e) => { if (e.Data != null) lock (errBuf) errBuf.AppendLine(e.Data); };
                muxProc.OutputDataReceived += (_, _) => { };
                muxProc.BeginErrorReadLine();
                muxProc.BeginOutputReadLine();
                muxProc.WaitForExit();
                if (muxProc.ExitCode != 0)
                {
                    string err; lock (errBuf) err = errBuf.ToString();
                    _log($"[FrameShot] mux failed ({muxProc.ExitCode}): {err.Substring(0, Math.Min(err.Length, 400))}");
                    TryDeleteSessionDir();
                    return;
                }

                try { File.Move(tmpPath, outPath); }
                catch (Exception ex) { _log($"[FrameShot] MP4 move failed: {ex.Message}"); TryDeleteSessionDir(); return; }

                _log($"[FrameShot] Saved {outPath}");
                try { OnPhotoSaved?.Invoke(outPath); } catch { }
            }
            catch (Exception ex)
            {
                _log($"[FrameShot] FinalizeVideo failed: {ex.Message}");
            }
            finally
            {
                TryDeleteSessionDir();
            }
        }

        // ====================== END VIDEO RECORDING ======================

        private void SaveAnimatedGif(List<Bitmap> frames)
        {
            try
            {
                try { Directory.CreateDirectory(OutputDir); } catch { }
                var path = Path.Combine(OutputDir, $"{DateTime.Now:yyyy-MM-dd_HH-mm-ss}.gif");

                int delayCs = Math.Max(1, GifFrameMs / 10);
                var delayBytes = new byte[frames.Count * 4];
                for (int i = 0; i < frames.Count; i++)
                {
                    delayBytes[i * 4 + 0] = (byte)(delayCs & 0xFF);
                    delayBytes[i * 4 + 1] = (byte)((delayCs >> 8) & 0xFF);
                    delayBytes[i * 4 + 2] = 0;
                    delayBytes[i * 4 + 3] = 0;
                }

                var delayProp = (PropertyItem)RuntimeHelpers.GetUninitializedObject(typeof(PropertyItem));
                delayProp.Id   = 0x5100; // FrameDelay
                delayProp.Type = 4;
                delayProp.Len  = delayBytes.Length;
                delayProp.Value = delayBytes;

                var loopProp = (PropertyItem)RuntimeHelpers.GetUninitializedObject(typeof(PropertyItem));
                loopProp.Id   = 0x5101; // LoopCount (0 = infinite)
                loopProp.Type = 3;
                loopProp.Len  = 2;
                loopProp.Value = new byte[] { 0, 0 };

                frames[0].SetPropertyItem(delayProp);
                frames[0].SetPropertyItem(loopProp);

                var codec = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Gif.Guid);
                var p = new EncoderParameters(1);
                p.Param[0] = new EncoderParameter(Encoder.SaveFlag, (long)EncoderValue.MultiFrame);
                frames[0].Save(path, codec, p);

                p.Param[0] = new EncoderParameter(Encoder.SaveFlag, (long)EncoderValue.FrameDimensionTime);
                for (int i = 1; i < frames.Count; i++) frames[0].SaveAdd(frames[i], p);

                p.Param[0] = new EncoderParameter(Encoder.SaveFlag, (long)EncoderValue.Flush);
                frames[0].SaveAdd(p);

                _log($"[FrameShot] Saved {path} ({frames.Count} frames)");
                try { OnPhotoSaved?.Invoke(path); } catch { }
            }
            catch (Exception ex)
            {
                _log($"[FrameShot] GIF save failed: {ex.Message}");
            }
            finally
            {
                foreach (var f in frames) { try { f.Dispose(); } catch { } }
            }
        }

        private bool IsButtonHeld(uint deviceIdx, uint buttonId)
        {
            if (_vrSystem == null || deviceIdx == OpenVR.k_unTrackedDeviceIndexInvalid) return false;
            var s = new VRControllerState_t();
            if (!_vrSystem.GetControllerState(deviceIdx, ref s, (uint)Marshal.SizeOf<VRControllerState_t>()))
                return false;
            return (s.ulButtonPressed & (1UL << (int)buttonId)) != 0;
        }

        private void UpdateControllerIndices()
        {
            if (_vrSystem == null) return;
            _leftIdx  = _vrSystem.GetTrackedDeviceIndexForControllerRole(ETrackedControllerRole.LeftHand);
            _rightIdx = _vrSystem.GetTrackedDeviceIndexForControllerRole(ETrackedControllerRole.RightHand);
        }

        private static Vector3 PosFromMatrix(in HmdMatrix34_t m) => new(m.m3, m.m7, m.m11);

        private static Quaternion RotFromMatrix(in HmdMatrix34_t m)
        {
            float tr = m.m0 + m.m5 + m.m10;
            Quaternion q;
            if (tr > 0f)
            {
                float s = MathF.Sqrt(tr + 1f) * 2f;
                q = new Quaternion((m.m9 - m.m6) / s, (m.m2 - m.m8) / s, (m.m4 - m.m1) / s, 0.25f * s);
            }
            else if (m.m0 > m.m5 && m.m0 > m.m10)
            {
                float s = MathF.Sqrt(1f + m.m0 - m.m5 - m.m10) * 2f;
                q = new Quaternion(0.25f * s, (m.m1 + m.m4) / s, (m.m2 + m.m8) / s, (m.m9 - m.m6) / s);
            }
            else if (m.m5 > m.m10)
            {
                float s = MathF.Sqrt(1f + m.m5 - m.m0 - m.m10) * 2f;
                q = new Quaternion((m.m1 + m.m4) / s, 0.25f * s, (m.m6 + m.m9) / s, (m.m2 - m.m8) / s);
            }
            else
            {
                float s = MathF.Sqrt(1f + m.m10 - m.m0 - m.m5) * 2f;
                q = new Quaternion((m.m2 + m.m8) / s, (m.m6 + m.m9) / s, 0.25f * s, (m.m4 - m.m1) / s);
            }
            return Quaternion.Normalize(q);
        }

        private void UpdateFrameAndRender()
        {
            if (_leftIdx == OpenVR.k_unTrackedDeviceIndexInvalid ||
                _rightIdx == OpenVR.k_unTrackedDeviceIndexInvalid ||
                OpenVR.Overlay == null || _overlayHandle == 0 ||
                !_framingBasisLocked) return;

            uint hmdIdx = (uint)OpenVR.k_unTrackedDeviceIndex_Hmd;
            if (!_poses[_leftIdx].bPoseIsValid || !_poses[_rightIdx].bPoseIsValid || !_poses[hmdIdx].bPoseIsValid)
                return;

            var L = PosFromMatrix(_poses[_leftIdx].mDeviceToAbsoluteTracking);
            var R = PosFromMatrix(_poses[_rightIdx].mDeviceToAbsoluteTracking);
            var hmdM   = _poses[hmdIdx].mDeviceToAbsoluteTracking;
            var hmdPos = PosFromMatrix(hmdM);
            var hmdRot = RotFromMatrix(hmdM);

            Vector3 hmdRightLive = Vector3.Transform(Vector3.UnitX,  hmdRot);
            Vector3 hmdUpLive    = Vector3.Transform(Vector3.UnitY,  hmdRot);
            Vector3 hmdFwdLive   = Vector3.Transform(-Vector3.UnitZ, hmdRot);

            Vector3 hmdRight, hmdUp, hmdFwd;
            float widthM, heightM;
            Vector3 center;

            if (IsRecording || IsVideoRecording)
            {
                hmdRight = hmdRightLive;
                hmdUp    = hmdUpLive;
                hmdFwd   = hmdFwdLive;
                widthM   = _recordLockedWidth  * RECORD_VISUAL_SCALE;
                heightM  = _recordLockedHeight * RECORD_VISUAL_SCALE;
                center   = hmdPos
                         + hmdRight * _recordHeadLocalOffset.X
                         + hmdUp    * _recordHeadLocalOffset.Y
                         + hmdFwd   * _recordHeadLocalOffset.Z;
            }
            else
            {
                if (UseHmdRotations)
                {
                    hmdRight = hmdRightLive;
                    hmdUp    = hmdUpLive;
                    hmdFwd   = hmdFwdLive;
                }
                else
                {
                    hmdFwd = hmdFwdLive;
                    Vector3 right = Vector3.Cross(hmdFwd, Vector3.UnitY);
                    if (right.LengthSquared() < 1e-6f) right = hmdRightLive;
                    hmdRight = Vector3.Normalize(right);
                    hmdUp    = Vector3.Normalize(Vector3.Cross(hmdRight, hmdFwd));
                }

                center = (L + R) * 0.5f;

                Vector3 diff = R - L;
                widthM  = MathF.Max(0.02f, MathF.Abs(Vector3.Dot(diff, hmdRight)));
                heightM = MathF.Max(0.02f, MathF.Abs(Vector3.Dot(diff, hmdUp)));

                _lastLeftPos     = L;
                _lastRightPos    = R;
                _lastFrameWidth  = widthM;
                _lastFrameHeight = heightM;
            }

            // Compute drawn pixel rect once, here — used for both texture redraw
            // AND for SetOverlayTextureBounds. Tracking the integer pixel dims (not
            // the float aspect) avoids flicker: any sub-pixel hand movement would
            // shift the bounds but not the cached texture, leaving stale border
            // pixels outside the new bounds → edges flickering on/off.
            float aspect = heightM / widthM;
            int drawW = FRAME_TEX_W;
            int drawH = (int)MathF.Round(FRAME_TEX_W * aspect);
            if (drawH > FRAME_TEX_H) { drawH = FRAME_TEX_H; drawW = (int)MathF.Round(FRAME_TEX_H / aspect); }

            DrawFrameTexture(drawW, drawH, IsRecording);
            _lastDrawnW = drawW;
            _lastDrawnH = drawH;

            OpenVR.Overlay.SetOverlayWidthInMeters(_overlayHandle, widthM);

            if (!IsRecording && !IsVideoRecording)
            {
                var transform = new HmdMatrix34_t
                {
                    m0 = hmdRight.X, m1 = hmdUp.X, m2 = -hmdFwd.X, m3 = center.X,
                    m4 = hmdRight.Y, m5 = hmdUp.Y, m6 = -hmdFwd.Y, m7 = center.Y,
                    m8 = hmdRight.Z, m9 = hmdUp.Z, m10 = -hmdFwd.Z, m11 = center.Z,
                };
                OpenVR.Overlay.SetOverlayTransformAbsolute(_overlayHandle,
                    ETrackingUniverseOrigin.TrackingUniverseStanding, ref transform);
            }

            OpenVR.Overlay.ShowOverlay(_overlayHandle);
        }

        private void DrawFrameTexture(int drawW, int drawH, bool recording)
        {
            if (_frameBitmap == null || _d3dContext == null || _stagingTex == null || _overlayTex == null) return;

            using (var g = Graphics.FromImage(_frameBitmap))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);

                Color borderColor;
                if (IsVideoRecording)      borderColor = Color.FromArgb(255, 255, 170,  60); // orange (video)
                else if (recording)        borderColor = Color.FromArgb(255, 255,  70,  70); // red (gif)
                else                       borderColor = Color.FromArgb(255, 130, 210, 255); // light-blue (idle)
                using var pen = new Pen(borderColor, 8f);
                int inset = 4;
                g.DrawRectangle(pen, inset, inset, drawW - inset * 2 - 1, drawH - inset * 2 - 1);

                // Subtle inner shadow line for definition
                using var pen2 = new Pen(Color.FromArgb(120, 255, 255, 255), 1.5f);
                g.DrawRectangle(pen2, inset + 6, inset + 6, drawW - inset * 2 - 13, drawH - inset * 2 - 13);
            }

            var rect = new Rectangle(0, 0, FRAME_TEX_W, FRAME_TEX_H);
            var bData = _frameBitmap.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            try
            {
                int rowBytes  = FRAME_TEX_W * 4;
                int srcStride = bData.Stride;
                lock (_d3dLock)
                {
                    if (_d3dContext == null || _stagingTex == null || _overlayTex == null) return;
                    var box = _d3dContext.Map(_stagingTex, 0, MapMode.Write, Vortice.Direct3D11.MapFlags.None);
                    try
                    {
                        for (int y = 0; y < FRAME_TEX_H; y++)
                        {
                            Marshal.Copy(bData.Scan0 + y * srcStride, _frameUploadBuf, 0, rowBytes);
                            Marshal.Copy(_frameUploadBuf, 0,
                                box.DataPointer + (nint)((long)y * box.RowPitch),
                                rowBytes);
                        }
                    }
                    finally { _d3dContext.Unmap(_stagingTex, 0); }
                    _d3dContext.CopyResource(_overlayTex, _stagingTex);
                }
            }
            finally { _frameBitmap.UnlockBits(bData); }

            var bounds = new VRTextureBounds_t
            {
                uMin = 0f, vMin = 0f,
                uMax = (float)drawW / FRAME_TEX_W,
                vMax = (float)drawH / FRAME_TEX_H,
            };
            OpenVR.Overlay?.SetOverlayTextureBounds(_overlayHandle, ref bounds);

            var vrTex = new Texture_t
            {
                handle      = _overlayTex.NativePointer,
                eType       = ETextureType.DirectX,
                eColorSpace = EColorSpace.Auto,
            };
            OpenVR.Overlay?.SetOverlayTexture(_overlayHandle, ref vrTex);
            lock (_d3dLock) { if (_d3dContext != null) _d3dContext.Flush(); }
        }

        private void CaptureAndSave()
        {
            try
            {
                if (_d3dDevice == null || _d3dContext == null || OpenVR.Compositor == null)
                {
                    _log("[FrameShot] Capture skipped: no compositor/device");
                    return;
                }
                if (!EnsureMirrorPipeline()) return;
                Thread.Sleep(80);

                var corners = ProjectFrameCorners(_mirrorW, _mirrorH);
                if (corners == null) return;
                var tl = corners[0]; var tr = corners[1]; var br = corners[2]; var bl = corners[3];

                float topLen   = Distance(tl, tr);
                float leftLen  = Distance(tl, bl);
                int outW = Math.Max(2, (int)Math.Round(Math.Max(topLen, leftLen * _lastFrameWidth  / Math.Max(0.001f, _lastFrameHeight))));
                int outH = Math.Max(2, (int)Math.Round(outW * _lastFrameHeight / Math.Max(0.001f, _lastFrameWidth)));

                Bitmap? mirrorBmp = null;
                lock (_d3dLock)
                {
                    if (_d3dContext == null || _mirrorStaging == null || _mirrorTexCached == null) return;
                    _d3dContext.CopyResource(_mirrorStaging, _mirrorTexCached);
                    var box = _d3dContext.Map(_mirrorStaging, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None);
                    try
                    {
                        mirrorBmp = new Bitmap(_mirrorW, _mirrorH, PixelFormat.Format32bppArgb);
                        var rect = new Rectangle(0, 0, _mirrorW, _mirrorH);
                        var bData = mirrorBmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                        try
                        {
                            var fmtName = _mirrorSrvFormat.ToString();
                            bool swapRB = !fmtName.StartsWith("B8G8R8A8", StringComparison.Ordinal);
                            var rowBuf = new byte[_mirrorW * 4];
                            for (int y = 0; y < _mirrorH; y++)
                            {
                                Marshal.Copy(box.DataPointer + (nint)((long)y * box.RowPitch), rowBuf, 0, _mirrorW * 4);
                                if (swapRB)
                                {
                                    for (int x = 0; x < _mirrorW; x++)
                                    {
                                        byte r = rowBuf[x * 4 + 0];
                                        byte b = rowBuf[x * 4 + 2];
                                        rowBuf[x * 4 + 0] = b;
                                        rowBuf[x * 4 + 2] = r;
                                        rowBuf[x * 4 + 3] = 255;
                                    }
                                }
                                else
                                {
                                    for (int x = 0; x < _mirrorW; x++) rowBuf[x * 4 + 3] = 255;
                                }
                                Marshal.Copy(rowBuf, 0, bData.Scan0 + (nint)(y * bData.Stride), _mirrorW * 4);
                            }
                        }
                        finally { mirrorBmp.UnlockBits(bData); }
                    }
                    finally { _d3dContext.Unmap(_mirrorStaging, 0); }
                }

                if (mirrorBmp == null) return;

                using var outBmp = new Bitmap(outW, outH, PixelFormat.Format32bppArgb);
                using (var g = Graphics.FromImage(outBmp))
                {
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode   = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                    var destRect = new RectangleF(0, 0, outW, outH);
                    var srcQuad  = new[] { tl, tr, bl };
                    var mtx = new System.Drawing.Drawing2D.Matrix(destRect, srcQuad);
                    mtx.Invert();
                    g.Transform = mtx;
                    g.DrawImage(mirrorBmp, 0, 0);
                    mtx.Dispose();
                }
                mirrorBmp.Dispose();

                try { Directory.CreateDirectory(OutputDir); } catch { }
                var filename = $"{DateTime.Now:yyyy-MM-dd_HH-mm-ss}.png";
                var path = Path.Combine(OutputDir, filename);
                outBmp.Save(path, ImageFormat.Png);
                _log($"[FrameShot] Saved {path} ({outW}x{outH})");
                try { OnPhotoSaved?.Invoke(path); } catch { }
            }
            catch (Exception ex)
            {
                _log($"[FrameShot] Capture failed: {ex.Message}");
            }
        }

        private static float Distance(PointF a, PointF b)
        {
            float dx = a.X - b.X, dy = a.Y - b.Y;
            return MathF.Sqrt(dx * dx + dy * dy);
        }

        private bool EnsureMirrorPipeline()
        {
            if (_mirrorStaging != null && _mirrorTexCached != null && _mirrorSrvObj != null)
                return true;
            if (_d3dDevice == null || OpenVR.Compositor == null) return false;

            var srv = IntPtr.Zero;
            var cErr = OpenVR.Compositor.GetMirrorTextureD3D11(EVREye.Eye_Left, _d3dDevice.NativePointer, ref srv);
            if (cErr != EVRCompositorError.None || srv == IntPtr.Zero)
            {
                _log($"[FrameShot] GetMirrorTextureD3D11 failed: {cErr}");
                return false;
            }
            _mirrorSrv = srv;
            _mirrorSrvObj = new ID3D11ShaderResourceView(srv);
            _mirrorSrvFormat = _mirrorSrvObj.Description.Format; // typed
            var resource = _mirrorSrvObj.Resource;
            _mirrorTexCached = resource.QueryInterface<ID3D11Texture2D>();
            var desc = _mirrorTexCached.Description;
            _mirrorW = (int)desc.Width;
            _mirrorH = (int)desc.Height;
            _mirrorTexFormat = desc.Format;

            _mirrorStaging = _d3dDevice.CreateTexture2D(new Texture2DDescription
            {
                Width = (uint)_mirrorW, Height = (uint)_mirrorH, MipLevels = 1, ArraySize = 1,
                Format = desc.Format,
                SampleDescription = new SampleDescription(1, 0),
                Usage = ResourceUsage.Staging,
                CPUAccessFlags = CpuAccessFlags.Read,
            });

            _log($"[FrameShot] Mirror pipeline ready {_mirrorW}x{_mirrorH} texFmt={_mirrorTexFormat} srvFmt={_mirrorSrvFormat}");
            return true;
        }


        private PointF[]? ProjectFrameCorners(int mw, int mh)
        {
            uint hmdIdx = (uint)OpenVR.k_unTrackedDeviceIndex_Hmd;
            if (_vrSystem == null) return null;
            var hmdM = _poses[hmdIdx].mDeviceToAbsoluteTracking;
            var hmdRot = RotFromMatrix(hmdM);

            var eyeToHead = _vrSystem.GetEyeToHeadTransform(EVREye.Eye_Left);
            var hmdWorld = ToMatrix4x4(hmdM);
            var eyeOffset = ToMatrix4x4(eyeToHead);
            var eyeWorld = eyeOffset * hmdWorld;
            Matrix4x4.Invert(eyeWorld, out var view);
            var proj = ToMatrix4x4Proj(_vrSystem.GetProjectionMatrix(EVREye.Eye_Left, 0.05f, 50f));
            var vp = view * proj;

            Vector3 hmdRight, hmdUp, hmdFwd;
            if (UseHmdRotations)
            {
                hmdRight = Vector3.Transform(Vector3.UnitX,  hmdRot);
                hmdUp    = Vector3.Transform(Vector3.UnitY,  hmdRot);
                hmdFwd   = Vector3.Transform(-Vector3.UnitZ, hmdRot);
            }
            else
            {
                hmdFwd = Vector3.Transform(-Vector3.UnitZ, hmdRot);
                Vector3 right = Vector3.Cross(hmdFwd, Vector3.UnitY);
                if (right.LengthSquared() < 1e-6f) right = Vector3.Transform(Vector3.UnitX, hmdRot);
                hmdRight = Vector3.Normalize(right);
                hmdUp    = Vector3.Normalize(Vector3.Cross(hmdRight, hmdFwd));
            }
            Vector3 center   = (_lastLeftPos + _lastRightPos) * 0.5f;
            float halfW = _lastFrameWidth  * 0.5f;
            float halfH = _lastFrameHeight * 0.5f;

            Vector3[] worldCorners =
            {
                center - hmdRight * halfW + hmdUp * halfH, // TL
                center + hmdRight * halfW + hmdUp * halfH, // TR
                center + hmdRight * halfW - hmdUp * halfH, // BR
                center - hmdRight * halfW - hmdUp * halfH, // BL
            };

            var pts = new PointF[4];
            for (int i = 0; i < 4; i++)
            {
                var clip = Vector4.Transform(new Vector4(worldCorners[i], 1f), vp);
                if (clip.W <= 0) return null;
                float ndcX = clip.X / clip.W;
                float ndcY = clip.Y / clip.W;
                pts[i] = new PointF((ndcX * 0.5f + 0.5f) * mw, (1f - (ndcY * 0.5f + 0.5f)) * mh);
            }
            return pts;
        }

        private static Matrix4x4 ToMatrix4x4(in HmdMatrix34_t m) => new(
            m.m0, m.m4, m.m8,  0,
            m.m1, m.m5, m.m9,  0,
            m.m2, m.m6, m.m10, 0,
            m.m3, m.m7, m.m11, 1);

        private static Matrix4x4 ToMatrix4x4Proj(in HmdMatrix44_t m) => new(
            m.m0,  m.m4,  m.m8,  m.m12,
            m.m1,  m.m5,  m.m9,  m.m13,
            m.m2,  m.m6,  m.m10, m.m14,
            m.m3,  m.m7,  m.m11, m.m15);

        private void EmitState()
        {
            OnStateUpdate?.Invoke(new
            {
                connected      = IsConnected,
                framing        = IsFraming,
                leftController = _leftIdx  != OpenVR.k_unTrackedDeviceIndexInvalid,
                rightController = _rightIdx != OpenVR.k_unTrackedDeviceIndexInvalid,
                error = (string?)null,
            });
        }

        private void StartVrserverMonitor(CancellationToken ct)
        {
            var procs = System.Diagnostics.Process.GetProcessesByName("vrserver");
            if (procs.Length == 0) return;
            var proc = procs[0];
            for (int i = 1; i < procs.Length; i++) procs[i].Dispose();
            _ = Task.Run(async () =>
            {
                try
                {
                    await proc.WaitForExitAsync(ct);
                    if (!ct.IsCancellationRequested && _vrSystem != null)
                    {
                        _log("[FrameShot] vrserver.exe exited — nulling OpenVR interface");
                        _vrSystem = null;
                        _cts?.Cancel();
                        _ = Task.Run(() => OnVRQuit?.Invoke());
                    }
                }
                catch { }
                finally { proc.Dispose(); }
            }, CancellationToken.None);
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            Disconnect();
            _cts?.Dispose();
        }
    }
}
#endif
