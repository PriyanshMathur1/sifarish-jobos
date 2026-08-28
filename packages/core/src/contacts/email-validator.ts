import { resolveMx as dnsResolveMx } from "node:dns/promises";

/**
 * EmailValidator (PRD §72–73): syntax → domain → MX (cached), mapped to the
 * five allowed statuses. No SMTP probing — it's abusive and unreliable.
 *
 * Status semantics:
 *   VERIFIED        only for OBSERVED addresses (user-supplied or read from
 *                   a public page) that pass checks. Inference can never
 *                   produce it — the invariant the tests pin down.
 *   HIGH_CONFIDENCE company-pattern candidates with ≥2 evidence + MX ok
 *   PROBABLE        any other candidate that passes syntax + MX
 *   UNKNOWN         checks could not run (e.g. DNS unreachable)
 *   INVALID         failed syntax or a definitive no-MX answer
 */

export type EmailStatus = "VERIFIED" | "HIGH_CONFIDENCE" | "PROBABLE" | "UNKNOWN" | "INVALID";

export interface ValidationInput {
  origin: "observed" | "company_pattern" | "generated";
  evidenceCount?: number;
}

export interface ValidationResult {
  status: EmailStatus;
  checks: { syntax: boolean; mx: boolean | null };
}

const SYNTAX =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9._%+-]*[a-zA-Z0-9_%+-])?@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/;

export class EmailValidator {
  private mxCache = new Map<string, string[] | "error">();
  private resolveMx: (domain: string) => Promise<string[]>;

  constructor(opts: { resolveMx?: (domain: string) => Promise<string[]> } = {}) {
    this.resolveMx =
      opts.resolveMx ?? (async (d) => (await dnsResolveMx(d)).map((r) => r.exchange));
  }

  async validate(email: string, input: ValidationInput): Promise<ValidationResult> {
    if (!SYNTAX.test(email) || email.split("@").length !== 2) {
      return { status: "INVALID", checks: { syntax: false, mx: null } };
    }
    const domain = email.split("@")[1]!.toLowerCase();

    let mx = this.mxCache.get(domain);
    if (mx === undefined) {
      try {
        mx = await this.resolveMx(domain);
      } catch {
        mx = "error";
      }
      this.mxCache.set(domain, mx);
    }

    if (mx === "error") {
      return { status: "UNKNOWN", checks: { syntax: true, mx: null } };
    }
    if (mx.length === 0) {
      return { status: "INVALID", checks: { syntax: true, mx: false } };
    }

    const checks = { syntax: true, mx: true };
    switch (input.origin) {
      case "observed":
        return { status: "VERIFIED", checks };
      case "company_pattern":
        return {
          status: (input.evidenceCount ?? 0) >= 2 ? "HIGH_CONFIDENCE" : "PROBABLE",
          checks,
        };
      case "generated":
        return { status: "PROBABLE", checks };
    }
  }
}
