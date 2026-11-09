import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  EventFormat,
  EventKind,
  EventStatus,
  EventTopic,
} from "../config/events";

/** Web3 and tech events from open data (D435). Ended ones are deleted (D436). */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    timeZone: text("time_zone"),
    allDay: boolean("all_day").notNull().default(true),
    format: text("format").$type<EventFormat>().notNull(),
    country: text("country"),
    city: text("city"),
    url: text("url").notNull(),
    cfpUrl: text("cfp_url"),
    cfpEndsAt: timestamp("cfp_ends_at", { withTimezone: true }),
    topics: text("topics")
      .array()
      .$type<EventTopic[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    kind: text("kind").$type<EventKind>().notNull().default("conference"),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    status: text("status").$type<EventStatus>().notNull().default("published"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("events_slug_key").on(table.slug),
    unique("events_source_external_key").on(table.source, table.externalId),
    index("events_status_starts_idx").on(table.status, table.startsAt),
    index("events_topics_idx").using("gin", table.topics),
    index("events_source_seen_idx").on(table.source, table.lastSeenAt),
    check("events_dates_check", sql`${table.endsAt} >= ${table.startsAt}`),
    check(
      "events_format_check",
      sql`${table.format} in ('online', 'offline', 'hybrid')`,
    ),
    check(
      "events_kind_check",
      sql`${table.kind} in ('summit', 'conference', 'meetup', 'hackathon', 'business', 'career')`,
    ),
    check(
      "events_status_check",
      sql`${table.status} in ('published', 'removed', 'expired')`,
    ),
  ],
);
