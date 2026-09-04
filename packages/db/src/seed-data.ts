/**
 * Seed registry (ticket 1.11) — India-relevant companies with PUBLIC ATS
 * boards, found and spot-verified via their live board pages/APIs
 * (2026-08-27). Fintech/product-weighted per grill G1. The registry is
 * admin-editable; a board that has since moved simply surfaces as a crawl
 * error in admin and can be corrected there.
 */
export interface CompanySeed {
  name: string;
  domain: string | null;
  industry: string | null;
  atsProvider: "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters" | "generic-jsonld";
  atsIdentifier: string;
  careersUrl?: string;
}

export const COMPANY_SEEDS: CompanySeed[] = [
  // Greenhouse
  {
    name: "Postman",
    domain: "postman.com",
    industry: "Developer Tools",
    atsProvider: "greenhouse",
    atsIdentifier: "postman",
  },
  {
    name: "Razorpay",
    domain: "razorpay.com",
    industry: "Fintech",
    atsProvider: "greenhouse",
    atsIdentifier: "razorpaysoftwareprivatelimited",
  },
  {
    name: "Bluevine India",
    domain: "bluevine.com",
    industry: "Fintech",
    atsProvider: "greenhouse",
    atsIdentifier: "bluevineindia",
  },
  {
    name: "EarnIn",
    domain: "earnin.com",
    industry: "Fintech",
    atsProvider: "greenhouse",
    atsIdentifier: "earnin",
  },
  {
    name: "Skillz",
    domain: "skillz.com",
    industry: "Gaming",
    atsProvider: "greenhouse",
    atsIdentifier: "skillzinc",
  },
  // Lever
  {
    name: "Fam (FamPay)",
    domain: "famapp.in",
    industry: "Fintech",
    atsProvider: "lever",
    atsIdentifier: "fampay",
  },
  {
    name: "Hevo Data",
    domain: "hevodata.com",
    industry: "Data Infrastructure",
    atsProvider: "lever",
    atsIdentifier: "hevodata",
  },
  {
    name: "Acceldata",
    domain: "acceldata.io",
    industry: "Data Infrastructure",
    atsProvider: "lever",
    atsIdentifier: "acceldata",
  },
  {
    name: "Level AI",
    domain: "thelevel.ai",
    industry: "AI SaaS",
    atsProvider: "lever",
    atsIdentifier: "levelai",
  },
  {
    name: "MoonPay",
    domain: "moonpay.com",
    industry: "Fintech",
    atsProvider: "lever",
    atsIdentifier: "moonpay",
  },
  {
    name: "Cognite",
    domain: "cognite.com",
    industry: "Industrial SaaS",
    atsProvider: "lever",
    atsIdentifier: "cognite",
  },
  {
    name: "Greenlight",
    domain: "greenlight.com",
    industry: "Fintech",
    atsProvider: "lever",
    atsIdentifier: "greenlight",
  },
  {
    name: "Weekday",
    domain: "weekday.works",
    industry: "HR Tech",
    atsProvider: "lever",
    atsIdentifier: "weekdayworks",
  },
  // Ashby
  {
    name: "Wisdom AI",
    domain: "wisdomai.com",
    industry: "AI SaaS",
    atsProvider: "ashby",
    atsIdentifier: "Wisdom-AI",
  },
  {
    name: "Josys",
    domain: "josys.com",
    industry: "SaaS",
    atsProvider: "ashby",
    atsIdentifier: "josys",
  },
  {
    name: "Handshake",
    domain: "joinhandshake.com",
    industry: "HR Tech",
    atsProvider: "ashby",
    atsIdentifier: "handshake",
  },
  {
    name: "NETGEAR",
    domain: "netgear.com",
    industry: "Hardware",
    atsProvider: "ashby",
    atsIdentifier: "netgear",
  },
  {
    name: "Lumilens",
    domain: "lumilens.ai",
    industry: "Hardware",
    atsProvider: "ashby",
    atsIdentifier: "lumilens",
  },

  // ── Scope expansion (2026-08-28) — each board fetched live and
  // confirmed to return real job data before being added here. ──
  // Greenhouse
  {
    name: "Groww",
    domain: "groww.in",
    industry: "Fintech",
    atsProvider: "greenhouse",
    atsIdentifier: "groww",
  },
  {
    name: "PhonePe",
    domain: "phonepe.com",
    industry: "Fintech",
    atsProvider: "greenhouse",
    atsIdentifier: "phonepe",
  },
  {
    name: "Navi",
    domain: "navi.com",
    industry: "Fintech",
    atsProvider: "greenhouse",
    atsIdentifier: "navtechnologies",
  },
  {
    name: "Tide",
    domain: "tide.co",
    industry: "Fintech",
    atsProvider: "greenhouse",
    atsIdentifier: "tide",
  },
  {
    name: "Sezzle",
    domain: "sezzle.com",
    industry: "Fintech",
    atsProvider: "greenhouse",
    atsIdentifier: "sezzle",
  },
  {
    name: "PayPay India",
    domain: "paypay.co.in",
    industry: "Fintech",
    atsProvider: "greenhouse",
    atsIdentifier: "pay2dc",
  },
  {
    name: "MerQube",
    domain: "merqube.com",
    industry: "Fintech",
    atsProvider: "greenhouse",
    atsIdentifier: "merqube",
  },
  {
    name: "Instead",
    domain: "instead.com",
    industry: "Fintech",
    atsProvider: "greenhouse",
    atsIdentifier: "instead",
  },
  {
    name: "Accordion India",
    domain: "accordion.com",
    industry: "Fintech",
    atsProvider: "greenhouse",
    atsIdentifier: "accordionindia",
  },
  {
    name: "Stripe",
    domain: "stripe.com",
    industry: "Fintech",
    atsProvider: "greenhouse",
    atsIdentifier: "stripe",
  },
  {
    name: "Figma",
    domain: "figma.com",
    industry: "Design/Product",
    atsProvider: "greenhouse",
    atsIdentifier: "figma",
  },
  {
    name: "Vercel",
    domain: "vercel.com",
    industry: "Developer Tools",
    atsProvider: "greenhouse",
    atsIdentifier: "vercel",
  },
  {
    name: "Twilio",
    domain: "twilio.com",
    industry: "Developer Tools",
    atsProvider: "greenhouse",
    atsIdentifier: "twilio",
  },
  {
    name: "Together AI",
    domain: "together.ai",
    industry: "AI Infrastructure",
    atsProvider: "greenhouse",
    atsIdentifier: "togetherai",
  },
  {
    name: "Glean",
    domain: "glean.com",
    industry: "AI/Enterprise Search",
    atsProvider: "greenhouse",
    atsIdentifier: "gleanwork",
  },
  {
    name: "Typeface",
    domain: "typeface.ai",
    industry: "AI/Creative Tools",
    atsProvider: "greenhouse",
    atsIdentifier: "typeface",
  },
  {
    name: "Smartsheet",
    domain: "smartsheet.com",
    industry: "SaaS",
    atsProvider: "greenhouse",
    atsIdentifier: "smartsheet",
  },
  {
    name: "Atomicwork",
    domain: "atomicwork.com",
    industry: "SaaS",
    atsProvider: "greenhouse",
    atsIdentifier: "atomicwork",
  },
  {
    name: "Instawork",
    domain: "instawork.com",
    industry: "HR Tech",
    atsProvider: "greenhouse",
    atsIdentifier: "instawork",
  },
  {
    name: "Remote",
    domain: "remote.com",
    industry: "HR Tech",
    atsProvider: "greenhouse",
    atsIdentifier: "remotecom",
  },
  {
    name: "VerSe Innovation",
    domain: "verseinnovation.com",
    industry: "Media/Content",
    atsProvider: "greenhouse",
    atsIdentifier: "verse",
  },
  // Lever
  {
    name: "CRED",
    domain: "cred.club",
    industry: "Fintech",
    atsProvider: "lever",
    atsIdentifier: "cred",
  },
  {
    name: "Paytm",
    domain: "paytm.com",
    industry: "Fintech",
    atsProvider: "lever",
    atsIdentifier: "paytm",
  },
  {
    name: "Stable Money",
    domain: "stablemoney.in",
    industry: "Fintech",
    atsProvider: "lever",
    atsIdentifier: "stable-money1",
  },
  {
    name: "Meesho",
    domain: "meesho.com",
    industry: "E-commerce",
    atsProvider: "lever",
    atsIdentifier: "meesho",
  },
  {
    name: "JumpCloud",
    domain: "jumpcloud.com",
    industry: "IT/Security SaaS",
    atsProvider: "lever",
    atsIdentifier: "jumpcloud",
  },
  {
    name: "Zimperium",
    domain: "zimperium.com",
    industry: "Mobile Security",
    atsProvider: "lever",
    atsIdentifier: "zimperium",
  },
  {
    name: "ValGenesis",
    domain: "valgenesis.com",
    industry: "Enterprise SaaS",
    atsProvider: "lever",
    atsIdentifier: "valgenesis",
  },
  {
    name: "Neuron7",
    domain: "neuron7.ai",
    industry: "AI/SaaS",
    atsProvider: "lever",
    atsIdentifier: "neuron7",
  },
  // Ashby
  {
    name: "AiPrise",
    domain: "aiprise.com",
    industry: "Fintech/Compliance",
    atsProvider: "ashby",
    atsIdentifier: "aiprise",
  },
  {
    name: "Flagright",
    domain: "flagright.com",
    industry: "Fintech/Compliance",
    atsProvider: "ashby",
    atsIdentifier: "flagright.com",
  },
  {
    name: "Deel",
    domain: "deel.com",
    industry: "HR Tech",
    atsProvider: "ashby",
    atsIdentifier: "deel",
  },
  {
    name: "Granica",
    domain: "granica.ai",
    industry: "AI Infrastructure",
    atsProvider: "ashby",
    atsIdentifier: "granica",
  },
  {
    name: "Coram AI",
    domain: "coram.ai",
    industry: "AI/Security",
    atsProvider: "ashby",
    atsIdentifier: "coram-ai",
  },
];

