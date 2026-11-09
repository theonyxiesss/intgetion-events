import { createHash } from "node:crypto";
import {
  and,
  arrayOverlaps,
  asc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import { events } from "../../../db/owned";
import type { RawEvent } from "../adapters/types";
import type { EventFilter } from "../service/filter";

/** Queries only; the rules live in service/ (3.2). */

export type EventRow = typeof events.$inferSelect;

/** Stable, readable and unique: title, year, and a short hash of the key. */
export function eventSlug(
  source: string,
  externalId: string,
  title: string,
  startsAt: string,
): string {
  const base = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
    .replace(/-$/, "");
  const hash = createHash("sha256")
    .update(`${source}|${externalId}`)
    .digest("hex")
    .slice(0, 6);
  return `${base || "event"}-${startsAt.slice(0, 4)}-${hash}`;
}

/**
 * Insert new events and refresh known ones. A removed event stays removed:
 * that was a person's decision. An expired one that is listed again and
 * still ahead is published again. The slug never changes once given.
 */
export async function upsertEvents(
  source: string,
  rows: readonly RawEvent[],
  now: Date,
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const values = {
      title: row.title,
      description: row.description,
      startsAt: new Date(row.startsAt),
      endsAt: new Date(row.endsAt),
      allDay: row.allDay,
      timeZone: row.timeZone,
      format: row.format,
      country: row.country,
      city: row.city,
      url: row.url,
      cfpUrl: row.cfpUrl,
      cfpEndsAt: row.cfpEndsAt ? new Date(row.cfpEndsAt) : null,
      topics: row.topics,
      kind: row.kind,
      lastSeenAt: now,
      updatedAt: now,
    };
    const [saved] = await getDb()
      .insert(events)
      .values({
        ...values,
        slug: eventSlug(source, row.externalId, row.title, row.startsAt),
        source,
        externalId: row.externalId,
        status: "published",
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [events.source, events.externalId],
        set: {
          ...values,
          status: sql`case when ${events.status} = 'removed' then 'removed' else 'published' end`,
        },
      })
      // xmax is 0 only on a row this statement inserted.
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    if (saved?.inserted) created += 1;
    else updated += 1;
  }
  return { created, updated };
}

/**
 * Events whose date has passed are deleted, whatever their source or status
 * (D436). Feeds drop ended events before the upsert, so they do not return.
 */
export async function deleteEndedEvents(
  now: Date,
  /** Tests limit it to their own rows; the cron deletes across sources. */
  source?: string,
): Promise<number> {
  const deleted = await getDb()
    .delete(events)
    .where(
      source
        ? and(lt(events.endsAt, now), eq(events.source, source))
        : lt(events.endsAt, now),
    )
    .returning({ id: events.id });
  return deleted.length;
}

/**
 * An upcoming event the source stopped listing long ago leaves the catalog
 * as `expired`; it is deleted once its date passes (D436).
 */
export async function expireUnseenEvents(
  source: string,
  now: Date,
  unseenBefore: Date,
): Promise<number> {
  const expired = await getDb()
    .update(events)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(events.source, source),
        eq(events.status, "published"),
        lt(events.lastSeenAt, unseenBefore),
      ),
    )
    .returning({ id: events.id });
  return expired.length;
}

function conditions(filter: EventFilter): SQL[] {
  const where: (SQL | undefined)[] = [
    eq(events.status, "published"),
    gte(events.endsAt, filter.from),
    filter.to ? lte(events.startsAt, filter.to) : undefined,
    filter.topics.length
      ? arrayOverlaps(events.topics, filter.topics)
      : undefined,
    filter.kinds.length ? inArray(events.kind, filter.kinds) : undefined,
    filter.formats.length ? inArray(events.format, filter.formats) : undefined,
    filter.q
      ? ilike(events.title, `%${filter.q.replace(/[\\%_]/g, "\\$&")}%`)
      : undefined,
  ];
  if (filter.country) {
    where.push(
      filter.orRemote
        ? or(
            eq(events.country, filter.country),
            inArray(events.format, ["online", "hybrid"]),
          )
        : eq(events.country, filter.country),
    );
  }
  return where.filter((item): item is SQL => item !== undefined);
}

/** One page of events, soonest first, plus whether another page follows. */
export async function findEvents(
  filter: EventFilter,
): Promise<{ items: EventRow[]; hasMore: boolean }> {
  const rows = await getDb()
    .select()
    .from(events)
    .where(and(...conditions(filter)))
    .orderBy(asc(events.startsAt), asc(events.title))
    .limit(filter.limit + 1)
    .offset(filter.offset);
  return {
    items: rows.slice(0, filter.limit),
    hasMore: rows.length > filter.limit,
  };
}

/** A published event by slug. Removed and expired ones are not shown. */
export async function findEventBySlug(slug: string): Promise<EventRow | null> {
  const [row] = await getDb()
    .select()
    .from(events)
    .where(and(eq(events.slug, slug), eq(events.status, "published")))
    .limit(1);
  return row ?? null;
}

/** Countries that have an upcoming event, for the filter. */
export async function listEventCountries(now: Date): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ country: events.country })
    .from(events)
    .where(
      and(
        eq(events.status, "published"),
        gte(events.endsAt, now),
        isNotNull(events.country),
      ),
    );
  return rows
    .map((row) => row.country)
    .filter((country): country is string => Boolean(country))
    .sort();
}

/** Upcoming published events for the sitemap. */
export async function listEventSitemapRows(now: Date) {
  return getDb()
    .select({ slug: events.slug, updatedAt: events.updatedAt })
    .from(events)
    .where(and(eq(events.status, "published"), gte(events.endsAt, now)))
    .orderBy(asc(events.startsAt))
    .limit(5000);
}
