using System.Collections.Generic;

namespace VRCNext.Services.KikitanXD;

public enum LocalAiKind { Stt, Vad, Llm, Runtime }

public sealed record LocalAiItem(
    string Id,
    LocalAiKind Kind,
    string Name,
    string Detail,
    long ApproxBytes,
    string Url,
    string RelPath,
    bool IsArchive = false,
    string ArchivePrefix = "",
    string ExtraUrl = "",
    string ExtraPrefix = "",
    string ExtraFile = "");

public static class LocalAiCatalog
{
    private const string Whisper = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";
    private const string Vad     = "https://huggingface.co/ggml-org/whisper-vad/resolve/main/";
    private const string Nuget   = "https://api.nuget.org/v3-flatcontainer/";

    public const string RecDir   = "Rec-Models";
    public const string TransDir = "Trans-Models";
    public const string CoreDir  = "Core";

    public const string WhisperRuntimeVersion = "1.9.1";
    public const string LlamaRuntimeVersion   = "0.27.0";

    public static readonly IReadOnlyList<LocalAiItem> Items = new List<LocalAiItem>
    {
        new("stt-base", LocalAiKind.Stt, "Whisper Base",
            "Fastest, lowest accuracy. Fine for short English phrases.",
            147_951_465, Whisper + "ggml-base.bin", RecDir + "/ggml-base.bin"),

        new("stt-small", LocalAiKind.Stt, "Whisper Small",
            "Good balance of speed and accuracy. Recommended starting point.",
            487_601_967, Whisper + "ggml-small.bin", RecDir + "/ggml-small.bin"),

        new("stt-medium", LocalAiKind.Stt, "Whisper Medium",
            "Noticeably better on accents and noisy mics.",
            1_533_763_059, Whisper + "ggml-medium.bin", RecDir + "/ggml-medium.bin"),

        new("stt-large-v3-turbo", LocalAiKind.Stt, "Whisper Large v3 Turbo",
            "Near large-v3 accuracy at roughly half the compute.",
            1_624_555_275, Whisper + "ggml-large-v3-turbo.bin", RecDir + "/ggml-large-v3-turbo.bin"),

        new("stt-large-v3", LocalAiKind.Stt, "Whisper Large v3",
            "Highest accuracy. Needs a strong GPU and plenty of VRAM.",
            3_095_033_483, Whisper + "ggml-large-v3.bin", RecDir + "/ggml-large-v3.bin"),

        new("vad-silero", LocalAiKind.Vad, "Silero VAD v5",
            "Detects when you are actually speaking so Whisper only runs on real speech.",
            2_216_884, Vad + "ggml-silero-v5.1.2.bin", RecDir + "/ggml-silero-v5.1.2.bin"),

        new("llm-qwen25-1_5b", LocalAiKind.Llm, "Qwen2.5 1.5B Instruct (Q4_K_M)",
            "Smallest option. Usable, but weaker on long or idiomatic sentences.",
            1_120_000_000,
            "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf",
            TransDir + "/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf"),

        new("llm-qwen25-3b", LocalAiKind.Llm, "Qwen2.5 3B Instruct (Q4_K_M)",
            "Practical minimum for good translation quality. Recommended default.",
            2_100_000_000,
            "https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf",
            TransDir + "/Qwen2.5-3B-Instruct-Q4_K_M.gguf"),

        new("llm-qwen25-7b", LocalAiKind.Llm, "Qwen2.5 7B Instruct (Q4_K_M)",
            "Best local quality here. Around 5 GB VRAM, tight next to VRChat in VR.",
            4_680_000_000,
            "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
            TransDir + "/Qwen2.5-7B-Instruct-Q4_K_M.gguf"),

        new("rt-whisper-cpu", LocalAiKind.Runtime, "Whisper Runtime (CPU)",
            "Only needed if you do not use a GPU runtime, or as a fallback if the GPU one fails to load.",
            18_482_556,
            Nuget + $"whisper.net.runtime/{WhisperRuntimeVersion}/whisper.net.runtime.{WhisperRuntimeVersion}.nupkg",
            CoreDir + "/whisper/runtimes/win-x64", true, "build/win-x64/"),

        new("rt-whisper-vulkan", LocalAiKind.Runtime, "Whisper Runtime (GPU, Vulkan)",
            "Runs speech recognition on the graphics card using the normal display driver. No CUDA Toolkit needed, works on NVIDIA, AMD and Intel. Recommended GPU option.",
            36_867_136,
            Nuget + $"whisper.net.runtime.vulkan/{WhisperRuntimeVersion}/whisper.net.runtime.vulkan.{WhisperRuntimeVersion}.nupkg",
            CoreDir + "/whisper/runtimes/vulkan/win-x64", true, "build/win-x64/"),

        new("rt-llama-vulkan", LocalAiKind.Runtime, "Translation Runtime (GPU, Vulkan)",
            "Runs the translation model on the graphics card using the normal display driver. No CUDA Toolkit needed. Recommended GPU option.",
            56_531_239,
            Nuget + $"llamasharp.backend.vulkan.windows/{LlamaRuntimeVersion}/llamasharp.backend.vulkan.windows.{LlamaRuntimeVersion}.nupkg",
            CoreDir + "/llama/vulkan", true, "LLamaSharpRuntimes/win-x64/native/",
            Nuget + $"llamasharp.backend.cpu/{LlamaRuntimeVersion}/llamasharp.backend.cpu.{LlamaRuntimeVersion}.nupkg",
            "LLamaSharpRuntimes/win-x64/native/avx2/", "ggml-cpu.dll"),

        new("rt-llama-cpu", LocalAiKind.Runtime, "Translation Runtime (CPU)",
            "Only needed if you do not use a GPU runtime, or as a fallback if the GPU one fails to load.",
            36_337_071,
            Nuget + $"llamasharp.backend.cpu/{LlamaRuntimeVersion}/llamasharp.backend.cpu.{LlamaRuntimeVersion}.nupkg",
            CoreDir + "/llama/cpu", true, "LLamaSharpRuntimes/win-x64/native/"),
    };

    public static readonly IReadOnlyList<string> ObsoleteDirs = new List<string>
    {
        CoreDir + "/whisper/runtimes/cuda",
        CoreDir + "/llama/cuda",
    };

    public static LocalAiItem? Find(string id)
    {
        foreach (var i in Items) if (i.Id == id) return i;
        return null;
    }
}
