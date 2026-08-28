/**
 * Built-in outreach templates (PRD §77) — mirrored from
 * @jobos/core/outreach/template-renderer BUILTIN_TEMPLATES (db cannot import
 * core without a dependency cycle; the contract test in core keeps the two
 * in sync by kind).
 */
export const BUILTIN_TEMPLATE_SEEDS = [
  {
    kind: "recruiter_intro" as const,
    name: "Recruiter introduction",
    subject: "{{job_title}} — quick intro",
    body: `Hi {{first_name}},

I came across the {{job_title}} opening at {{company}} and wanted to reach out directly. I'm currently a {{current_title}}, and my {{relevant_skill}} background maps closely to what the role calls for.

I've applied through the portal as well — happy to share anything else that's useful. Would you be open to a quick chat?

Best,
{{candidate_name}}`,
  },
  {
    kind: "hm_intro" as const,
    name: "Hiring-manager introduction",
    subject: "Re: {{job_title}} at {{company}}",
    body: `Hi {{first_name}},

I saw the {{job_title}} role on your team at {{company}}. I'm a {{current_title}} with hands-on {{relevant_skill}} experience, and the problems this role owns are exactly the ones I enjoy working on.

If it's useful, I'd love 15 minutes to walk through how I'd approach the first 90 days.

Best,
{{candidate_name}}`,
  },
  {
    kind: "referral" as const,
    name: "Referral request",
    subject: "Referral for {{job_title}} at {{company}}?",
    body: `Hi {{first_name}},

Hope you're doing well. {{company}} has a {{job_title}} opening that fits my background as a {{current_title}} ({{relevant_skill}} in particular). Would you be comfortable referring me, or pointing me to the right person?

Happy to send over my resume and a short blurb to make it easy.

Thanks!
{{candidate_name}}`,
  },
  {
    kind: "followup" as const,
    name: "Follow-up",
    subject: "Following up — {{job_title}}",
    body: `Hi {{first_name}},

Following up on my note about the {{job_title}} role at {{company}} — I know inboxes get busy. Still very interested, and happy to share anything that would help evaluate fit.

Best,
{{candidate_name}}`,
  },
  {
    kind: "post_apply" as const,
    name: "Post-application note",
    subject: "Applied to {{job_title}} — a quick note",
    body: `Hi {{first_name}},

I just applied to the {{job_title}} opening at {{company}} and wanted to put a face to the application. I'm a {{current_title}}, strongest in {{relevant_skill}} — details are in my application.

If there's anything else you need from my side, just say the word.

Best,
{{candidate_name}}`,
  },
];
