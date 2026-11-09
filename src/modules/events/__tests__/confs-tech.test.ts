import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  confsTechSource,
  mapConfsTechRow,
  mergeConfsTech,
} from "../adapters/confs-tech";
import { countryCode } from "../adapters/country";
import { parseEventFixture } from "../adapters/fixture";

const now = new Date("2026-10-15T12:00:00.000Z");

/** A real row shape from conferences/2026/javascript.json. */
const cityJs = {
  name: "CityJS Singapore",
  url: "https://singapore.cityjsconf.org",
  startDate: "2027-02-04",
  endDate: "2027-02-06",
  city: "Singapore",
  country: "Singapore",
  online: false,
  locales: "EN",
  cocUrl: "https://singapore.cityjsconf.org/coc",
  cfpUrl: "https://example.com/cfp-form",
  cfpEndDate: "2026-12-31",
  bluesky: "cityjsconf.bsky",
  twitter: "@cityjsconf",
};

describe("confs.tech adapter (D435)", () => {
  it("maps a realistic row into our shape", () => {
    expect(mapConfsTechRow(cityJs, "javascript")).toEqual({
      externalId: "2027-02-04|singapore.cityjsconf.org",
      title: "CityJS Singapore",
      description: "",
      startsAt: "2027-02-04T00:00:00.000Z",
      endsAt: "2027-02-06T23:59:59.000Z",
      allDay: true,
      timeZone: null,
      format: "offline",
      country: "SG",
      city: "Singapore",
      url: "https://singapore.cityjsconf.org/",
      cfpUrl: "https://example.com/cfp-form",
      cfpEndsAt: "2026-12-31T23:59:59.000Z",
      topics: ["dev"],
      kind: "conference",
    });
  });

  it("refuses rows it cannot show safely", () => {
    const refused = [
      { ...cityJs, url: "javascript:alert(1)" },
      { ...cityJs, url: "singapore.cityjsconf.org" },
      { ...cityJs, name: "" },
      { ...cityJs, startDate: "2027-02-30" },
      { ...cityJs, startDate: "next week" },
      { ...cityJs, endDate: "2027-02-01" },
      // In person, but no place at all.
      { ...cityJs, city: undefined, country: undefined, online: false },
    ];
    for (const row of refused) {
      expect(
        mapConfsTechRow(row, "javascript"),
        JSON.stringify(row),
      ).toBeNull();
    }
  });

  it("tells online, hybrid and in-person apart", () => {
    const online = mapConfsTechRow(
      { ...cityJs, online: true, city: undefined, country: undefined },
      "javascript",
    );
    const hybrid = mapConfsTechRow({ ...cityJs, online: true }, "javascript");
    expect(online?.format).toBe("online");
    expect(online?.country).toBeNull();
    expect(hybrid?.format).toBe("hybrid");
  });

  it("adds web3, AI and career topics and the kind from the title", () => {
    const web3 = mapConfsTechRow(
      { ...cityJs, name: "Blockchain Builders Summit" },
      "general",
    );
    expect(web3?.topics).toEqual(["dev", "web3"]);
    expect(web3?.kind).toBe("summit");
    const ai = mapConfsTechRow({ ...cityJs, name: "AI Coding Summit" }, "data");
    expect(ai?.topics).toEqual(["data", "ai"]);
    const career = mapConfsTechRow(
      { ...cityJs, name: "Remote Career Fair Meetup" },
      "leadership",
    );
    expect(career?.kind).toBe("meetup");
    expect(career?.topics).toEqual(["business", "career"]);
    expect(
      mapConfsTechRow(
        { ...cityJs, name: "Product Leaders Business Breakfast" },
        "product",
      )?.kind,
    ).toBe("business");
    // "Ethics" is not Ethereum.
    expect(
      mapConfsTechRow({ ...cityJs, name: "Ethics in Tech" }, "general")?.topics,
    ).toEqual(["dev"]);
  });

  it("merges one conference listed under two topics and drops ended ones", () => {
    const ended = { ...cityJs, startDate: "2026-03-01", endDate: "2026-03-02" };
    const merged = mergeConfsTech(
      [
        { topic: "javascript", rows: [cityJs, ended, "not an object"] },
        { topic: "security", rows: [cityJs] },
        { topic: "broken", rows: { not: "an array" } },
      ],
      now,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.topics).toEqual(["dev", "security"]);
  });

  it("reads every topic file of this year and next, skipping missing ones", async () => {
    const asked: string[] = [];
    const fake = (async (input: string | URL | Request) => {
      const url = String(input);
      asked.push(url);
      if (url.endsWith("/2027/javascript.json")) {
        return new Response(JSON.stringify([cityJs]), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;
    const events = await confsTechSource.fetch(now, fake);
    expect(events.map((event) => event.title)).toEqual(["CityJS Singapore"]);
    expect(asked.some((url) => url.includes("/2026/general.json"))).toBe(true);
    expect(
      asked.every((url) =>
        url.startsWith(
          "https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences/",
        ),
      ),
    ).toBe(true);
  });

  it("fails the run on a server error instead of reading it as empty", async () => {
    const fake = (async () =>
      new Response("oops", { status: 500 })) as unknown as typeof fetch;
    await expect(confsTechSource.fetch(now, fake)).rejects.toThrow(/500/);
  });

  it("keeps the fixture's good rows and refuses the two bad ones", async () => {
    const json = await readFile(
      join(process.cwd(), "fixtures/events/fictional-events.json"),
      "utf8",
    );
    const events = parseEventFixture(json, now);
    expect(events).toHaveLength(6);
    expect(events.map((event) => event.title)).not.toContain(
      "Fictional Event With A Script Link",
    );
    expect(
      events.find((event) => event.title.includes("Business Breakfast"))
        ?.country,
    ).toBe("GB");
  });
});

describe("countryCode", () => {
  it.each([
    ["Germany", "DE"],
    ["U.S.A.", "US"],
    ["U.K.", "GB"],
    ["Netherlands", "NL"],
    ["Czech Republic", "CZ"],
    ["United Arab Emirates", "AE"],
    ["South Korea", "KR"],
    ["de", "DE"],
    ["Atlantis", null],
    ["", null],
    ["zz", null],
  ])("%s → %s", (name, code) => {
    expect(countryCode(name)).toBe(code);
  });
});
