import { z } from "zod";
import { EVENT_FORMATS, EVENT_KINDS, EVENT_TOPICS } from "../../../config/events";

const blankToUndefined = (value: unknown) =>
  value === "" || value === null ? undefined : value;

const isoDay = z.preprocess(
  blankToUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    .optional(),
);

/** `/events` query string (D435). Unknown or bad values are dropped. */
export const eventSearchQuery = z.object({
  q: z.preprocess(blankToUndefined, z.string().trim().max(200).optional()),
  topic: z.preprocess(blankToUndefined, z.enum(EVENT_TOPICS).optional()),
  kind: z.preprocess(blankToUndefined, z.enum(EVENT_KINDS).optional()),
  format: z.preprocess(blankToUndefined, z.enum(EVENT_FORMATS).optional()),
  country: z.preprocess(
    (value) =>
      typeof value === "string" && value
        ? value.trim().toUpperCase()
        : undefined,
    z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
  ),
  from: isoDay,
  to: isoDay,
  page: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(50).default(1),
  ),
});

export type EventSearchQuery = z.infer<typeof eventSearchQuery>;

/** Parse what the page got; a bad value falls back to no filter at all. */
export function parseEventSearch(
  raw: Record<string, string | string[] | undefined>,
): EventSearchQuery {
  const flat = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const parsed = eventSearchQuery.safeParse(flat);
  if (parsed.success) return parsed.data;
  // Keep the keys that are valid on their own.
  const kept: Record<string, unknown> = {};
  for (const key of Object.keys(eventSearchQuery.shape)) {
    const one = eventSearchQuery.safeParse({ [key]: flat[key] });
    if (one.success) kept[key] = flat[key];
  }
  return eventSearchQuery.parse(kept);
}
