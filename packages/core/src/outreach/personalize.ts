import { logger } from "../logger.ts";

/**
 * Optional LLM personalisation (AUTOPILOT-PLAN A6). Off unless
 * LLM_PERSONALISATION=true and ANTHROPIC_API_KEY is set. Output is a
 * suggestion shown in an editable preview; nothing generated is ever sent
 * or submitted without the user seeing it. Deterministic templates remain
 * the default (grill G6).
 */

export interface PersonalizeInput {
  candidate: { name: string | null; title: string | null; skills: string[]; yearsExperience: number | null };
  job: { title: string; company: string; description: string | null };
  contact?: { name: string; title: string | null } | null;
}

export interface Personalizer {
  openingLine(input: PersonalizeInput): Promise<string | null>;
  coverLetter(input: PersonalizeInput): Promise<string | null>;
}

const MODEL = "claude-sonnet-4-5";

export class AnthropicPersonalizer implements Personalizer {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async complete(system: string, user: string, maxTokens: number): Promise<string | null> {
    try {
      const res = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, "personalizer api error");
        return null;
      }
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = data.content?.find((c) => c.type === "text")?.text?.trim();
      return text || null;
    } catch (err) {
      logger.warn({ err }, "personalizer failed");
      return null;
    }
  }

  private context(i: PersonalizeInput): string {
    const jd = (i.job.description ?? "").replace(/\s+/g, " ").slice(0, 3000);
    return [
      `Candidate: ${i.candidate.name ?? "the candidate"}, ${i.candidate.title ?? "unknown title"}, ${i.candidate.yearsExperience ?? "?"} years, skills: ${i.candidate.skills.slice(0, 8).join(", ") || "not listed"}.`,
      `Role: ${i.job.title} at ${i.job.company}.`,
      i.contact ? `Recipient: ${i.contact.name}${i.contact.title ? `, ${i.contact.title}` : ""}.` : "",
      `Job description: ${jd || "(none provided)"}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async openingLine(i: PersonalizeInput): Promise<string | null> {
    return this.complete(
      "You write one specific, plain opening sentence for a cold email from a job candidate to someone at a company. No flattery, no exclamation marks, no em dashes, no buzzwords, no claims the candidate did not state. Refer to one concrete thing from the job description. Under 30 words. Output only the sentence.",
      this.context(i),
      120,
    );
  }

  async coverLetter(i: PersonalizeInput): Promise<string | null> {
    return this.complete(
      "You write a short cover letter (120 to 170 words, three short paragraphs, plain text, no em dashes, no bullet points, no exclamation marks) from a job candidate. Use only facts given about the candidate; never invent employers, metrics, or achievements. Tie two of the candidate's stated skills to two concrete needs in the job description. End with one sentence offering a conversation. Do not include a greeting line or a signature; the app adds those.",
      this.context(i),
      500,
    );
  }
}

/** No-op personalizer for when the flag is off. */
export class NullPersonalizer implements Personalizer {
  async openingLine(): Promise<string | null> {
    return null;
  }
  async coverLetter(): Promise<string | null> {
    return null;
  }
}

export function buildPersonalizer(config: {
  LLM_PERSONALISATION: boolean;
  ANTHROPIC_API_KEY?: string | undefined;
}): Personalizer {
  return config.LLM_PERSONALISATION && config.ANTHROPIC_API_KEY
    ? new AnthropicPersonalizer(config.ANTHROPIC_API_KEY)
    : new NullPersonalizer();
}
