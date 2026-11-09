import { describe, expect, it } from "vitest";
import {
  ccfddlSource,
  mapCcfddl,
  mapCcfddlConference,
  parseCcfddlDates,
  parseCcfddlPlace,
} from "../adapters/ccfddl";

const now = new Date("2026-10-15T12:00:00.000Z");

/** A real series from ccfddl.github.io/conference/allconf.json. */
const aaai = {
  title: "AAAI",
  description: "AAAI Conference on Artificial Intelligence",
  sub: "AI",
  rank: { ccf: "A", core: "A*", thcpl: "A" },
  dblp: "aaai",
  confs: [
    {
      year: 2026,
      id: "aaai26",
      link: "https://aaai.org/conference/aaai/aaai-26/",
      timeline: [{ deadline: "2025-08-01 23:59:59" }],
      timezone: "UTC-12",
      date: "January 22-25, 2026",
      place: "Singapore EXPO",
    },
    {
      year: 2027,
      id: "aaai27",
      link: "https://aaai.org/conference/aaai/aaai-27/",
      timeline: [
        {
          abstract_deadline: "2026-07-21 23:59:59",
          deadline: "2026-07-28 23:59:59",
          rebuttal_deadline: "2026-10-25 23:59:59",
        },
      ],
      timezone: "UTC-12",
      date: "February 16-23, 2027",
      place: "Montréal, Québec, Canada",
      opening: "2027-02-16 08:00:00",
    },
  ],
};

describe("ccfddl adapter", () => {
  it("maps a realistic conference year into our shape", () => {
    expect(mapCcfddlConference(aaai, aaai.confs[1], now)).toEqual({
      externalId: "aaai27",
      title: "AAAI 2027",
      description: "AAAI Conference on Artificial Intelligence",
      startsAt: "2027-02-16T00:00:00.000Z",
      endsAt: "2027-02-23T23:59:59.000Z",
      allDay: true,
      timeZone: null,
      format: "offline",
      country: "CA",
      city: "Montréal",
      url: "https://aaai.org/conference/aaai/aaai-27/",
      // The paper deadline has passed.
      cfpUrl: null,
      cfpEndsAt: null,
      topics: ["ai"],
      kind: "conference",
    });
  });

  it("keeps the next paper deadline, converted from the series' zone", () => {
    const event = mapCcfddlConference(
      {
        title: "USENIX Security",
        description: "USENIX Security Symposium",
        sub: "SC",
      },
      {
        year: 2027,
        id: "uss27",
        link: "https://www.usenix.org/conference/usenixsecurity27",
        timeline: [
          { deadline: "2026-08-26 23:59:59" },
          { deadline: "2027-01-14 23:59:59" },
        ],
        timezone: "AoE",
        date: "August 11-13, 2027",
        place: "Baltimore, MD, USA",
      },
      now,
    );
    expect(event?.cfpEndsAt).toBe("2027-01-15T11:59:59.000Z");
    expect(event?.cfpUrl).toBe(
      "https://www.usenix.org/conference/usenixsecurity27",
    );
    expect(event?.topics).toEqual(["security"]);
    expect(event?.country).toBe("US");
  });

  it("reads the date spellings the data uses", () => {
    expect(parseCcfddlDates("March 31-April 2, 2027")).toEqual({
      start: "2027-03-31",
      end: "2027-04-02",
    });
    expect(parseCcfddlDates("June 28 - July 2, 2027")).toEqual({
      start: "2027-06-28",
      end: "2027-07-02",
    });
    expect(parseCcfddlDates("December 30, 2026 - January 2, 2027")).toEqual({
      start: "2026-12-30",
      end: "2027-01-02",
    });
    expect(parseCcfddlDates("Sept. 9, 2027")).toEqual({
      start: "2027-09-09",
      end: "2027-09-09",
    });
    expect(parseCcfddlDates("December 6-9, 2027 (To be confirmed)")).toEqual({
      start: "2027-12-06",
      end: "2027-12-09",
    });
    expect(parseCcfddlDates("TBD")).toBeNull();
    expect(parseCcfddlDates("February 30-31, 2027")).toBeNull();
    expect(parseCcfddlDates("July 9-7, 2027")).toBeNull();
  });

  it("reads place, country and format", () => {
    expect(
      parseCcfddlPlace("San Diego, California, United States (Hybrid)"),
    ).toEqual({ city: "San Diego", country: "US", format: "hybrid" });
    expect(parseCcfddlPlace("Edinburgh, Scotland, UK")).toEqual({
      city: "Edinburgh",
      country: "GB",
      format: "offline",
    });
    expect(parseCcfddlPlace("Virtual")).toEqual({
      city: null,
      country: null,
      format: "online",
    });
  });

  it("refuses rows it cannot show", () => {
    const base = aaai.confs[1];
    const series = { title: "AAAI", description: "AAAI", sub: "AI" };
    expect(
      mapCcfddlConference(series, { ...base, date: "TBD" }, now),
    ).toBeNull();
    expect(
      mapCcfddlConference(
        series,
        { ...base, link: "javascript:alert(1)" },
        now,
      ),
    ).toBeNull();
    expect(
      mapCcfddlConference(series, { ...base, place: "TBD" }, now),
    ).toBeNull();
    expect(mapCcfddlConference(series, { ...base, id: "" }, now)).toBeNull();
  });

  it("lists only conferences that have not ended, once each", () => {
    const events = mapCcfddl([aaai, aaai, null, { confs: "x" }], now);
    expect(events.map((event) => event.externalId)).toEqual(["aaai27"]);
  });

  it("fails loudly when the file is not a list", async () => {
    expect(() => mapCcfddl({ error: "rate limited" }, now)).toThrow(/ccfddl/);
    const fetchImpl = (async () =>
      new Response(JSON.stringify([aaai]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const events = await ccfddlSource.fetch(now, fetchImpl);
    expect(events).toHaveLength(1);
    expect(ccfddlSource.sourceName).toBe("ccfddl");
  });
});
