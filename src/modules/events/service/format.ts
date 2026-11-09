/**
 * Dates of an event for people. Date-only events are whole UTC days, so they
 * are shown in UTC and never slide to the day before (D435).
 */
export function eventDateRange(
  event: {
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
    timeZone: string | null;
  },
  intlLocale: string,
): string {
  if (event.allDay) {
    const format = new Intl.DateTimeFormat(intlLocale, {
      dateStyle: "medium",
      timeZone: "UTC",
    });
    const sameDay =
      event.startsAt.toISOString().slice(0, 10) ===
      event.endsAt.toISOString().slice(0, 10);
    return sameDay
      ? format.format(event.startsAt)
      : format.formatRange(event.startsAt, event.endsAt);
  }
  const timeZone = event.timeZone ?? "UTC";
  const format = new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  return `${format.formatRange(event.startsAt, event.endsAt)} (${timeZone})`;
}

/** The day an all-day date stands for, as YYYY-MM-DD. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
