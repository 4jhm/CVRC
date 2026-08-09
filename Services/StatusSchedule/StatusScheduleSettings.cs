using Newtonsoft.Json;

namespace VRCNext.Services;

// Status Schedule persistence - stored separately from main settings.
// Holds time-window rules that switch the VRChat status automatically.
public class StatusScheduleSettings
{
    public bool Enabled { get; set; } = true;
    public List<StatusRule> Rules { get; set; } = new();

    public class StatusRule
    {
        public string Id       { get; set; } = "";
        public string Name     { get; set; } = "";
        public bool   Enabled  { get; set; } = true;
        // 700 = high, 400 = medium, 100 = low. Highest match wins.
        public int    Priority { get; set; } = 400;

        // "HH:mm" 24h. Start > End means the window crosses midnight.
        public string Start    { get; set; } = "09:00";
        public string End      { get; set; } = "17:00";
        // ISO-8601 weekdays: 1 = Monday .. 7 = Sunday. Empty = every day.
        public List<int> Days  { get; set; } = new();

        // Mutually exclusive: at most one may be true. Both false means the rule applies
        // regardless of whether VRChat is running.
        public bool OnlyWhileInGame      { get; set; } = false;
        public bool OnlyWhileOutsideGame { get; set; } = false;
        public bool RestorePreviousStatus { get; set; } = true;

        // "join me" | "active" | "ask me" | "busy"
        public string Status            { get; set; } = "active";
        public bool   SetStatusMessage  { get; set; } = false;
        public string StatusMessage     { get; set; } = "";
    }

    private static string SavePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "VRCNext", "statusschedule_settings.json");

    [JsonIgnore] public string? LastSaveError { get; set; }

    public static StatusScheduleSettings Load()
    {
        try
        {
            if (File.Exists(SavePath))
            {
                var json = File.ReadAllText(SavePath);
                return JsonConvert.DeserializeObject<StatusScheduleSettings>(json) ?? new();
            }
        }
        catch { }
        return new();
    }

    public void Save()
    {
        try
        {
            var dir = Path.GetDirectoryName(SavePath)!;
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            File.WriteAllText(SavePath, JsonConvert.SerializeObject(this, Formatting.Indented));
            LastSaveError = null;
        }
        catch (Exception ex) { LastSaveError = ex.Message; }
    }
}
