import type { EventFormat, EventKind, EventTopic } from "../../../config/events";

/** One event as an adapter hands it over, already in our shape (D435). */
export type RawEvent = {
  externalId: string;
  title: string;
  description: string;
  /** ISO timestamps. Date-only sources send whole UTC days with allDay. */
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timeZone: string | null;
  format: EventFormat;
  /** ISO 3166-1 alpha-2 or null. */
  country: string | null;
  city: string | null;
  url: string;
  cfpUrl: string | null;
  cfpEndsAt: string | null;
  topics: EventTopic[];
  kind: EventKind;
};

/**
 * An event feed: official open data with a licence that allows reuse, and
 * a link back to the organizer. Scraping HTML is not allowed (D18).
 */
export interface EventSource {
  readonly sourceName: string;
  /** Where the data comes from, for the admin panel and the attribution. */
  readonly url: string;
  /** The page credited on every event, e.g. the project's site. */
  readonly attributionUrl: string;
  readonly minIntervalMs: number;
  fetch(now: Date, fetchImpl?: typeof fetch): Promise<RawEvent[]>;
}
