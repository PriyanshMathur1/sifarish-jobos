import { describe, expect, it, vi } from "vitest";
import { SafeFetcher, type ResolveFn } from "./safe-fetcher.ts";

/** Test doubles injected at the seam: resolver + fetch + sleep. */
const publicIp: ResolveFn = async () => ["93.184.216.34"];
const okResponse = (body = "ok", status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

function fetcher(overrides: Partial<ConstructorParameters<typeof SafeFetcher>[0]> = {}) {
  return new SafeFetcher({
    resolve: publicIp,
    fetchImpl: async () => okResponse(),
    sleep: async () => {},
    timeoutMs: 1000,
    maxBodyBytes: 1024 * 1024,
    maxRetries: 2,
    breakerThreshold: 3,
    breakerCooldownMs: 60_000,
    now: () => 0,
    ...overrides,
  });
}

describe("SafeFetcher — SSRF guard", () => {
  const blockedUrls: Array<[string, string]> = [
    ["ftp://example.com/x", "scheme"],
    ["file:///etc/passwd", "scheme"],
    ["gopher://example.com", "scheme"],
  ];
  it.each(blockedUrls)("rejects %s (%s)", async (url) => {
    const f = fetcher();
    const r = await f.fetch(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("blocked");
  });

  const privateIps: string[] = [
    "127.0.0.1",
    "10.0.0.8",
    "172.16.5.5",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:10.0.0.1", // v4-mapped private
  ];
  it.each(privateIps)("rejects hostnames resolving to %s", async (ip) => {
    const f = fetcher({ resolve: async () => [ip] });
    const r = await f.fetch("https://evil.example.com/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("blocked");
  });

  it("rejects when ANY resolved address is private (dns rebinding)", async () => {
    const f = fetcher({ resolve: async () => ["93.184.216.34", "10.0.0.1"] });
    const r = await f.fetch("https://evil.example.com/");
    expect(r.ok).toBe(false);
  });

  it("rejects IP literals without consulting the resolver", async () => {
    const resolve = vi.fn(publicIp);
    const f = fetcher({ resolve });
    const r = await f.fetch("http://169.254.169.254/latest/meta-data/");
    expect(r.ok).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("allows public hosts", async () => {
    const f = fetcher();
    const r = await f.fetch("https://boards-api.greenhouse.io/v1/boards/x/jobs");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe(200);
  });

  it("re-validates every redirect hop and blocks redirects into private space", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "http://internal.corp/admin" } }),
      );
    const resolve: ResolveFn = vi
      .fn()
      .mockResolvedValueOnce(["93.184.216.34"]) // original host: public
      .mockResolvedValueOnce(["192.168.0.10"]); // redirect target: private
    const f = fetcher({ fetchImpl, resolve });
    const r = await f.fetch("https://ok.example.com/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("blocked");
  });

  it("follows safe redirects up to the hop limit", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: "https://ok.example.com/2" } }),
      )
      .mockResolvedValueOnce(okResponse("landed"));
    const f = fetcher({ fetchImpl });
    const r = await f.fetch("https://ok.example.com/1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.body).toBe("landed");
  });
});

describe("SafeFetcher — resilience", () => {
  it("retries 5xx with backoff then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okResponse("err", 500))
      .mockResolvedValueOnce(okResponse("fine", 200));
    const sleep = vi.fn(async () => {});
    const f = fetcher({ fetchImpl, sleep });
    const r = await f.fetch("https://ok.example.com/");
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does not retry 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse("nope", 404));
    const f = fetcher({ fetchImpl });
    const r = await f.fetch("https://ok.example.com/");
    expect(r.ok).toBe(true); // 404 is a valid response, caller decides
    if (r.ok) expect(r.value.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxRetries and reports httpError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse("err", 503));
    const f = fetcher({ fetchImpl, maxRetries: 2 });
    const r = await f.fetch("https://ok.example.com/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("http");
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("opens the circuit breaker after consecutive failures and short-circuits", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const f = fetcher({ fetchImpl, maxRetries: 0, breakerThreshold: 2 });
    await f.fetch("https://down.example.com/");
    await f.fetch("https://down.example.com/");
    const callsBefore = fetchImpl.mock.calls.length;
    const r = await f.fetch("https://down.example.com/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("breakerOpen");
    expect(fetchImpl.mock.calls.length).toBe(callsBefore); // no network hit
  });

  it("breaker recovers after cooldown", async () => {
    let t = 0;
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("x"))
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValue(okResponse());
    const f = fetcher({
      fetchImpl,
      maxRetries: 0,
      breakerThreshold: 2,
      breakerCooldownMs: 1000,
      now: () => t,
    });
    await f.fetch("https://down.example.com/");
    await f.fetch("https://down.example.com/");
    t = 2000; // past cooldown
    const r = await f.fetch("https://down.example.com/");
    expect(r.ok).toBe(true);
  });

  it("truncates bodies at maxBodyBytes", async () => {
    const f = fetcher({
      fetchImpl: async () => okResponse("a".repeat(100)),
      maxBodyBytes: 10,
    });
    const r = await f.fetch("https://ok.example.com/");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.body.length).toBe(10);
  });

  it("rate-limits per host via the token bucket", async () => {
    const sleep = vi.fn(async () => {});
    const f = fetcher({ sleep, ratePerHostPerSec: 2, burst: 2 });
    await f.fetch("https://ok.example.com/1");
    await f.fetch("https://ok.example.com/2");
    await f.fetch("https://ok.example.com/3"); // bucket empty → waits
    expect(sleep).toHaveBeenCalled();
  });
});
