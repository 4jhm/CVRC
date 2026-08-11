using Newtonsoft.Json;

namespace VRCNext.Services;

// Status Schedule persistence
public class StatusScheduleSettings
{
    public bool Enabled { get; set; } = true;
    public List<StatusRule> Rules { get; set; } = new();

    public class StatusRule
    {
        public string Id       { get; set; } = "";
        public string Name     { get; set; } = "";
        public bool   Enabled  { get; set; } = true;
        public int    Priority { get; set; } = 400;
        public string Start    { get; set; } = "09:00";
        public string End      { get; set; } = "17:00";
        public List<int> Days  { get; set; } = new();

        public bool OnlyWhileInGame      { get; set; } = false;
        public bool OnlyWhileOutsideGame { get; set; } = false;

        public List<string> InstanceTypes { get; set; } = new();
        public int          MinPlayers    { get; set; } = 0;
        public List<string> FriendIds     { get; set; } = new();
        public bool         FriendsRequireAll { get; set; } = false;
        public bool RestorePreviousStatus { get; set; } = true;
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
