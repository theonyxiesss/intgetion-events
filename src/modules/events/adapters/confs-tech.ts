import type { EventKind, EventTopic } from "../../../config/events";
import { fetchJson, hours } from "@intgetion/ingestion";
import { countryCode } from "./country";
import type { EventSource, RawEvent } from "./types";

/**
 * confs.tech open data: github.com/tech-conferences/conference-data, MIT
 * licence. One JSON file per topic and year, read from raw GitHub files.
 * Every event links to the organizer's own page; confs.tech is credited.
 */
export const CONFS_TECH_DATA_URL =
  "https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences";
export const CONFS_TECH_SITE = "https://confs.tech";

/** Topic files we read, and the topics each one gives an event. */
export const CONFS_TECH_TOPICS: Record<string, EventTopic[]> = {
  general: ["dev"],
  javascript: ["dev"],
  typescript: ["dev"],
  css: ["dev", "design"],
  python: ["dev"],
  rust: ["dev"],
  java: ["dev"],
  kotlin: ["dev"],
  php: ["dev"],
  dotnet: ["dev"],
  cpp: ["dev"],
  android: ["dev"],
  ios: ["dev"],
  graphql: ["dev"],
  api: ["dev"],
  opensource: ["dev"],
  testing: ["dev"],
  performance: ["dev"],
  iot: ["dev"],
  data: ["data"],
  devops: ["devops"],
  networking: ["devops"],
  security: ["security"],
  product: ["product"],
  ux: ["design"],
  accessibility: ["design"],
  leadership: ["business"],
  "tech-comm": ["business"],
};

export const WEB3 =
  /\b(web3|web 3|blockchain|ethereum|eth[a-z]*\s?(conf|global|denver|cc)|crypto|defi|solana|bitcoin|dao|onchain|zk|zero[- ]knowledge|nft)\b/i;
export const AI =
  /\b(ai|a\.i\.|artificial intelligence|machine learning|ml|llms?|genai|gen ai|agentic)\b/i;
const CAREER = /\b(career|job fair|jobs fair|hiring|recruit\w*)\b/i;
const BUSINESS =
  /\b(business (breakfast|lunch|dinner|meetup|mixer|networking)|networking (breakfast|drinks|mixer|night)|founders? (meetup|mixer|breakfast))\b/i;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** http(s) only; anything else (javascript:, bare hosts) is refused. */
export function httpUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function day(value: unknown): string | null {
  const raw = text(value);
  if (!DATE.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== raw
    ? null
    : raw;
}

export function kindOf(title: string): EventKind {
  if (/\bsummit\b/i.test(title)) return "summit";
  if (/\bhackathon\b|\bhack\b/i.test(title)) return "hackathon";
  if (/\bmeet-?ups?\b/i.test(title)) return "meetup";
  if (CAREER.test(title)) return "career";
  if (BUSINESS.test(title)) return "business";
  return "conference";
}

/** One key per conference, the same in every topic file it appears in. */
export function confsTechId(url: string, startDate: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
  return `${startDate}|${host}${path}`;
}

/** A confs.tech row into our shape, or null when it cannot be shown. */
export function mapConfsTechRow(
  row: Record<string, unknown>,
  topicFile: string,
): RawEvent | null {
  const title = text(row.name).slice(0, 200);
  const url = httpUrl(row.url);
  const start = day(row.startDate);
  const end = day(row.endDate) ?? start;
  if (!title || !url || !start || !end || end < start) return null;
  const city = text(row.city).slice(0, 120) || null;
  const country = countryCode(text(row.country));
  const online = row.online === true;
  // An in-person event needs a place to be worth listing.
  if (!online && !city && !country) return null;
  const topics = new Set<EventTopic>(CONFS_TECH_TOPICS[topicFile] ?? ["dev"]);
  if (WEB3.test(title)) topics.add("web3");
  if (AI.test(title)) topics.add("ai");
  if (CAREER.test(title)) topics.add("career");
  const cfpEnd = day(row.cfpEndDate);
  return {
    externalId: confsTechId(url, start),
    title,
    description: "",
    startsAt: `${start}T00:00:00.000Z`,
    endsAt: `${end}T23:59:59.000Z`,
    allDay: true,
    timeZone: null,
    format: online ? (city ? "hybrid" : "online") : "offline",
    country,
    city,
    url,
    cfpUrl: httpUrl(row.cfpUrl),
    cfpEndsAt: cfpEnd ? `${cfpEnd}T23:59:59.000Z` : null,
    topics: [...topics],
    kind: kindOf(title),
  };
}

/**
 * Rows of several topic files into one list: a conference listed under two
 * topics becomes one event with both. Ended events are left out.
 */
export function mergeConfsTech(
  files: readonly { topic: string; rows: unknown }[],
  now: Date,
): RawEvent[] {
  const byId = new Map<string, RawEvent>();
  for (const file of files) {
    if (!Array.isArray(file.rows)) continue;
    for (const row of file.rows) {
      if (!row || typeof row !== "object") continue;
      const event = mapConfsTechRow(row as Record<string, unknown>, file.topic);
      if (!event || new Date(event.endsAt) < now) continue;
      const known = byId.get(event.externalId);
      byId.set(
        event.externalId,
        known
          ? {
              ...known,
              topics: [...new Set([...known.topics, ...event.topics])],
            }
          : event,
      );
    }
  }
  return [...byId.values()];
}

export const confsTechSource: EventSource = {
  sourceName: "confs.tech",
  url: CONFS_TECH_DATA_URL,
  attributionUrl: CONFS_TECH_SITE,
  // The data changes through pull requests; twice a day is plenty.
  minIntervalMs: hours(12),
  async fetch(now, fetchImpl) {
    const year = now.getUTCFullYear();
    const files: { topic: string; rows: unknown }[] = [];
    for (const target of [year, year + 1]) {
      for (const topic of Object.keys(CONFS_TECH_TOPICS)) {
        const url = `${CONFS_TECH_DATA_URL}/${target}/${topic}.json`;
        try {
          files.push({ topic, rows: await fetchJson(url, fetchImpl) });
        } catch (error) {
          // Not every topic has a file every year.
          if (error instanceof Error && error.message.endsWith(" 404")) {
            continue;
          }
          throw error;
        }
      }
    }
    return mergeConfsTech(files, now);
  },
};
