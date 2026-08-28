import { type Result, ok, err } from "../result.ts";
import { normalizeSkill } from "../taxonomy/taxonomy.ts";

/**
 * TemplateRenderer (SPEC §2): deterministic variable substitution — no
 * generative AI (PRD §6/§76). Strict: any unresolved variable blocks the
 * render with its name; nothing is ever silently blanked.
 */

export interface TemplateSource {
  subject: string;
  body: string;
}

export interface RenderedTemplate {
  subject: string;
  body: string;
}

export type TemplateContext = Partial<Record<string, string>>;

const VAR = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi;

export function renderTemplate(
  template: TemplateSource,
  context: TemplateContext,
): Result<RenderedTemplate, { missing: string[] }> {
  const missing = new Set<string>();
  const sub = (text: string) =>
    text.replace(VAR, (_, name: string) => {
      const v = context[name];
      if (v === undefined || v === "") {
        missing.add(name);
        return "";
      }
      return v;
    });
  const subject = sub(template.subject);
  const body = sub(template.body);
  if (missing.size > 0) return err({ missing: [...missing] });
  return ok({ subject, body });
}

/**
 * {{relevant_skill}} resolver: the user's strongest skill that the job
 * actually mentions. Profile order expresses strength; aliases normalized
 * on both sides. Null when nothing intersects — caller asks the user.
 */
export function resolveRelevantSkill(profileSkills: string[], jobText: string): string | null {
  const haystack = jobText.toLowerCase();
  for (const raw of profileSkills) {
    const canonical = normalizeSkill(raw);
    const needles = new Set([raw.toLowerCase(), canonical.toLowerCase()]);
    // Also test known aliases that map to the same canonical (cheap reverse pass).
    for (const needle of needles) {
      if (needle.length >= 2 && haystack.includes(needle)) return canonical;
    }
  }
  // Second pass: alias-normalize individual words of the job text and match canonically.
  const words = haystack.split(/[^a-z0-9+#.]+/).filter(Boolean);
  const jobCanonicals = new Set(words.map((w) => normalizeSkill(w).toLowerCase()));
  for (const raw of profileSkills) {
    const canonical = normalizeSkill(raw);
    if (jobCanonicals.has(canonical.toLowerCase())) return canonical;
  }
  return null;
}

export interface BuiltinTemplate extends TemplateSource {
  kind: "recruiter_intro" | "hm_intro" | "referral" | "followup" | "post_apply";
  name: string;
}

/**
 * Built-in templates (PRD §77) — short, honest, single-recipient. Every
 * word is editable before send; these are starting points, not scripts.
 */
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    kind: "recruiter_intro",
    name: "Recruiter introduction",
    subject: "{{job_title}} — quick intro",
    body: `Hi {{first_name}},

I came across the {{job_title}} opening at {{company}} and wanted to reach out directly. I'm currently a {{current_title}}, and my {{relevant_skill}} background maps closely to what the role calls for.

I've applied through the portal as well — happy to share anything else that's useful. Would you be open to a quick chat?

Best,
{{candidate_name}}`,
  },
  {
    kind: "hm_intro",
    name: "Hiring-manager introduction",
    subject: "Re: {{job_title}} at {{company}}",
    body: `Hi {{first_name}},

I saw the {{job_title}} role on your team at {{company}}. I'm a {{current_title}} with hands-on {{relevant_skill}} experience, and the problems this role owns are exactly the ones I enjoy working on.

If it's useful, I'd love 15 minutes to walk through how I'd approach the first 90 days.

Best,
{{candidate_name}}`,
  },
  {
    kind: "referral",
    name: "Referral request",
    subject: "Referral for {{job_title}} at {{company}}?",
    body: `Hi {{first_name}},

Hope you're doing well. {{company}} has a {{job_title}} opening that fits my background as a {{current_title}} ({{relevant_skill}} in particular). Would you be comfortable referring me, or pointing me to the right person?

Happy to send over my resume and a short blurb to make it easy.

Thanks!
{{candidate_name}}`,
  },
  {
    kind: "followup",
    name: "Follow-up",
    subject: "Following up — {{job_title}}",
    body: `Hi {{first_name}},

Following up on my note about the {{job_title}} role at {{company}} — I know inboxes get busy. Still very interested, and happy to share anything that would help evaluate fit.

Best,
{{candidate_name}}`,
  },
  {
    kind: "post_apply",
    name: "Post-application note",
    subject: "Applied to {{job_title}} — a quick note",
    body: `Hi {{first_name}},

I just applied to the {{job_title}} opening at {{company}} and wanted to put a face to the application. I'm a {{current_title}}, strongest in {{relevant_skill}} — details are in my application.

If there's anything else you need from my side, just say the word.

Best,
{{candidate_name}}`,
  },
];
