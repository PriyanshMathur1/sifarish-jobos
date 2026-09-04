import { z } from "zod";

/**
 * Thin API client for the runner. Everything is owner-scoped server-side by
 * the device token; the runner never sees another user's data.
 */

const attemptSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  mode: z.enum(["confirm", "handsoff"]),
  formUrl: z.string().nullable(),
  provider: z.string().nullable(),
  attempts: z.number(),
  jobTitle: z.string(),
  companyName: z.string(),
  jobStatus: z.string(),
});

export const bundleSchema = z.object({
  runner: z.string(),
  email: z.string().nullable(),
  rules: z.object({ mode: z.enum(["confirm", "handsoff"]), dailyCap: z.number(), submittedToday: z.number(), remaining: z.number() }),
  profile: z
    .object({
      fullName: z.string().nullable(),
      currentTitle: z.string().nullable(),
      phone: z.string().nullable(),
      linkedinUrl: z.string().nullable(),
      portfolioUrl: z.string().nullable(),
      currentLocation: z.string().nullable(),
      noticePeriodDays: z.number().nullable(),
      currentCtcLpa: z.number().nullable(),
      expectedCtcLpa: z.number().nullable(),
      workAuthorization: z.string().nullable(),
      willingToRelocate: z.boolean().nullable(),
      yearsExperience: z.number().nullable(),
    })
    .nullable(),
  answers: z.array(z.object({ question: z.string(), key: z.string(), answer: z.string() })),
  resume: z.object({ id: z.string(), fileName: z.string(), mime: z.string() }).nullable(),
  attempts: z.array(attemptSchema),
});

export type Bundle = z.infer<typeof bundleSchema>;
export type Attempt = z.infer<typeof attemptSchema>;
export type Profile = NonNullable<Bundle["profile"]>;
export type Answer = Bundle["answers"][number];

export interface Report {
  status: "SUBMITTED" | "BLOCKED" | "FAILED" | "SKIPPED";
  blocker?: "captcha" | "login_wall" | "unknown_question" | "unsupported" | "no_resume" | "error" | "removed" | "timeout" | null;
  blockerQuestion?: string | null;
  questions?: string[];
  error?: string | null;
  formUrl?: string | null;
  screenshot?: string | null;
}

export class SifarishClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json", ...(init.headers ?? {}) },
    });
    return res;
  }

  async queue(limit: number): Promise<Bundle> {
    const res = await this.call(`/api/runner/queue?limit=${limit}`);
    if (res.status === 401) throw new Error("Device token rejected. Create a new one on the Apply page.");
    if (!res.ok) throw new Error(`queue: HTTP ${res.status}`);
    return bundleSchema.parse(await res.json());
  }

  async claim(attemptId: string): Promise<boolean> {
    const res = await this.call(`/api/runner/attempts/${attemptId}`, { method: "POST" });
    return res.ok;
  }

  async report(attemptId: string, report: Report): Promise<void> {
    const res = await this.call(`/api/runner/attempts/${attemptId}`, { method: "PUT", body: JSON.stringify(report) });
    if (!res.ok) throw new Error(`report: HTTP ${res.status}`);
  }

  async resume(resumeId: string): Promise<Buffer> {
    const res = await this.call(`/api/runner/resume/${resumeId}`);
    if (!res.ok) throw new Error(`resume: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
