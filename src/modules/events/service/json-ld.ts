import { isoDay } from "./format";

const ATTENDANCE: Record<string, string> = {
  online: "https://schema.org/OnlineEventAttendanceMode",
  offline: "https://schema.org/OfflineEventAttendanceMode",
  hybrid: "https://schema.org/MixedEventAttendanceMode",
};

/**
 * schema.org Event for one event page (D435). Pure. Only facts the page
 * shows; the organizer's own page is the event url, our page is the id.
 */
export function eventJsonLd(
  event: {
    title: string;
    description: string;
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
    format: string;
    country: string | null;
    city: string | null;
    url: string;
  },
  pageUrl: string,
  summary: string,
) {
  const date = (value: Date) =>
    event.allDay ? isoDay(value) : value.toISOString();
  const place =
    event.city || event.country
      ? {
          "@type": "Place",
          name: [event.city, event.country].filter(Boolean).join(", "),
          address: {
            "@type": "PostalAddress",
            ...(event.city ? { addressLocality: event.city } : {}),
            ...(event.country ? { addressCountry: event.country } : {}),
          },
        }
      : null;
  const virtual = { "@type": "VirtualLocation", url: event.url };
  const location =
    event.format === "online"
      ? virtual
      : event.format === "hybrid" && place
        ? [place, virtual]
        : (place ?? virtual);
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    "@id": pageUrl,
    name: event.title,
    description: (event.description || summary).slice(0, 500),
    startDate: date(event.startsAt),
    endDate: date(event.endsAt),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: ATTENDANCE[event.format] ?? ATTENDANCE.offline,
    location,
    url: event.url,
  };
}
