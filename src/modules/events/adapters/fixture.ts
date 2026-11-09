import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mergeConfsTech } from "./confs-tech";
import type { EventSource, RawEvent } from "./types";

/**
 * Made-up events in the confs.tech shape, so the catalog renders on a local
 * database and in tests. Never run against the cloud database (D412, D435).
 */
export function parseEventFixture(json: string, now: Date): RawEvent[] {
  const rows = JSON.parse(json) as ({ topic?: string } & Record<
    string,
    unknown
  >)[];
  return mergeConfsTech(
    rows.map((row) => ({ topic: row.topic ?? "general", rows: [row] })),
    now,
  );
}

export const fixtureEventSource: EventSource = {
  sourceName: "Fictional Events Feed",
  url: "fixtures/events/fictional-events.json",
  attributionUrl: "https://example.com",
  minIntervalMs: 60 * 60 * 1000,
  async fetch(now) {
    const path = join(process.cwd(), "fixtures/events/fictional-events.json");
    return parseEventFixture(await readFile(path, "utf8"), now);
  },
};
