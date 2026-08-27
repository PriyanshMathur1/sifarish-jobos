import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  AUTH_SECRET: "0123456789abcdef",
  CRON_SECRET: "cron-secret",
} as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("boots with only required vars — every optional integration absent", () => {
    const c = loadConfig({ ...base });
    expect(c.APP_TZ).toBe("Asia/Kolkata");
    expect(c.JOB_REFRESH_SCHEDULE).toBe("0 3,15 * * *");
    expect(c.MARKET_COUNTRIES).toEqual(["IN"]);
    expect(c.OUTREACH_DIRECT_SEND).toBe(false);
    expect(c.OUTREACH_DAILY_SEND_CAP).toBe(25);
  });

  it("fails fast naming the missing variable", () => {
    const { DATABASE_URL: _omit, ...rest } = base;
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it("parses MARKET_COUNTRIES as a normalized list", () => {
    const c = loadConfig({ ...base, MARKET_COUNTRIES: "in, sg" });
    expect(c.MARKET_COUNTRIES).toEqual(["IN", "SG"]);
  });

  it("rejects a malformed TOKEN_ENCRYPTION_KEY", () => {
    expect(() => loadConfig({ ...base, TOKEN_ENCRYPTION_KEY: "short" })).toThrow(
      /TOKEN_ENCRYPTION_KEY/,
    );
  });

  it("treats flags as false unless explicitly true", () => {
    expect(loadConfig({ ...base, CONTACT_DISCOVERY: "yes" }).CONTACT_DISCOVERY).toBe(false);
    expect(loadConfig({ ...base, CONTACT_DISCOVERY: "true" }).CONTACT_DISCOVERY).toBe(true);
    expect(loadConfig({ ...base, CONTACT_DISCOVERY: "1" }).CONTACT_DISCOVERY).toBe(true);
  });
});
