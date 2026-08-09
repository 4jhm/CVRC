using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace VRCNext.Services;

// Action Flow persistence - stored separately from main settings.
// Holds a list of named Flows with serialized Blockly workspace state.
public class ActionFlowSettings
{
    public List<ActionFlow> Flows { get; set; } = new();
    // Named boolean conditions used by af_get_condition / af_set_condition blocks.
    // Persisted across restarts so "run only once" style flags survive.
    public Dictionary<string, bool> Conditions { get; set; } = new();
    // Initial value captured the first time each condition was written. Shown in
    // the toolbox sidebar so the user can see "default vs current" at a glance.
    public Dictionary<string, bool> ConditionDefaults { get; set; } = new();

    public class ActionFlow
    {
        public string Id          { get; set; } = "";
        public string Name        { get; set; } = "";
        public bool   Enabled     { get; set; } = false;
        // Serialized Blockly workspace (JSON-serializable JS object).
        public JToken? Workspace  { get; set; }
        public long   CreatedAt   { get; set; }
        public long   UpdatedAt   { get; set; }
    }

    private static string SavePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "VRCNext", "actionflow_settings.json");

    [Newtonsoft.Json.JsonIgnore] public string? LastSaveError { get; set; }

    public static ActionFlowSettings Load()
    {
        try
        {
            if (File.Exists(SavePath))
            {
                var json = File.ReadAllText(SavePath);
                return JsonConvert.DeserializeObject<ActionFlowSettings>(json) ?? new();
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
