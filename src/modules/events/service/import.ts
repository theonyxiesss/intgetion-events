import { approvedEventSources } from "../../../config/events";
import {
  FIXTURES_NEED_LOCAL_DATABASE,
  STALE_RUN_AFTER_MS,
  beginImportRun,
  closeStaleRuns,
  days,
  finishImportRun,
  fixtureImportAllowed,
  markSourceRun,
  pruneImportRunHistory,
  registerFeedSource,
  sourceStartedSince,
  type RunCounters,
} from "@intgetion/ingestion";
import { ccfddlSource } from "../adapters/ccfddl";
import { confsTechSource } from "../adapters/confs-tech";
import { fixtureEventSource } from "../adapters/fixture";
import type { EventSource } from "../adapters/types";
import * as repo from "../repo/events-repo";
import { isMissingEventsTable } from "./queries";

/** Feeds the code can read. Each runs live only when approved (D18, D435). */
export const EVENT_SOURCES: readonly EventSource[] = [
  confsTechSource,
  ccfddlSource,
];

/** An upcoming event the source has not listed for this long is hidden. */
export const EVENT_STALE_AFTER_MS = days(30);

export type EventImportReport = RunCounters & {
  source: string;
  skipped: boolean;
  error: string | null;
};

export type EventImportResult = {
  /** Ended events deleted before the feeds ran (D436). */
  deleted: number;
  sources: EventImportReport[];
};

type Dependencies = {
  now: () => Date;
  sources: readonly EventSource[];
  /** Names listed in EVENTS_IMPORT_SOURCES; empty means fixtures only. */
  approved: () => string[];
  databaseUrl: () => string | undefined;
  fixture: EventSource;
};

const defaults: Dependencies = {
  now: () => new Date(),
  sources: EVENT_SOURCES,
  approved: () => approvedEventSources(),
  databaseUrl: () => process.env.DATABASE_URL,
  fixture: fixtureEventSource,
};

function emptyCounters(): RunCounters {
  return {
    fetched: 0,
    created: 0,
    updated: 0,
    merged: 0,
    rejected: 0,
    expired: 0,
  };
}

function skipped(source: string, error: string | null): EventImportReport {
  return { ...emptyCounters(), source, skipped: true, error };
}

/**
 * Every call first deletes the events whose date has passed, from every
 * source, even when no feed runs (D436). Then one event feed, the most
 * overdue approved one (as D412 does for jobs). With no approved feed, the
 * made-up fixture runs, and only against a database on this machine.
 */
export async function runEventImports(
  overrides: Partial<Dependencies> = {},
): Promise<EventImportResult> {
  const deps: Dependencies = { ...defaults, ...overrides };
  const now = deps.now();
  let deleted = 0;
  try {
    deleted = await repo.deleteEndedEvents(now);
  } catch (error) {
    if (!isMissingEventsTable(error)) throw error;
    return {
      deleted: 0,
      sources: [skipped("events", "migration 0049 is not on this database")],
    };
  }
  return { deleted, sources: await runFeeds(deps, now) };
}

async function runFeeds(
  deps: Dependencies,
  now: Date,
): Promise<EventImportReport[]> {
  const approved = new Set(deps.approved());
  const live = deps.sources.filter((source) => approved.has(source.sourceName));
  if (live.length === 0) {
    if (!fixtureImportAllowed(deps.databaseUrl())) {
      return [skipped(deps.fixture.sourceName, FIXTURES_NEED_LOCAL_DATABASE)];
    }
    return [await importSource(deps.fixture, now)];
  }
  const registered: { source: EventSource; lastRunAt: number }[] = [];
  for (const source of live) {
    const row = await registerFeedSource({
      sourceName: source.sourceName,
      kind: "api",
      url: source.url,
    });
    registered.push({ source, lastRunAt: row.lastRunAt?.getTime() ?? 0 });
  }
  registered.sort((a, b) => a.lastRunAt - b.lastRunAt);
  const reports: EventImportReport[] = [];
  for (const { source } of registered) {
    const report = await importSource(source, now);
    reports.push(report);
    if (!report.skipped) break;
  }
  await pruneImportRunHistory(now);
  return reports;
}

async function importSource(
  source: EventSource,
  now: Date,
): Promise<EventImportReport> {
  const row = await registerFeedSource({
    sourceName: source.sourceName,
    kind: "api",
    url: source.url,
  });
  await closeStaleRuns(row.id, new Date(now.getTime() - STALE_RUN_AFTER_MS));
  // An admin can still switch a source off in its row.
  if (!row.enabled || !row.republishAllowed) {
    return skipped(source.sourceName, null);
  }
  if (
    await sourceStartedSince(
      row.id,
      new Date(now.getTime() - source.minIntervalMs),
    )
  ) {
    return skipped(source.sourceName, null);
  }
  const run = await beginImportRun(row.id, now);
  const counters = emptyCounters();
  try {
    const rows = await source.fetch(now);
    counters.fetched = rows.length;
    const saved = await repo.upsertEvents(source.sourceName, rows, now);
    counters.created = saved.created;
    counters.updated = saved.updated;
    counters.expired = await repo.expireUnseenEvents(
      source.sourceName,
      now,
      new Date(now.getTime() - EVENT_STALE_AFTER_MS),
    );
    await finishImportRun(run.id, counters, null);
    await markSourceRun(row.id, "success");
    return {
      ...counters,
      source: source.sourceName,
      skipped: false,
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 1000) : "Import failed";
    await finishImportRun(run.id, counters, message);
    await markSourceRun(row.id, "error");
    return {
      ...counters,
      source: source.sourceName,
      skipped: false,
      error: message,
    };
  }
}
