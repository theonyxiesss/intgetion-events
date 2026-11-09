import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const token = "test-token";
const app = createApp({ serviceToken: token });
const auth = { authorization: `Bearer ${token}` };
const call = (path: string, init: RequestInit = {}) => app(new Request(`http://events${path}`, init));

describe("events http", () => {
  it("serves health without a token and refuses a missing one", async () => {
    expect((await call("/health")).status).toBe(200);
    expect((await call("/v1/events")).status).toBe(401);
  });
  it("rejects a bad person filter and unknown routes", async () => {
    const bad = await call("/v1/events/for-person", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ topics: ["cooking"] }),
    });
    expect(bad.status).toBe(400);
    expect((await call("/v1/nothing", { headers: auth })).status).toBe(404);
  });
});
