import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventSource, RawEvent } from "../adapters/types";

const ledger = {
  registerFeedSource: vi.fn(),
  closeStaleRuns: vi.fn(),
  sourceStartedSince: vi.fn(),
  beginImportRun: vi.fn(),
  finishImportRun: vi.fn(),
  markSourceRun: vi.fn(),
  pruneImportRunHistory: vi.fn(),
};
const repo = {
  upsertEvents: vi.fn(),
  expireUnseenEvents: vi.fn(),
  deleteEndedEvents: vi.fn(),
};

vi.mock("@intgetion/ingestion", async () => {
  const guard = await vi.importActual<typeof import("@intgetion/ingestion")>("@intgetion/ingestion");
  return {
    ...ledger,
    fixtureImportAllowed: guard.fixtureImportAllowed,
    FIXTURES_NEED_LOCAL_DATABASE: guard.FIXTURES_NEED_LOCAL_DATABASE,
    STALE_RUN_AFTER_MS: 15 * 60 * 1000,
    days: (count: number) => count * 86_400_000,
    hours: (count: number) => count * 3_600_000,
    fetchJson: vi.fn(),
  };
});
vi.mock("../repo/events-repo", () => repo);

const { runEventImports } = await import("../service/import");

const now = new Date("2026-10-15T12:00:00.000Z");
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "src-1",
  enabled: true,
  republishAllowed: true,
  lastRunAt: null,
  ...overrides,
});
const oneEvent = { externalId: "x", title: "X" } as RawEvent;

function source(name: string, fetched: RawEvent[] = [oneEvent]): EventSource {
  return {
    sourceName: name,
    url: `https://example.com/${name}`,
    attributionUrl: "https://example.com",
    minIntervalMs: 12 * 3_600_000,
    fetch: vi.fn(async () => fetched),
  };
}

beforeEach(() => {
  for (const fn of [...Object.values(ledger), ...Object.values(repo)]) {
    fn.mockReset();
  }
  ledger.registerFeedSource.mockResolvedValue(row());
  ledger.sourceStartedSince.mockResolvedValue(false);
  ledger.beginImportRun.mockResolvedValue({ id: "run-1" });
  repo.upsertEvents.mockResolvedValue({ created: 1, updated: 0 });
  repo.expireUnseenEvents.mockResolvedValue(2);
  repo.deleteEndedEvents.mockResolvedValue(3);
});

describe("event import runner (D435)", () => {
  it("fetches nothing live until a source is approved, and no fixture on the cloud", async () => {
    const live = source("confs.tech");
    const fixture = source("Fictional Events Feed");
    const { deleted, sources: reports } = await runEventImports({
      now: () => now,
      sources: [live],
      approved: () => [],
      databaseUrl: () => "postgresql://app@db.ref.supabase.co:6543/postgres",
      fixture,
    });
    // D436: ended events are deleted even when no feed runs.
    expect(deleted).toBe(3);
    expect(repo.deleteEndedEvents).toHaveBeenCalledWith(now);
    expect(reports).toEqual([
      expect.objectContaining({
        source: "Fictional Events Feed",
        skipped: true,
        error: "fixtures_skipped: the database is not local",
      }),
    ]);
    expect(live.fetch).not.toHaveBeenCalled();
    expect(fixture.fetch).not.toHaveBeenCalled();
    expect(repo.upsertEvents).not.toHaveBeenCalled();
  });

  it("runs the fixture on a local database", async () => {
    const fixture = source("Fictional Events Feed");
    const {
      sources: [report],
    } = await runEventImports({
      now: () => now,
      sources: [source("confs.tech")],
      approved: () => [],
      databaseUrl: () => "postgresql://postgres@127.0.0.1:54322/postgres",
      fixture,
    });
    expect(report).toMatchObject({
      source: "Fictional Events Feed",
      skipped: false,
      fetched: 1,
      created: 1,
      expired: 2,
      error: null,
    });
    expect(repo.upsertEvents).toHaveBeenCalledWith(
      "Fictional Events Feed",
      [oneEvent],
      now,
    );
  });

  it("runs only approved sources, one per call, the most overdue first", async () => {
    const fresh = source("confs.tech");
    const unapproved = source("other");
    ledger.registerFeedSource.mockResolvedValue(row());
    const { sources: reports } = await runEventImports({
      now: () => now,
      sources: [fresh, unapproved],
      approved: () => ["confs.tech"],
      databaseUrl: () => "postgresql://app@db.ref.supabase.co:6543/postgres",
      fixture: source("Fictional Events Feed"),
    });
    expect(reports.map((report) => report.source)).toEqual(["confs.tech"]);
    expect(unapproved.fetch).not.toHaveBeenCalled();
    expect(ledger.finishImportRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ fetched: 1, created: 1, expired: 2 }),
      null,
    );
    expect(ledger.markSourceRun).toHaveBeenCalledWith("src-1", "success");
    // Upcoming but unseen for 30 days is hidden (D412 window).
    expect(repo.expireUnseenEvents).toHaveBeenCalledWith(
      "confs.tech",
      now,
      new Date(now.getTime() - 30 * 86_400_000),
    );
  });

  it("an admin switch or the source's interval keeps it from running", async () => {
    const live = source("confs.tech");
    ledger.registerFeedSource.mockResolvedValue(row({ enabled: false }));
    const {
      sources: [off],
    } = await runEventImports({
      now: () => now,
      sources: [live],
      approved: () => ["confs.tech"],
      databaseUrl: () => undefined,
      fixture: source("Fictional Events Feed"),
    });
    expect(off).toMatchObject({ skipped: true, error: null });
    ledger.registerFeedSource.mockResolvedValue(row());
    ledger.sourceStartedSince.mockResolvedValue(true);
    const {
      sources: [early],
    } = await runEventImports({
      now: () => now,
      sources: [live],
      approved: () => ["confs.tech"],
      databaseUrl: () => undefined,
      fixture: source("Fictional Events Feed"),
    });
    expect(early).toMatchObject({ skipped: true });
    expect(live.fetch).not.toHaveBeenCalled();
    expect(ledger.beginImportRun).not.toHaveBeenCalled();
  });

  it("records a failed fetch on the run and does not touch events", async () => {
    const broken = source("confs.tech");
    vi.mocked(broken.fetch).mockRejectedValue(new Error("feed responded 500"));
    const {
      sources: [report],
    } = await runEventImports({
      now: () => now,
      sources: [broken],
      approved: () => ["confs.tech"],
      databaseUrl: () => undefined,
      fixture: source("Fictional Events Feed"),
    });
    expect(report).toMatchObject({
      skipped: false,
      error: "feed responded 500",
    });
    expect(ledger.finishImportRun).toHaveBeenCalledWith(
      "run-1",
      expect.anything(),
      "feed responded 500",
    );
    expect(ledger.markSourceRun).toHaveBeenCalledWith("src-1", "error");
    expect(repo.upsertEvents).not.toHaveBeenCalled();
    expect(repo.expireUnseenEvents).not.toHaveBeenCalled();
  });
});
