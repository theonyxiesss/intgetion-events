/** Spellings the feeds use that Intl does not know by name. */
const ALIASES: Record<string, string> = {
  "u.s.a.": "US",
  usa: "US",
  "united states of america": "US",
  "u.k.": "GB",
  uk: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "the netherlands": "NL",
  holland: "NL",
  "czech republic": "CZ",
  "south korea": "KR",
  korea: "KR",
  turkey: "TR",
  uae: "AE",
  russia: "RU",
  vietnam: "VN",
};

/** User-assigned and supranational codes Intl still names (ZZ, EU, UN…). */
const NOT_COUNTRIES = /^(AA|Q[M-Z]|X[A-Z]|ZZ|EU|EZ|UN)$/;

let regions: { byName: Map<string, string>; codes: Set<string> } | null = null;

/** English region names from Intl, built once. */
function regionTable() {
  if (regions) return regions;
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const byName = new Map<string, string>();
  const codes = new Set<string>();
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const a of letters) {
    for (const b of letters) {
      const code = `${a}${b}`;
      if (NOT_COUNTRIES.test(code)) continue;
      const name = names.of(code);
      if (!name || name === code) continue;
      byName.set(name.toLowerCase(), code);
      codes.add(code);
    }
  }
  regions = { byName, codes };
  return regions;
}

/** ISO 3166-1 alpha-2 for a country name or code, or null when unsure. */
export function countryCode(name: string | null | undefined): string | null {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return null;
  const alias = ALIASES[key];
  if (alias) return alias;
  const table = regionTable();
  if (/^[a-z]{2}$/.test(key)) {
    const code = key.toUpperCase();
    return table.codes.has(code) ? code : null;
  }
  return table.byName.get(key) ?? null;
}
