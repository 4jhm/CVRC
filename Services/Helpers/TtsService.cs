using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace VRCNext.Services.Helpers;

public static class TtsService
{
    public const string EngineSapi = "sapi";
    public const string EngineEdge = "edge";

    public static Action<string>? Log;

    private static readonly SemaphoreSlim _gate = new(1, 1);

    private static readonly object _previewLock = new();
    private static CancellationTokenSource? _previewCts;
    private static IDisposable? _previewOut;

    public static string[] GetSapiVoices()
    {
#if WINDOWS
        try
        {
            using var synth = new System.Speech.Synthesis.SpeechSynthesizer();
            return synth.GetInstalledVoices()
                .Where(v => v.Enabled)
                .Select(v => v.VoiceInfo.Name)
                .ToArray();
        }
        catch (Exception ex) { Log?.Invoke($"[TTS] Voice list failed: {ex.Message}"); }
#endif
        return Array.Empty<string>();
    }

    /// <summary>Voice entries for the UI: id is what gets stored, label is what the user sees.</summary>
    public static async Task<List<object>> GetVoicesAsync(string engine)
    {
        if (string.Equals(engine, EngineEdge, StringComparison.OrdinalIgnoreCase))
        {
            var list = await EdgeTtsService.GetVoicesAsync();
            return list
                .Select(v => new
                {
                    id         = v["ShortName"]?.ToString() ?? "",
                    label      = BuildEdgeLabel(v),
                    locale     = v["Locale"]?.ToString() ?? "",
                    localeName = BuildLocaleName(v),
                    gender     = v["Gender"]?.ToString() ?? "",
                })
                .Where(v => !string.IsNullOrEmpty(v.id))
                .OrderBy(v => v.localeName, StringComparer.CurrentCultureIgnoreCase)
                .ThenBy(v => v.label, StringComparer.OrdinalIgnoreCase)
                .Cast<object>()
                .ToList();
        }

        return GetSapiVoices()
            .Select(n => (object)new { id = n, label = n, locale = "", localeName = "", gender = "" })
            .ToList();
    }

    private static string BuildLocaleName(Newtonsoft.Json.Linq.JObject v)
    {
        var friendly = v["FriendlyName"]?.ToString() ?? "";
        int dash = friendly.LastIndexOf(" - ", StringComparison.Ordinal);
        if (dash >= 0) return friendly[(dash + 3)..].Trim();
        return v["Locale"]?.ToString() ?? "";
    }

    private static string BuildEdgeLabel(Newtonsoft.Json.Linq.JObject v)
    {
        var name = v["ShortName"]?.ToString() ?? "";
        var parts = name.Split('-');
        return parts.Length >= 3 ? parts[2].Replace("Neural", "") : name;
    }

    /// <summary>
    /// Speaks a line. Calls are serialized so overlapping messages queue up
    /// instead of cutting each other off.
    /// </summary>
    public static void Speak(string text, string engine, string voice, AudioSelection device, int volume, int rate)
    {
        if (string.IsNullOrWhiteSpace(text)) return;
#if WINDOWS
        _ = Task.Run(async () =>
        {
            if (!await _gate.WaitAsync(TimeSpan.FromSeconds(30)))
            {
                Log?.Invoke("[TTS] Still busy with the previous line, skipping this one.");
                return;
            }
            try { await SpeakOnceAsync(text, engine, voice, device, volume, rate, CancellationToken.None); }
            catch (Exception ex) { Log?.Invoke($"[TTS] {ex.Message}"); }
            finally { _gate.Release(); }
        });
#endif
    }

