import type { EventFormat, EventKind, EventTopic } from "../../../config/events";
import type { EventSearchQuery } from "../schemas/search";

export const EVENTS_PAGE_SIZE = 24;
export const BOT_EVENTS_LIMIT = 5;

/** What the repo filters on. Built here so the rules are testable (D435). */
export type EventFilter = {
  topics: EventTopic[];
  kinds: EventKind[];
  formats: EventFormat[];
  country: string | null;
  /** With a country: that country, or anything one can join remotely. */
  orRemote: boolean;
  q: string | null;
  /** Events still running at this moment or later. */
  from: Date;
  /** Events starting on or before this moment. */
  to: Date | null;
  limit: number;
  offset: number;
};

/** Online means "I can join from home": hybrid counts too. */
export function formatsFor(format: EventFormat | undefined): EventFormat[] {
  if (format === "online") return ["online", "hybrid"];
  if (format === "offline") return ["offline", "hybrid"];
  if (format === "hybrid") return ["hybrid"];
  return [];
}

/** The page query into a filter. Past events never show (D435). */
export function filterFromQuery(
  query: EventSearchQuery,
  now: Date,
): EventFilter {
  const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : now;
  return {
    topics: query.topic ? [query.topic] : [],
    kinds: query.kind ? [query.kind] : [],
    formats: formatsFor(query.format),
    country: query.country ?? null,
    orRemote: false,
    q: query.q?.trim() || null,
    from: from < now ? now : from,
    to: query.to ? new Date(`${query.to}T23:59:59.999Z`) : null,
    limit: EVENTS_PAGE_SIZE,
    offset: (query.page - 1) * EVENTS_PAGE_SIZE,
  };
}

/**
 * Spoki's search for one person (D435): their topics, and their country or
 * events they can join remotely. A remote-first person without a country
 * gets online and hybrid events only.
 */
export function filterForPerson(
  input: {
    topics?: readonly EventTopic[];
    kind?: EventKind;
    country?: string | null;
    remote?: boolean;
    withinDays?: number;
    limit?: number;
  },
  now: Date,
): EventFilter {
  const country = input.country?.trim().toUpperCase() || null;
  const remote = input.remote ?? !country;
  return {
    topics: [...new Set(input.topics ?? [])],
    kinds: input.kind ? [input.kind] : [],
    formats: country ? [] : remote ? formatsFor("online") : [],
    country,
    orRemote: Boolean(country) && remote,
    q: null,
    from: now,
    to: new Date(now.getTime() + (input.withinDays ?? 120) * 86_400_000),
    limit: Math.min(Math.max(input.limit ?? BOT_EVENTS_LIMIT, 1), 10),
    offset: 0,
  };
}
