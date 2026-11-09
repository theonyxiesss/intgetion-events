import type { EventTopic } from "../../../config/events";
import { fetchJson, hours } from "@intgetion/ingestion";
import { AI, WEB3, httpUrl, kindOf } from "./confs-tech";
import { countryCode } from "./country";
import type { EventSource, RawEvent } from "./types";

/**
 * CCF deadlines open data: github.com/ccfddl/ccf-deadlines, MIT licence.
 * Academic computer-science conferences (AI, security, data, software…),
 * one JSON file built from the repository. Every event links to the
 * conference's own page; ccfddl is credited.
 */
export const CCFDDL_DATA_URL =
  "https://ccfddl.github.io/conference/allconf.json";
export const CCFDDL_SITE = "https://ccfddl.com";

/** CCF category of a conference series, and the topics it gives an event. */
export const CCFDDL_TOPICS: Record<string, EventTopic[]> = {
  AI: ["ai"],
  CG: ["design"],
  CT: ["dev"],
  DB: ["data"],
  DS: ["devops"],
  HI: ["design"],
  MX: ["dev"],
  NW: ["devops"],
  SC: ["security"],
  SE: ["dev"],
};

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const MONTH = "([a-z]{3,9})\\.?";
/** "June 21-25, 2027", "March 31-April 2, 2027", "June 28 - July 2, 2027". */
const ONE_YEAR = new RegExp(
  `^${MONTH}\\s+(\\d{1,2})(?:\\s*[-–]\\s*(?:${MONTH}\\s+)?(\\d{1,2}))?,?\\s+(\\d{4})$`,
  "i",
);
/** "December 30, 2026 - January 2, 2027". */
const TWO_YEARS = new RegExp(
  `^${MONTH}\\s+(\\d{1,2}),?\\s+(\\d{4})\\s*[-–]\\s*${MONTH}\\s+(\\d{1,2}),?\\s+(\\d{4})$`,
  "i",
);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function month(name: string): number | null {
  const index = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  return index < 0 ? null : index + 1;
}

function isoDay(year: number, monthNumber: number, dayNumber: number) {
  const date = new Date(Date.UTC(year, monthNumber - 1, dayNumber));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === monthNumber - 1 &&
    date.getUTCDate() === dayNumber
    ? date.toISOString().slice(0, 10)
    : null;
}

/** The conference's dates as whole UTC days, or null for "TBD" and the like. */
export function parseCcfddlDates(
  value: unknown,
): { start: string; end: string } | null {
  // "December 6-9, 2027 (To be confirmed)": the note is dropped.
  const raw = text(value)
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const two = TWO_YEARS.exec(raw);
  if (two) {
    const startMonth = month(two[1]);
    const endMonth = month(two[4]);
    if (!startMonth || !endMonth) return null;
    const start = isoDay(Number(two[3]), startMonth, Number(two[2]));
    const end = isoDay(Number(two[6]), endMonth, Number(two[5]));
    return start && end && end >= start ? { start, end } : null;
  }
  const one = ONE_YEAR.exec(raw);
  if (!one) return null;
  const year = Number(one[5]);
  const startMonth = month(one[1]);
  const endMonth = one[3] ? month(one[3]) : startMonth;
  if (!startMonth || !endMonth) return null;
  const start = isoDay(year, startMonth, Number(one[2]));
  const end = isoDay(year, endMonth, Number(one[4] ?? one[2]));
  return start && end && end >= start ? { start, end } : null;
}

/** Hours east of UTC for the deadline zones the data uses; null if unknown. */
function zoneOffset(zone: string): number | null {
  const name = zone.trim().toUpperCase();
  if (name === "AOE") return -12;
  if (name === "UTC" || name === "GMT") return 0;
  // Pacific time; the summer offset, so a deadline is never shown too late.
  if (name === "PT" || name === "PST" || name === "PDT") return -7;
  const match = /^(?:UTC|GMT)([+-])(\d{1,2})$/.exec(name);
  if (!match) return null;
  const hoursEast = Number(match[2]);
  return hoursEast > 14 ? null : match[1] === "-" ? -hoursEast : hoursEast;
}

/** "2026-07-28 23:59:59" in the series' zone as an ISO instant. */
function deadline(value: unknown, zone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(
    text(value),
  );
  const offset = zoneOffset(zone);
  if (!match || offset === null) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const utc = Date.UTC(y, mo - 1, d, h - offset, mi, s);
  return Number.isNaN(utc) ? null : new Date(utc);
}

