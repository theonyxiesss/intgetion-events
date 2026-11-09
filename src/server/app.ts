import { z, ZodError } from "zod";
import { HttpError, httpErrorResponse, notFound, reportError, validationError } from "@intgetion/kit";
import { EVENT_KINDS, EVENT_TOPICS } from "../config/events";
import * as events from "../modules/events/service";
import { requireServiceToken } from "./auth";

export type AppConfig = { serviceToken: string };

const MAX_JSON = 4 * 1024;

/** `findEventsForPerson`: what Spoki and MCP ask for (D435). */
const personFilter = z
  .object({
    topics: z.array(z.enum(EVENT_TOPICS)).max(5).optional(),
    kind: z.enum(EVENT_KINDS).optional(),
    country: z.string().regex(/^[A-Za-z]{2}$/).nullish(),
    remote: z.boolean().optional(),
    withinDays: z.number().int().min(1).max(365).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

async function parsed<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const text = await request.text();
  if (text.length > MAX_JSON) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Body too large");
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw validationError([{ path: [], message: "invalid_json" }]);
  }
  return schema.parse(json);
}

/** The catalog changes once a day: a short shared cache for reads. */
const cached = (body: unknown) => Response.json(body, { headers: { "cache-control": "public, max-age=300" } });
const json = (body: unknown) => Response.json(body, { headers: { "cache-control": "no-store" } });

/** Query string to the shape the search parser takes (repeated keys as arrays). */
function rawQuery(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    out[key] = all.length > 1 ? all : (all[0] ?? "");
  }
  return out;
}

type Route = { method: string; pattern: RegExp; run: (request: Request, params: string[], url: URL) => Promise<Response> };

const routes: Route[] = [
  {
    method: "GET",
    pattern: /^\/v1\/events$/,
    run: async (_request, _p, url) => cached(await events.searchEvents(events.parseEventSearch(rawQuery(url)))),
  },
  { method: "GET", pattern: /^\/v1\/events\/countries$/, run: async () => cached({ countries: await events.listEventCountries() }) },
  { method: "GET", pattern: /^\/v1\/events\/sitemap$/, run: async () => cached({ entries: await events.listEventSitemapEntries() }) },
  {
    method: "POST",
    pattern: /^\/v1\/events\/for-person$/,
    run: async (request) => json({ items: await events.findEventsForPerson(await parsed(request, personFilter)) }),
  },
  {
    method: "GET",
    pattern: /^\/v1\/events\/([^/]+)$/,
    run: async (_request, [slug]) => {
      const event = await events.getEventBySlug(decodeURIComponent(slug ?? ""));
      if (!event) throw notFound();
      // JSON-LD needs the page address and its summary: the page builds it with `eventJsonLd`.
      return cached({ event });
    },
  },
  {
    // Cron: import from the approved sources, drop ended events (D435, D436).
    method: "POST",
    pattern: /^\/v1\/tasks\/import$/,
    run: async () => {
      const { deleted, sources } = await events.runEventImports();
      return json({ ok: true, deleted, sources });
    },
  },
];

export function toResponse(error: unknown): Response {
  if (error instanceof HttpError) return httpErrorResponse(error);
  if (error instanceof ZodError) return httpErrorResponse(validationError(error.issues));
  reportError(error, "events-service");
  return Response.json({ error: { code: "INTERNAL", message: "Internal error" } }, { status: 500 });
}

export function createApp(config: AppConfig) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") return Response.json({ ok: true });
      requireServiceToken(request, config.serviceToken);
      for (const route of routes) {
        if (route.method !== request.method) continue;
        const match = route.pattern.exec(url.pathname);
        if (!match) continue;
        return await route.run(request, match.slice(1), url);
      }
      throw notFound();
    } catch (error) {
      return toResponse(error);
    }
  };
}
