using System.Globalization;

namespace VRCNext.Services.Helpers;

public static class DateTimeHelper
{
    public static string ShortDatePattern => CultureInfo.CurrentCulture.DateTimeFormat.ShortDatePattern;

    public static bool Is24Hour =>
        !CultureInfo.CurrentCulture.DateTimeFormat.ShortTimePattern.Contains("tt");

    public static string FormatDate(DateTime dt) => dt.ToString("d", CultureInfo.CurrentCulture);

    public static string FormatTime(DateTime dt) => dt.ToString("t", CultureInfo.CurrentCulture);

    public static string FormatTimeWithSeconds(DateTime dt) => dt.ToString("T", CultureInfo.CurrentCulture);

    public static string FormatDateTime(DateTime dt) => dt.ToString("g", CultureInfo.CurrentCulture);
}
