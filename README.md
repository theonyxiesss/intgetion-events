# intgetion-events

Tech events of the INTGETION platform as a standalone service: conferences
and meetups imported daily from approved sources (confs.tech, ccfddl and the
fictional fixture), the public catalog with topic, kind, format, country and
date filters, the event page data, countries and sitemap entries, events for
a person (Spoki and MCP), and dropping events whose date has passed (D435,
D436). Not connected to the platform yet; it is integrated later through a
separate branch and PR. The pages stay in the platform.

- Package `@intgetion/events`, HTTP service on port `4220`.
- Depends by git tag on `@intgetion/kit` v0.3.1 and `@intgetion/ingestion`
  v0.1.0 (the run ledger and `fetchJson`).
- Owns `events` (migration `0001_events.sql`, the final state of platform
  migration 0049 for it, with the `app_rw` grant). `./config` exports the
  event topics, kinds and formats; `./db` the table definition.
- The import writes its runs through ingestion's ledger, into ingestion's
  `import_sources` and `import_runs` on the same database.
- Fixture records live in `fixtures/events/`.

## HTTP

Every route except `/health` needs `authorization: Bearer $EVENTS_SERVICE_TOKEN`.
Catalog reads may be cached for five minutes.

| Method | Path | Does |
| --- | --- | --- |
| GET | `/v1/events?topic&kind&format&country&from&to&cursor` | the catalog page |
| GET | `/v1/events/:slug` | one event (the page builds JSON-LD with `eventJsonLd`) |
| GET | `/v1/events/countries`, `/v1/events/sitemap` | filter countries, sitemap entries |
| POST | `/v1/events/for-person` | `{topics?, kind?, country?, remote?, withinDays?, limit?}` |
| POST | `/v1/tasks/import` | cron: import and drop ended events |

## Run

```bash
cp .env.example .env
npm ci
npm run migrate
npm start
```

## Tests

Unit tests run without a database (adapters on recorded payloads). Integration
tests run when `DATABASE_URL` is set, on a database prepared as in CI:
`test/sql/pre/*.sql` (the platform stub and the ingestion module's
migration), then `npm run migrate`.
