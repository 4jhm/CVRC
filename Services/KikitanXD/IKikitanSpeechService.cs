using System;

namespace VRCNext.Services.KikitanXD;

public interface IKikitanSpeechService : IDisposable
{
    event Action<string, bool>? OnRecognized;
    event Action<string>? OnTranslated;
    event Action<string>? OnOutput;
    event Action<string>? OnLog;
    event Action? OnChatboxSent;

    bool IsRunning { get; }
    float MeterLevel { get; }

    void Start(int deviceIndex, KikitanXDSettings settings);
    void UpdateSettings(KikitanXDSettings settings);
    void Stop();
}
