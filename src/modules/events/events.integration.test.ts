import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@intgetion/kit";
import { events } from "../../db/owned";
import type { RawEvent } from "./adapters/types";
import * as repo from "./repo/events-repo";
import { filterForPerson, filterFromQuery } from "./service/filter";
import { parseEventSearch } from "./schemas/search";

const token = randomUUID().slice(0, 8);
const source = `Integration Events ${token}`;
const now = new Date("2026-10-15T12:00:00.000Z");

function event(overrides: Partial<RawEvent>): RawEvent {
  return {
    externalId: randomUUID(),
    title: `Event ${token}`,
    description: "",
    startsAt: "2026-11-12T00:00:00.000Z",
    endsAt: "2026-11-13T23:59:59.000Z",
    allDay: true,
    timeZone: null,
    format: "offline",
    country: "PT",
    city: "Lisbon",
    url: `https://${token}.invalid/event`,
    cfpUrl: null,
    cfpEndsAt: null,
    topics: ["dev"],
    kind: "conference",
    ...overrides,
  };
}

const lisbon = event({
  externalId: "lisbon",
  title: `Web3 Lisbon ${token}`,
  topics: ["web3"],
  kind: "summit",
});
const online = event({
  externalId: "online",
  title: `AI Online ${token}`,
  format: "online",
  country: null,
  city: null,
  topics: ["ai"],
});
const berlin = event({
  externalId: "berlin",
  title: `Berlin Meetup ${token}`,
  country: "DE",
  city: "Berlin",
  kind: "meetup",
  startsAt: "2027-01-10T00:00:00.000Z",
  endsAt: "2027-01-10T23:59:59.000Z",
});
const past = event({
  externalId: "past",
  title: `Past ${token}`,
  startsAt: "2026-09-01T00:00:00.000Z",
  endsAt: "2026-09-02T23:59:59.000Z",
});

afterAll(async () => {
  // Only what this test created.
  await getDb().delete(events).where(eq(events.source, source));
});

async function rowOf(externalId: string) {
  const [row] = await getDb()
    .select()
    .from(events)
    .where(and(eq(events.source, source), eq(events.externalId, externalId)));
  return row;
}

const ours = (items: { title: string }[]) =>
  items
    .map((item) => item.title)
    .filter((title) => title.includes(token))
    .sort();

describe("events repo (D435)", () => {
  it("inserts, then refreshes the same events without new slugs", async () => {
    const first = await repo.upsertEvents(
      source,
      [lisbon, online, berlin, past],
      now,
    );
    expect(first).toEqual({ created: 4, updated: 0 });
    const before = await rowOf("lisbon");
    const second = await repo.upsertEvents(
      source,
      [{ ...lisbon, title: `Web3 Lisbon Renamed ${token}` }],
      new Date(now.getTime() + 1000),
    );
    expect(second).toEqual({ created: 0, updated: 1 });
    const after = await rowOf("lisbon");
    expect(after?.slug).toBe(before?.slug);
    expect(after?.title).toBe(`Web3 Lisbon Renamed ${token}`);
  });

  it("filters by topic, kind, format, country and dates; never the past", async () => {
    const all = await repo.findEvents(
      filterFromQuery(parseEventSearch({ q: token }), now),
    );
    expect(ours(all.items)).toEqual([
      `AI Online ${token}`,
      `Berlin Meetup ${token}`,
      `Web3 Lisbon Renamed ${token}`,
    ]);
    const web3 = await repo.findEvents(
      filterFromQuery(parseEventSearch({ q: token, topic: "web3" }), now),
    );
    expect(ours(web3.items)).toEqual([`Web3 Lisbon Renamed ${token}`]);
    const meetups = await repo.findEvents(
      filterFromQuery(parseEventSearch({ q: token, kind: "meetup" }), now),
    );
    expect(ours(meetups.items)).toEqual([`Berlin Meetup ${token}`]);
    const onlineOnly = await repo.findEvents(
      filterFromQuery(parseEventSearch({ q: token, format: "online" }), now),
    );
    expect(ours(onlineOnly.items)).toEqual([`AI Online ${token}`]);
    const germany = await repo.findEvents(
      filterFromQuery(parseEventSearch({ q: token, country: "DE" }), now),
    );
    expect(ours(germany.items)).toEqual([`Berlin Meetup ${token}`]);
    const november = await repo.findEvents(
      filterFromQuery(
        parseEventSearch({ q: token, from: "2026-11-01", to: "2026-11-30" }),
        now,
      ),
    );
    expect(ours(november.items)).toEqual([
      `AI Online ${token}`,
      `Web3 Lisbon Renamed ${token}`,
    ]);
  });

  it("Spoki: the person's country or anything remote", async () => {
    const { items } = await repo.findEvents({
      ...filterForPerson({ country: "DE", remote: true, limit: 10 }, now),
      q: token,
    });
    expect(ours(items)).toEqual([
      `AI Online ${token}`,
      `Berlin Meetup ${token}`,
    ]);
  });

  it("keeps removed ones removed and hides events the source dropped", async () => {
    await getDb()
      .update(events)
      .set({ status: "removed" })
      .where(and(eq(events.source, source), eq(events.externalId, "berlin")));
    await repo.upsertEvents(source, [berlin], now);
    const stillRemoved = await rowOf("berlin");
    expect(stillRemoved?.status).toBe("removed");
    expect(await repo.findEventBySlug(stillRemoved?.slug ?? "")).toBeNull();

    // Upcoming, but not listed for 30 days: hidden, not deleted.
    const later = new Date(now.getTime() + 40 * 86_400_000);
    await repo.upsertEvents(source, [lisbon], later);
    const hidden = await repo.expireUnseenEvents(
      source,
      later,
      new Date(later.getTime() - 30 * 86_400_000),
    );
    const online = await rowOf("online");
    expect(hidden).toBe(2); // "online" and the never-refreshed "past"
    expect(online?.status).toBe("expired");
    expect(await repo.findEventBySlug(online?.slug ?? "")).toBeNull();
    expect((await rowOf("lisbon"))?.status).toBe("published");
  });

  it("deletes events whose date has passed (D436)", async () => {
    expect(await rowOf("past")).toBeDefined();
    const deleted = await repo.deleteEndedEvents(now, source);
    expect(deleted).toBe(1);
    expect(await rowOf("past")).toBeUndefined();
    expect(await rowOf("lisbon")).toBeDefined();
  });
});
