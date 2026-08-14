using NativeFileDialogSharp;
using Newtonsoft.Json.Linq;
using VRCNext.Services;

namespace VRCNext;

// Emoji Maker — the frontend does all sprite-sheet generation client-side (canvas
// compositing of GIF/video frames); this controller only handles the native
// Save-As dialog and writing the resulting PNG to disk.
public class EmojiMakerController
{
    private readonly CoreLibrary _core;

    public EmojiMakerController(CoreLibrary core)
    {
        _core = core;
    }

    public void HandleMessage(string action, JObject msg)
    {
        switch (action)
        {
            case "emojiSaveSheet":
            {
                var dataUrl = msg["data"]?.ToString() ?? "";
                var raw = dataUrl.Contains(",") ? dataUrl.Split(',')[1] : dataUrl;
                if (string.IsNullOrEmpty(raw))
                {
                    _core.SendToJS("log", new { msg = "[EmojiMaker] Nothing to save.", color = "err" });
                    break;
                }

                var rs = Dialog.FileSave("png");
                if (rs.IsOk)
                {
                    try
                    {
                        var bytes = Convert.FromBase64String(raw);
                        File.WriteAllBytes(rs.Path, bytes);
                        _core.SendToJS("log", new { msg = $"[EmojiMaker] Saved: {rs.Path}", color = "ok" });
                        _core.SendToJS("emojiSheetSaved", new { path = rs.Path });
                    }
                    catch (Exception ex)
                    {
                        CrashHandler.WriteEntry("EmojiMakerController.SaveSheet", ex);
                        _core.SendToJS("log", new { msg = $"[EmojiMaker] Save failed: {ex.Message}", color = "err" });
                    }
                }
                break;
            }
        }
    }
}
