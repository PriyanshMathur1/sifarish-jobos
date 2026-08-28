import { describe, it, expect, vi } from "vitest";
import { HunterClient } from "./hunter.ts";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe("HunterClient.findEmail", () => {
  it("maps a high-score, verified result to HIGH_CONFIDENCE — never VERIFIED", async () => {
    const fetchImpl = fakeFetch(200, {
      data: { email: "a@x.com", score: 97, verification: { status: "valid" } },
    });
    const client = new HunterClient("key", fetchImpl);
    const outcome = await client.findEmail({ domain: "x.com", firstName: "A", lastName: "B" });
    expect(outcome).toEqual({ kind: "found", email: "a@x.com", status: "HIGH_CONFIDENCE" });
  });

  it("maps a mid-score result to PROBABLE", async () => {
    const fetchImpl = fakeFetch(200, { data: { email: "a@x.com", score: 60, verification: null } });
    const client = new HunterClient("key", fetchImpl);
    const outcome = await client.findEmail({ domain: "x.com", firstName: "A", lastName: "B" });
    expect(outcome).toEqual({ kind: "found", email: "a@x.com", status: "PROBABLE" });
  });

  it("maps a low-score result to UNKNOWN rather than discarding it", async () => {
    const fetchImpl = fakeFetch(200, { data: { email: "a@x.com", score: 20, verification: null } });
    const client = new HunterClient("key", fetchImpl);
    const outcome = await client.findEmail({ domain: "x.com", firstName: "A", lastName: "B" });
    expect(outcome).toEqual({ kind: "found", email: "a@x.com", status: "UNKNOWN" });
  });

  it("treats an explicit invalid verification as invalid, not a guess", async () => {
    const fetchImpl = fakeFetch(200, {
      data: { email: "a@x.com", score: 95, verification: { status: "invalid" } },
    });
    const client = new HunterClient("key", fetchImpl);
    const outcome = await client.findEmail({ domain: "x.com", firstName: "A", lastName: "B" });
    expect(outcome).toEqual({ kind: "invalid" });
  });

  it("reports not_found when Hunter has no candidate", async () => {
    const fetchImpl = fakeFetch(200, { data: { email: null } });
    const client = new HunterClient("key", fetchImpl);
    const outcome = await client.findEmail({ domain: "x.com", firstName: "A", lastName: "B" });
    expect(outcome).toEqual({ kind: "not_found" });
  });

  it("reports quota_exceeded on HTTP 429", async () => {
    const fetchImpl = fakeFetch(429, {});
    const client = new HunterClient("key", fetchImpl);
    const outcome = await client.findEmail({ domain: "x.com", firstName: "A", lastName: "B" });
    expect(outcome).toEqual({ kind: "quota_exceeded" });
  });

  it("reports an auth error on HTTP 401 (bad/rotated key)", async () => {
    const fetchImpl = fakeFetch(401, {});
    const client = new HunterClient("key", fetchImpl);
    const outcome = await client.findEmail({ domain: "x.com", firstName: "A", lastName: "B" });
    expect(outcome).toEqual({ kind: "error", detail: "auth" });
  });

  it("reports a network error without throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch;
    const client = new HunterClient("key", fetchImpl);
    const outcome = await client.findEmail({ domain: "x.com", firstName: "A", lastName: "B" });
    expect(outcome).toEqual({ kind: "error", detail: "boom" });
  });
});

describe("HunterClient.verifyEmail", () => {
  it("maps deliverable+valid+high score to HIGH_CONFIDENCE, attaching the input email", async () => {
    const fetchImpl = fakeFetch(200, { data: { status: "valid", result: "deliverable", score: 96 } });
    const client = new HunterClient("key", fetchImpl);
    const outcome = await client.verifyEmail("p@stripe.com");
    expect(outcome).toEqual({ kind: "found", email: "p@stripe.com", status: "HIGH_CONFIDENCE" });
  });

  it("maps undeliverable to invalid", async () => {
    const fetchImpl = fakeFetch(200, { data: { status: "invalid", result: "undeliverable", score: 5 } });
    const client = new HunterClient("key", fetchImpl);
    const outcome = await client.verifyEmail("p@stripe.com");
    expect(outcome).toEqual({ kind: "invalid" });
  });

  it("maps risky/accept-all to PROBABLE", async () => {
    const fetchImpl = fakeFetch(200, { data: { status: "accept_all", result: "risky", score: 55 } });
    const client = new HunterClient("key", fetchImpl);
    const outcome = await client.verifyEmail("p@stripe.com");
    expect(outcome).toEqual({ kind: "found", email: "p@stripe.com", status: "PROBABLE" });
  });
});
