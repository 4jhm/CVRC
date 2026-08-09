using System.Reflection;
using Photino.NET;
using TranslationEditor;

namespace TranslationEditor;

static class Program
{
    [STAThread]
    static void Main()
    {
        var wwwroot = ExtractWwwroot();

        Translator? backend = null;

        var win = new PhotinoWindow()
            .SetTitle("VRCNext – Translation Editor")
            .SetSize(1440, 900)
            .SetMinSize(960, 600)
            .Center()
            .SetResizable(true)
            .RegisterWebMessageReceivedHandler((_, msg) => backend?.Handle(msg));

        backend = new Translator(win, wwwroot);

        win.Load(Path.Combine(wwwroot, "index.html"));
        win.WaitForClose();
    }

    static string ExtractWwwroot()
    {
        var dir = Path.Combine(Path.GetTempPath(), "VRCNextTranslator", "wwwroot");
        Directory.CreateDirectory(dir);

        const string prefix = "TranslationEditor.wwwroot.";
        var asm = Assembly.GetExecutingAssembly();

        foreach (var name in asm.GetManifestResourceNames())
        {
            if (!name.StartsWith(prefix)) continue;
            var rel  = name[prefix.Length..];
            var dest = Path.Combine(dir, rel);
            using var src = asm.GetManifestResourceStream(name)!;
            using var dst = File.Create(dest);
            src.CopyTo(dst);
        }

        return dir;
    }
}
