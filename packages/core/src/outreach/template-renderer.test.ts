import { describe, expect, it } from "vitest";
import { renderTemplate, resolveRelevantSkill, BUILTIN_TEMPLATES } from "./template-renderer.ts";

const ctx = {
  first_name: "Anita",
  company: "Razorpay",
  job_title: "Senior Product Manager - Payments",
  candidate_name: "Priyansh Mathur",
  current_title: "Product Manager",
  relevant_skill: "Experimentation",
};

describe("renderTemplate — strict variables (SPEC §2 TemplateRenderer)", () => {
  it("substitutes every variable", () => {
    const r = renderTemplate(
      {
        subject: "Re: {{job_title}} at {{company}}",
        body: "Hi {{first_name}},\n— {{candidate_name}}",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.subject).toBe("Re: Senior Product Manager - Payments at Razorpay");
    expect(r.value.body).toBe("Hi Anita,\n— Priyansh Mathur");
  });

  it("an unresolved variable BLOCKS rendering with its name — never silently blank", () => {
    const r = renderTemplate(
      { subject: "x", body: "Hi {{first_name}}, re {{job_title}}" },
      {
        first_name: "Anita",
      },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.missing).toEqual(["job_title"]);
  });

  it("unknown variables in the template are reported, not passed through", () => {
    const r = renderTemplate({ subject: "{{wat}}", body: "ok" }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.missing).toEqual(["wat"]);
  });
});

describe("resolveRelevantSkill — job skills ∩ profile skills (grill G6)", () => {
  it("picks the highest-priority intersection (profile order wins)", () => {
    const skill = resolveRelevantSkill(
      ["Product Management", "Growth", "SQL", "Experimentation"], // profile, strongest first
      "We need experimentation chops, SQL fluency and growth instincts", // job text
    );
    expect(skill).toBe("Growth"); // first profile skill found in the job text
  });

  it("normalizes aliases before intersecting (Postgres → PostgreSQL)", () => {
    const skill = resolveRelevantSkill(["PostgreSQL"], "Experience with postgres required");
    expect(skill).toBe("PostgreSQL");
  });

  it("no overlap → null (caller must ask the user, never invent)", () => {
    expect(resolveRelevantSkill(["Figma"], "We need accountants")).toBeNull();
  });
});

describe("built-in templates (PRD §77)", () => {
  it("ships the five kinds, each rendering cleanly with a full context", () => {
    const kinds = BUILTIN_TEMPLATES.map((t) => t.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["recruiter_intro", "hm_intro", "referral", "followup", "post_apply"]),
    );
    for (const t of BUILTIN_TEMPLATES) {
      const r = renderTemplate(t, ctx);
      expect(r.ok, `${t.kind} should render`).toBe(true);
    }
  });

  it("no template asks for mass-mail primitives — one recipient, no bcc", () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.body).not.toMatch(/\{\{(bcc|recipients|email_list)\}\}/);
    }
  });
});
