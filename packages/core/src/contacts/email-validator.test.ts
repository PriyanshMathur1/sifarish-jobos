import { describe, expect, it } from "vitest";
import { EmailValidator } from "./email-validator.ts";

const mx =
  (table: Record<string, string[] | Error>) =>
  async (domain: string): Promise<string[]> => {
    const v = table[domain];
    if (!v) return [];
    if (v instanceof Error) throw v;
    return v;
  };

describe("EmailValidator (PRD §72–73)", () => {
  it("rejects malformed syntax as INVALID without touching DNS", async () => {
    const v = new EmailValidator({ resolveMx: mx({}) });
    for (const bad of ["nope", "a@", "@x.com", "a b@x.com", "a@@x.com"]) {
      const r = await v.validate(bad, { origin: "generated" });
      expect(r.status).toBe("INVALID");
      expect(r.checks.syntax).toBe(false);
    }
  });

  it("domain with no MX → INVALID", async () => {
    const v = new EmailValidator({ resolveMx: mx({ "dead.com": [] }) });
    const r = await v.validate("a@dead.com", { origin: "generated" });
    expect(r.status).toBe("INVALID");
    expect(r.checks.mx).toBe(false);
  });

  it("DNS failure (network down) → UNKNOWN, never INVALID (don't fabricate certainty)", async () => {
    const v = new EmailValidator({ resolveMx: mx({ "acme.com": new Error("ETIMEOUT") }) });
    const r = await v.validate("a@acme.com", { origin: "generated" });
    expect(r.status).toBe("UNKNOWN");
  });

  it("generated guess + MX ok → PROBABLE, never higher", async () => {
    const v = new EmailValidator({ resolveMx: mx({ "acme.com": ["mx1.acme.com"] }) });
    const r = await v.validate("anita.desai@acme.com", { origin: "generated" });
    expect(r.status).toBe("PROBABLE");
  });

  it("company-pattern candidate with evidence ≥2 + MX ok → HIGH_CONFIDENCE", async () => {
    const v = new EmailValidator({ resolveMx: mx({ "acme.com": ["mx1.acme.com"] }) });
    const r = await v.validate("adesai@acme.com", {
      origin: "company_pattern",
      evidenceCount: 3,
    });
    expect(r.status).toBe("HIGH_CONFIDENCE");
  });

  it("INVARIANT: no inferred origin can EVER yield VERIFIED", async () => {
    const v = new EmailValidator({ resolveMx: mx({ "acme.com": ["mx1.acme.com"] }) });
    for (const origin of ["generated", "company_pattern"] as const) {
      const r = await v.validate("x@acme.com", { origin, evidenceCount: 99 });
      expect(r.status).not.toBe("VERIFIED");
    }
  });

  it("observed origin (user-supplied / public page) + MX ok → VERIFIED", async () => {
    const v = new EmailValidator({ resolveMx: mx({ "acme.com": ["mx1.acme.com"] }) });
    const r = await v.validate("real.person@acme.com", { origin: "observed" });
    expect(r.status).toBe("VERIFIED");
  });

  it("MX results are cached per domain", async () => {
    let calls = 0;
    const v = new EmailValidator({
      resolveMx: async () => {
        calls++;
        return ["mx1.acme.com"];
      },
    });
    await v.validate("a@acme.com", { origin: "generated" });
    await v.validate("b@acme.com", { origin: "generated" });
    expect(calls).toBe(1);
  });
});
