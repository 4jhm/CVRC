using System.Security.Cryptography;
using System.Text;

namespace VRCNext.Services.Helpers;

public static class SecretProtector
{
    private const string Prefix     = "v1:";
    private const int    NonceBytes = 12;
    private const int    TagBytes   = 16;
    private const int    KeyBytes   = 32;

    private static readonly object _keyLock = new();
    private static byte[]? _key;

    private static string BaseDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "VRCNext");

    private static string KeyPath => Path.Combine(BaseDir, ".secret.key");

    private static byte[] MachineSalt()
    {
        foreach (var p in new[] { "/etc/machine-id", "/var/lib/dbus/machine-id" })
        {
            try
            {
                if (File.Exists(p))
                {
                    var id = File.ReadAllText(p).Trim();
                    if (id.Length > 0) return SHA256.HashData(Encoding.UTF8.GetBytes(id));
                }
            }
            catch { }
        }
        return SHA256.HashData(Encoding.UTF8.GetBytes(Environment.UserName + "|" + Environment.MachineName));
    }

    private static byte[] GetKey()
    {
        lock (_keyLock)
        {
            if (_key != null) return _key;

            Directory.CreateDirectory(BaseDir);
            byte[] secret;

            if (File.Exists(KeyPath))
            {
                secret = File.ReadAllBytes(KeyPath);
                if (secret.Length != KeyBytes) secret = CreateKeyFile();
            }
            else
            {
                secret = CreateKeyFile();
            }

            _key = HKDF.DeriveKey(HashAlgorithmName.SHA256, secret, KeyBytes,
                                  salt: MachineSalt(), info: Encoding.UTF8.GetBytes("VRCNext.Credentials"));
            return _key;
        }
    }

    private static byte[] CreateKeyFile()
    {
        var secret = RandomNumberGenerator.GetBytes(KeyBytes);
        File.WriteAllBytes(KeyPath, secret);
        RestrictToOwner(KeyPath);
        return secret;
    }

    public static void RestrictToOwner(string path)
    {
        if (OperatingSystem.IsWindows()) return;
        try { File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite); }
        catch (Exception ex) { CrashHandler.WriteEntry("SecretProtector.RestrictToOwner", ex); }
    }

    public static string Protect(string plain)
    {
        if (string.IsNullOrEmpty(plain)) return "";
        try
        {
            var key   = GetKey();
            var nonce = RandomNumberGenerator.GetBytes(NonceBytes);
            var data  = Encoding.UTF8.GetBytes(plain);
            var cipher = new byte[data.Length];
            var tag    = new byte[TagBytes];

            using (var gcm = new AesGcm(key, TagBytes))
                gcm.Encrypt(nonce, data, cipher, tag);

            var blob = new byte[NonceBytes + TagBytes + cipher.Length];
            Buffer.BlockCopy(nonce,  0, blob, 0, NonceBytes);
            Buffer.BlockCopy(tag,    0, blob, NonceBytes, TagBytes);
            Buffer.BlockCopy(cipher, 0, blob, NonceBytes + TagBytes, cipher.Length);
            return Prefix + Convert.ToBase64String(blob);
        }
        catch (Exception ex)
        {
            CrashHandler.WriteEntry("SecretProtector.Protect", ex);
            return "";
        }
    }

    public static string Unprotect(string stored)
    {
        if (string.IsNullOrEmpty(stored)) return "";
        try
        {
            if (!stored.StartsWith(Prefix, StringComparison.Ordinal))
                return Encoding.UTF8.GetString(Convert.FromBase64String(stored));

            var blob = Convert.FromBase64String(stored[Prefix.Length..]);
            if (blob.Length < NonceBytes + TagBytes) return "";

            var nonce  = blob.AsSpan(0, NonceBytes);
            var tag    = blob.AsSpan(NonceBytes, TagBytes);
            var cipher = blob.AsSpan(NonceBytes + TagBytes);
            var plain  = new byte[cipher.Length];

            using (var gcm = new AesGcm(GetKey(), TagBytes))
                gcm.Decrypt(nonce, cipher, tag, plain);

            return Encoding.UTF8.GetString(plain);
        }
        catch { return ""; }
    }
}
