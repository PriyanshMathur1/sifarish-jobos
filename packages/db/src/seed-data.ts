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
  atsProvider: "greenhouse" | "lever" | "ashby" | "generic-jsonld";
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
