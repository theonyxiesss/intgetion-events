import { describe, expect, it } from "vitest";
import { eventDateRange } from "../service/format";
import { eventJsonLd } from "../service/json-ld";
import {
  EVENTS_PAGE_SIZE,
  filterForPerson,
  filterFromQuery,
  formatsFor,
} from "../service/filter";
import { parseEventSearch } from "../schemas/search";
import { isMissingEventsTable } from "../service/queries";

const now = new Date("2026-10-15T12:00:00.000Z");

describe("events table", () => {
  it("treats a missing events table as not there yet (D435)", () => {
    expect(isMissingEventsTable({ code: "42P01" })).toBe(true);
    expect(
      isMissingEventsTable(new Error('relation "events" does not exist')),
    ).toBe(true);
    expect(isMissingEventsTable(new Error("timeout"))).toBe(false);
  });
});

describe("events page query (D435)", () => {
  it("parses a full query and keeps it", () => {
    const query = parseEventSearch({
      q: " rust ",
      topic: "web3",
      kind: "meetup",
      format: "online",
      country: "de",
      from: "2026-11-01",
      to: "2026-12-31",
      page: "2",
    });
    expect(query).toEqual({
      q: "rust",
      topic: "web3",
      kind: "meetup",
      format: "online",
      country: "DE",
      from: "2026-11-01",
      to: "2026-12-31",
      page: 2,
    });
  });

  it("drops bad values one by one instead of the whole query", () => {
    const query = parseEventSearch({
      topic: "gaming",
      kind: "meetup",
      country: "Germany",
      from: "yesterday",
      page: "999",
      extra: "x",
    });
    expect(query).toEqual({ kind: "meetup", page: 1 });
  });

  it("treats empty form fields as no filter", () => {
    expect(
      parseEventSearch({ topic: "", kind: "", format: "", country: "", q: "" }),
    ).toEqual({ page: 1 });
  });

  it("never shows past events, even when asked from an old date", () => {
    const filter = filterFromQuery(
      parseEventSearch({ from: "2020-01-01" }),
      now,
    );
    expect(filter.from).toEqual(now);
    expect(filter.to).toBeNull();
    const later = filterFromQuery(
      parseEventSearch({ from: "2026-12-01", to: "2026-12-31" }),
      now,
    );
    expect(later.from.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(later.to?.toISOString()).toBe("2026-12-31T23:59:59.999Z");
  });

  it("pages by a fixed size and maps filters to lists", () => {
    const filter = filterFromQuery(
      parseEventSearch({
        topic: "ai",
        kind: "summit",
        format: "offline",
        page: "3",
      }),
      now,
    );
    expect(filter).toMatchObject({
      topics: ["ai"],
      kinds: ["summit"],
      formats: ["offline", "hybrid"],
      country: null,
      orRemote: false,
      limit: EVENTS_PAGE_SIZE,
      offset: 2 * EVENTS_PAGE_SIZE,
    });
  });

  it("counts hybrid as both online and in person", () => {
    expect(formatsFor("online")).toEqual(["online", "hybrid"]);
    expect(formatsFor("offline")).toEqual(["offline", "hybrid"]);
    expect(formatsFor("hybrid")).toEqual(["hybrid"]);
    expect(formatsFor(undefined)).toEqual([]);
  });
});

describe("Spoki's event filter (D435)", () => {
  it("a remote person in a country: their country or anything remote", () => {
    expect(
      filterForPerson(
        { topics: ["web3", "web3"], country: "pt", remote: true },
        now,
      ),
    ).toMatchObject({
      topics: ["web3"],
      country: "PT",
      orRemote: true,
      formats: [],
      limit: 5,
    });
  });

  it("no country: online and hybrid only", () => {
    expect(filterForPerson({}, now)).toMatchObject({
      country: null,
      orRemote: false,
      formats: ["online", "hybrid"],
    });
  });

  it("on-site in a country: that country only", () => {
    expect(
      filterForPerson({ country: "DE", remote: false }, now),
    ).toMatchObject({ country: "DE", orRemote: false, formats: [] });
  });

  it("looks four months ahead and caps the list", () => {
    const filter = filterForPerson({ limit: 99 }, now);
    expect(filter.limit).toBe(10);
    expect(filter.to?.toISOString()).toBe("2027-02-12T12:00:00.000Z");
  });
});

describe("event dates and JSON-LD (D435)", () => {
  const event = {
    title: "Fictional Web3 Builders Summit",
    description: "",
    startsAt: new Date("2026-11-12T00:00:00.000Z"),
    endsAt: new Date("2026-11-13T23:59:59.000Z"),
    allDay: true,
    timeZone: null,
    format: "hybrid",
    country: "PT",
    city: "Lisbon",
    url: "https://example.com/web3-builders-summit",
  };

  // ICU puts thin spaces around the dash; compare with plain spaces.
  const plain = (text: string) => text.replace(/\s/g, " ");

  it("shows whole days without sliding to the day before", () => {
    expect(plain(eventDateRange(event, "en-US"))).toBe("Nov 12 – 13, 2026");
    expect(
      plain(
        eventDateRange(
          { ...event, endsAt: new Date("2026-11-12T23:59:59.000Z") },
          "en-US",
        ),
      ),
    ).toBe("Nov 12, 2026");
  });

  it("describes the event for search with a mixed location", () => {
    const data = eventJsonLd(
      event,
      "https://intgetion.com/events/x",
      "Summit · Nov 12 – 13, 2026 · Lisbon, Portugal",
    );
    expect(data).toMatchObject({
      "@type": "Event",
      "@id": "https://intgetion.com/events/x",
      name: "Fictional Web3 Builders Summit",
      startDate: "2026-11-12",
      endDate: "2026-11-13",
      eventAttendanceMode: "https://schema.org/MixedEventAttendanceMode",
      url: "https://example.com/web3-builders-summit",
      description: "Summit · Nov 12 – 13, 2026 · Lisbon, Portugal",
    });
    expect(Array.isArray(data.location)).toBe(true);
    const online = eventJsonLd(
      { ...event, format: "online", city: null, country: null },
      "https://intgetion.com/events/x",
      "s",
    );
    expect(online.location).toEqual({
      "@type": "VirtualLocation",
      url: "https://example.com/web3-builders-summit",
    });
  });
});