/** The next paper deadline that has not passed yet. */
function nextDeadline(timeline: unknown, zone: string, now: Date) {
  if (!Array.isArray(timeline)) return null;
  const upcoming = timeline
    .map((round) =>
      round && typeof round === "object"
        ? deadline((round as Record<string, unknown>).deadline, zone)
        : null,
    )
    .filter((date): date is Date => !!date && date > now)
    .sort((a, b) => a.getTime() - b.getTime());
  return upcoming[0] ?? null;
}

/** "Montréal, Québec, Canada (Hybrid)" into city, country and format. */
export function parseCcfddlPlace(value: unknown) {
  const raw = text(value);
  const hybrid = /\bhybrid\b/i.test(raw);
  const online = /\b(online|virtual)\b/i.test(raw) && !hybrid;
  const parts = raw
    .replace(/\([^)]*\)/g, "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !/^(tbd|tba|online|virtual)$/i.test(part));
  const country = parts.length > 0 ? countryCode(parts.at(-1)) : null;
  const city = parts.length > (country ? 1 : 0) ? parts[0].slice(0, 120) : null;
  return {
    city: online ? null : city,
    country: online ? null : country,
    format: online
      ? ("online" as const)
      : hybrid
        ? ("hybrid" as const)
        : ("offline" as const),
  };
}

type Series = {
  title?: unknown;
  description?: unknown;
  sub?: unknown;
  confs?: unknown;
};

/** One conference year into our shape, or null when it cannot be shown. */
export function mapCcfddlConference(
  series: Series,
  conf: Record<string, unknown>,
  now: Date,
): RawEvent | null {
  const id = text(conf.id).toLowerCase();
  const name = text(series.title);
  const year = Number(conf.year);
  const url = httpUrl(conf.link);
  const dates = parseCcfddlDates(conf.date);
  if (!id || !name || !Number.isInteger(year) || !url || !dates) return null;
  const place = parseCcfddlPlace(conf.place);
  // An in-person conference needs a place to be worth listing.
  if (place.format !== "online" && !place.city && !place.country) return null;
  const description = text(series.description).slice(0, 500);
  const title = `${name} ${year}`.slice(0, 200);
  const topics = new Set<EventTopic>(
    CCFDDL_TOPICS[text(series.sub)] ?? ["dev"],
  );
  const words = `${title} ${description}`;
  if (WEB3.test(words)) topics.add("web3");
  if (AI.test(words)) topics.add("ai");
  const cfpEnd = nextDeadline(conf.timeline, text(conf.timezone), now);
  return {
    externalId: id,
    title,
    description,
    startsAt: `${dates.start}T00:00:00.000Z`,
    endsAt: `${dates.end}T23:59:59.000Z`,
    allDay: true,
    timeZone: null,
    format: place.format,
    country: place.country,
    city: place.city,
    url,
    cfpUrl: cfpEnd ? url : null,
    cfpEndsAt: cfpEnd ? cfpEnd.toISOString() : null,
    topics: [...topics],
    kind: kindOf(description || title),
  };
}

/** Every conference year in the file that has not ended yet. */
export function mapCcfddl(data: unknown, now: Date): RawEvent[] {
  if (!Array.isArray(data)) {
    throw new Error("ccfddl: the data is not a list of conferences");
  }
  const byId = new Map<string, RawEvent>();
  for (const series of data) {
    if (!series || typeof series !== "object") continue;
    const confs = (series as Series).confs;
    if (!Array.isArray(confs)) continue;
    for (const conf of confs) {
      if (!conf || typeof conf !== "object") continue;
      const event = mapCcfddlConference(
        series as Series,
        conf as Record<string, unknown>,
        now,
      );
      if (event && new Date(event.endsAt) >= now) {
        byId.set(event.externalId, event);
      }
    }
  }
  return [...byId.values()];
}

export const ccfddlSource: EventSource = {
  sourceName: "ccfddl",
  url: CCFDDL_DATA_URL,
  attributionUrl: CCFDDL_SITE,
  // The data changes through pull requests; twice a day is plenty.
  minIntervalMs: hours(12),
  async fetch(now, fetchImpl) {
    return mapCcfddl(await fetchJson(CCFDDL_DATA_URL, fetchImpl), now);
  },
};
