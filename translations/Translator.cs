using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Photino.NET;

namespace TranslationEditor;

public sealed class Translator
{
    private readonly PhotinoWindow _win;
    private readonly string _wwwroot;

    public Translator(PhotinoWindow win, string wwwroot) { _win = win; _wwwroot = wwwroot; }


    public void Handle(string raw)
    {
        try
        {
            var msg = JObject.Parse(raw);
            switch (msg["type"]?.ToString())
            {
                case "ready":            SendEnData();         break;
                case "load_translation": OpenTranslation();    break;
                case "save":             SaveTranslation(msg); break;
            }
        }
        catch (Exception ex)
        {
            Send(new { type = "error", message = ex.Message });
        }
    }


    private void SendEnData()
    {
        var path = Path.Combine(_wwwroot, "en.json");
        if (!File.Exists(path))
        {
            Send(new { type = "error", message = $"en.json not found at: {path}" });
            return;
        }

        var data = JObject.Parse(File.ReadAllText(path));
        Send(new { type = "en_data", data });
    }


    private void OpenTranslation()
    {
        _win.Invoke(() =>
        {
            using var dlg = new OpenFileDialog
            {
                Title  = "Load Translation File",
                Filter = "JSON files (*.json)|*.json|All files (*.*)|*.*",
            };
            if (dlg.ShowDialog() != DialogResult.OK) return;

            try
            {
                var data = JObject.Parse(File.ReadAllText(dlg.FileName));
                Send(new { type = "translation_loaded", data, filename = Path.GetFileName(dlg.FileName) });
            }
            catch
            {
                Send(new { type = "error", message = $"Failed to parse {Path.GetFileName(dlg.FileName)}" });
            }
        });
    }


    private void SaveTranslation(JObject msg)
    {
        var data = (msg["data"] as JObject) ?? new JObject();
        var meta = (msg["meta"] as JObject) ?? new JObject();
        var code = meta["_code"]?.ToString();
        var suggested = string.IsNullOrWhiteSpace(code) ? "translation.json" : $"{code}.json";

        _win.Invoke(() =>
        {
            using var dlg = new SaveFileDialog
            {
                Title    = "Save Translation File",
                Filter   = "JSON files (*.json)|*.json",
                FileName = suggested,
            };
            if (dlg.ShowDialog() != DialogResult.OK) return;

            var final = new JObject();
            foreach (var prop in meta)   final[prop.Key] = prop.Value;
            foreach (var prop in data)   final[prop.Key] = prop.Value;
            final["_generated"] = DateTime.UtcNow.ToString("o");

            File.WriteAllText(dlg.FileName, JsonConvert.SerializeObject(final, Formatting.Indented));
            Send(new { type = "save_ok", filename = Path.GetFileName(dlg.FileName) });
        });
    }


    private void Send(object obj)
    {
        var json = JsonConvert.SerializeObject(obj);
        _win.Invoke(() => _win.SendWebMessage(json));
    }
}