    /// <summary>
    /// Plays a short sample. Unlike Speak this never queues: a new preview
    /// replaces the running one, so hovering down a voice list stays responsive.
    /// </summary>
    public static void Preview(string text, string engine, string voice, AudioSelection device, int rate)
    {
        if (string.IsNullOrWhiteSpace(text)) return;
#if WINDOWS
        CancellationTokenSource cts;
        lock (_previewLock)
        {
            _previewCts?.Cancel();
            try { _previewOut?.Dispose(); } catch { }
            _previewOut = null;
            _previewCts = cts = new CancellationTokenSource();
        }
        _ = Task.Run(async () =>
        {
            try { await SpeakOnceAsync(text, engine, voice, device, 100, rate, cts.Token, isPreview: true); }
            catch (OperationCanceledException) { }
            catch (Exception ex) { Log?.Invoke($"[TTS] Preview: {ex.Message}"); }
        });
#endif
    }

#if WINDOWS
    private static async Task SpeakOnceAsync(string text, string engine, string voice, AudioSelection device,
                                             int volume, int rate, CancellationToken ct, bool isPreview = false)
    {
        if (string.Equals(engine, EngineEdge, StringComparison.OrdinalIgnoreCase))
        {
            byte[] mp3;
            try { mp3 = await EdgeTtsService.SynthesizeAsync(text, voice, rate, ct); }
            catch (Exception ex)
            {
                Log?.Invoke($"[TTS] Edge synthesis failed ({ex.Message}), falling back to SAPI.");
                SpeakSapi(text, "", device, volume, rate, ct, isPreview);
                return;
            }
            if (mp3.Length == 0)
            {
                Log?.Invoke("[TTS] Edge returned no audio, falling back to SAPI.");
                SpeakSapi(text, "", device, volume, rate, ct, isPreview);
                return;
            }
            using var src = new MemoryStream(mp3);
            using var reader = new NAudio.Wave.Mp3FileReader(src);
            Play(reader, device, ct, isPreview);
            return;
        }

        SpeakSapi(text, voice, device, volume, rate, ct, isPreview);
    }

    private static void SpeakSapi(string text, string voice, AudioSelection device, int volume, int rate,
                                  CancellationToken ct, bool isPreview)
    {
        using var ms = new MemoryStream();
        using (var synth = new System.Speech.Synthesis.SpeechSynthesizer())
        {
            if (!string.IsNullOrWhiteSpace(voice))
            {
                try { synth.SelectVoice(voice); }
                catch (Exception ex) { Log?.Invoke($"[TTS] Voice '{voice}' unavailable ({ex.Message}), using default."); }
            }
            synth.Volume = Math.Clamp(volume, 0, 100);
            synth.Rate = Math.Clamp(rate, -10, 10);
            synth.SetOutputToWaveStream(ms);
            synth.Speak(text);
        }
        if (ms.Length == 0)
        {
            Log?.Invoke("[TTS] SAPI produced no audio — no speech voice is installed on this system.");
            return;
        }
        ms.Position = 0;
        using var reader = new NAudio.Wave.WaveFileReader(ms);
        Play(reader, device, ct, isPreview);
    }

    private static void Play(NAudio.Wave.WaveStream reader, AudioSelection device, CancellationToken ct, bool isPreview)
    {
        var devIdx = AudioDeviceManager.ResolveOutputIndex(device);
        if (devIdx == null)
        {
            Log?.Invoke($"[TTS] Output '{device.DisplayName}' unavailable, staying silent (selection kept).");
            return;
        }
        var waveOut = new NAudio.Wave.WaveOut { DeviceNumber = devIdx.Value };
        using var done = new ManualResetEventSlim(false);
        waveOut.PlaybackStopped += (_, __) => done.Set();
        waveOut.Init(reader);
        waveOut.Play();

        if (isPreview)
        {
            lock (_previewLock) _previewOut = waveOut;
        }

        var limit = reader.TotalTime + TimeSpan.FromSeconds(10);
        var sw    = System.Diagnostics.Stopwatch.StartNew();

        try
        {
            while (!done.IsSet)
            {
                if (ct.IsCancellationRequested) { try { waveOut.Stop(); } catch { } break; }
                if (sw.Elapsed > limit)
                {
                    Log?.Invoke("[TTS] Playback did not signal completion, forcing stop.");
                    try { waveOut.Stop(); } catch { }
                    break;
                }
                done.Wait(80);
            }
        }
        finally
        {
            if (isPreview)
            {
                lock (_previewLock) { if (ReferenceEquals(_previewOut, waveOut)) _previewOut = null; }
            }
            try { waveOut.Dispose(); } catch { }
        }
    }
#endif
}
