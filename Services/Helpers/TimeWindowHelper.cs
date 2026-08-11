namespace VRCNext.Services.Helpers;

public static class TimeWindowHelper
{
    public static bool IsWithin(string start, string end, List<int>? days, DateTime now)
    {
        if (!TimeSpan.TryParse(start, out var from)) return false;
        if (!TimeSpan.TryParse(end, out var to)) return false;

        var timeOfDay = now.TimeOfDay;
        var crossesMidnight = to <= from;

        bool DayAllowed(int isoDay) => days == null || days.Count == 0 || days.Contains(isoDay);

        if (!crossesMidnight)
            return timeOfDay >= from && timeOfDay < to && DayAllowed(Iso(now.DayOfWeek));

        if (timeOfDay >= from) return DayAllowed(Iso(now.DayOfWeek));
        if (timeOfDay < to)    return DayAllowed(Iso(now.AddDays(-1).DayOfWeek));
        return false;
    }

    public static int Iso(DayOfWeek d) => d == DayOfWeek.Sunday ? 7 : (int)d;
}
