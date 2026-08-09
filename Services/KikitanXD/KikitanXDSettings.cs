using System.Collections.Generic;
using Newtonsoft.Json;

namespace VRCNext.Services.KikitanXD;

public class KikitanXDSettings
{
    private static readonly string FilePath = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "VRCNext", "kikitan_xd.json");
    public string ApiKey { get; set; } = "";
    public string GoogleApiKey { get; set; } = "";
    public string Model { get; set; } = "groq";
    public int InputDeviceIndex { get; set; } = 0;
    public string SourceLang { get; set; } = "auto";
    public string TargetLang { get; set; } = "en";
    public bool TranslateEnabled { get; set; } = true;
    public bool OscEnabled { get; set; } = true;
    public bool PartialOsc { get; set; } = false;
    public int NoiseGatePercent { get; set; } = 10;
    public bool ProfileTranslationEnabled { get; set; } = true;
    public string ProfileTargetLang { get; set; } = "en";
    public string Personality { get; set; } = "raw";
    public List<string> BlockedWords { get; set; } = new();
    public List<string> BlockedSentences { get; set; } = new();
    public bool TtsEnabled { get; set; } = false;
    public int TtsDevice { get; set; } = -1;
    public string TtsVoice { get; set; } = "";
    public string TtsEngine { get; set; } = "sapi";
    public int TtsRate { get; set; } = 0;

    public static KikitanXDSettings Load()
    {
        try
        {
            if (System.IO.File.Exists(FilePath))
                return JsonConvert.DeserializeObject<KikitanXDSettings>(
                    System.IO.File.ReadAllText(FilePath)) ?? new();
        }
        catch { }
        return new();
    }

    public void Save()
    {
        try
        {
            System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(FilePath)!);
            System.IO.File.WriteAllText(FilePath, JsonConvert.SerializeObject(this, Formatting.Indented));
        }
        catch { }
    }
}