/** Offline dev jobs (PRD §129): clearly-seed data so the product is fully
 *  browsable with zero network. A live refresh replaces the picture. */
export interface JobSeed {
  companyName: string;
  externalId: string;
  title: string;
  locations: string[];
  remoteType: "remote" | "hybrid" | "onsite" | null;
  marketEligibility: "IN_CONFIRMED" | "REMOTE_UNVERIFIED";
  employmentType: string | null;
  descriptionHtml: string;
  sourcePostedAt: string | null;
  applyUrl: string;
}

export const JOB_SEEDS: JobSeed[] = [
  {
    companyName: "Fam (FamPay)",
    externalId: "seed-fampay-1",
    title: "Brand Marketing Manager",
    locations: ["Bengaluru"],
    remoteType: "onsite",
    marketEligibility: "IN_CONFIRMED",
    employmentType: "Full Time",
    descriptionHtml:
      "<p>[Seed data — run a refresh for live jobs] Own brand marketing for India's first teen-payments app: campaigns, partnerships, and community.</p>",
    sourcePostedAt: "2026-08-10T00:00:00Z",
    applyUrl: "https://jobs.lever.co/fampay",
  },
  {
    companyName: "Razorpay",
    externalId: "seed-rzp-1",
    title: "Senior Product Manager - Payments",
    locations: ["Bengaluru, Karnataka, India"],
    remoteType: "hybrid",
    marketEligibility: "IN_CONFIRMED",
    employmentType: "Full-time",
    descriptionHtml:
      "<p>[Seed data — run a refresh for live jobs] Drive the payments product line: checkout conversion, success rates, experimentation. 5+ years PM experience, SQL preferred.</p>",
    sourcePostedAt: "2026-08-15T00:00:00Z",
    applyUrl: "https://razorpay.com/jobs/",
  },
  {
    companyName: "Postman",
    externalId: "seed-postman-1",
    title: "Senior Product Manager, Growth",
    locations: ["Bengaluru, Karnataka, India"],
    remoteType: "hybrid",
    marketEligibility: "IN_CONFIRMED",
    employmentType: null,
    descriptionHtml:
      "<p>[Seed data — run a refresh for live jobs] Growth initiatives for the API platform: activation, retention, monetization experiments.</p>",
    sourcePostedAt: "2026-08-18T00:00:00Z",
    applyUrl: "https://job-boards.greenhouse.io/postman",
  },
  {
    companyName: "Hevo Data",
    externalId: "seed-hevo-1",
    title: "Product Manager - Integrations",
    locations: ["Bangalore, India"],
    remoteType: "onsite",
    marketEligibility: "IN_CONFIRMED",
    employmentType: "Full Time",
    descriptionHtml:
      "<p>[Seed data — run a refresh for live jobs] Own the connector platform roadmap for a data pipeline product used by 2000+ companies.</p>",
    sourcePostedAt: "2026-08-05T00:00:00Z",
    applyUrl: "https://jobs.lever.co/hevodata",
  },
  {
    companyName: "MoonPay",
    externalId: "seed-moonpay-1",
    title: "Growth Analyst",
    locations: ["Remote"],
    remoteType: "remote",
    marketEligibility: "REMOTE_UNVERIFIED",
    employmentType: "Full Time",
    descriptionHtml:
      "<p>[Seed data — run a refresh for live jobs] Analytics for crypto payment growth loops. Region eligibility unverified — check the posting.</p>",
    sourcePostedAt: null,
    applyUrl: "https://jobs.lever.co/moonpay",
  },
  {
    companyName: "Level AI",
    externalId: "seed-levelai-1",
    title: "Customer Success Manager",
    locations: ["Bengaluru"],
    remoteType: "hybrid",
    marketEligibility: "IN_CONFIRMED",
    employmentType: "Full Time",
    descriptionHtml:
      "<p>[Seed data — run a refresh for live jobs] Own enterprise accounts for a contact-center AI product.</p>",
    sourcePostedAt: "2026-08-20T00:00:00Z",
    applyUrl: "https://jobs.lever.co/levelai",
  },
];
