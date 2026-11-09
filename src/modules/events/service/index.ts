/**
 * Public service surface of the events aggregator (D435).
 * Other modules may import only this file, never this module's repo.
 */
export {
  findEventsForPerson,
  getEventBySlug,
  listEventCountries,
  listEventSitemapEntries,
  isMissingEventsTable,
  searchEvents,
  toPublicEvent,
} from "./queries";
export type { PublicEvent } from "./queries";
export { EVENT_SOURCES, runEventImports } from "./import";
export type { EventImportReport, EventImportResult } from "./import";
export {
  BOT_EVENTS_LIMIT,
  EVENTS_PAGE_SIZE,
  filterForPerson,
  filterFromQuery,
  formatsFor,
} from "./filter";
export type { EventFilter } from "./filter";
export { eventSearchQuery, parseEventSearch } from "../schemas/search";
export type { EventSearchQuery } from "../schemas/search";
export { eventJsonLd } from "./json-ld";
export { eventDateRange } from "./format";
