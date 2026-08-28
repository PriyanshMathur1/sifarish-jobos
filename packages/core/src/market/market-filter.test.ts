import { describe, expect, it } from "vitest";
import { classifyMarket } from "./market-filter.ts";

/**
 * MarketFilter (grill G2): keep a job if any location resolves to a market
 * country, OR it's remote and eligible from the market; unstated-region
 * remote is kept but flagged; everything else is rejected at ingest.
 */
const IN = ["IN"];

describe("classifyMarket for MARKET_COUNTRIES=IN", () => {
  it.each([
    // [locations, remoteType, expected]
    [["Bengaluru, India"], "onsite", "IN_CONFIRMED"],
    [["Bangalore"], "hybrid", "IN_CONFIRMED"],
    [["Mumbai", "Singapore"], "onsite", "IN_CONFIRMED"], // any-location rule
    [["India"], null, "IN_CONFIRMED"],
    [["Remote - India"], "remote", "IN_CONFIRMED"],
    [["Remote"], "remote", "REMOTE_UNVERIFIED"], // unstated region: kept + flagged
    [[], "remote", "REMOTE_UNVERIFIED"],
    [["Anywhere"], null, "REMOTE_UNVERIFIED"],
    [["Remote (APAC)"], "remote", "IN_CONFIRMED"], // APAC counts as India-eligible
    [["Remote (US only)"], "remote", "REJECT"],
    [["Remote - Europe"], "remote", "REJECT"],
    [["San Francisco"], "onsite", "REJECT"],
    [["London, UK"], "hybrid", "REJECT"],
    [["New York City", "London"], "onsite", "REJECT"],
  ] as const)("%j %s → %s", (locations, remoteType, expected) => {
    expect(classifyMarket([...locations], remoteType, IN)).toBe(expected);
  });

  it("unknown non-remote locations are rejected, not guessed (never fabricate)", () => {
    expect(classifyMarket(["Atlantis HQ"], "onsite", IN)).toBe("REJECT");
  });

  it("unknown location + remote job → REMOTE_UNVERIFIED (we don't know, we say so)", () => {
    expect(classifyMarket(["Atlantis HQ"], "remote", IN)).toBe("REMOTE_UNVERIFIED");
  });

  it("respects multiple market countries", () => {
    expect(classifyMarket(["Singapore"], "onsite", ["IN", "SG"])).toBe("IN_CONFIRMED");
  });
});
