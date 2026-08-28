/**
 * Taxonomy seed data — data, not code (SPEC §2 Taxonomy). India-weighted per
 * grill G1/G2. Extending coverage = adding rows here (and, once Phase 1 DB
 * taxonomy tables exist, in the admin UI); no logic changes.
 */

export interface CitySeed {
  city: string;
  country: string; // ISO 3166-1 alpha-2
  aliases: string[];
}

export const CITY_SEEDS: CitySeed[] = [
  {
    city: "Bengaluru",
    country: "IN",
    aliases: ["bangalore", "bengaluru", "blr", "bangalore urban"],
  },
  { city: "Mumbai", country: "IN", aliases: ["mumbai", "bombay", "navi mumbai"] },
  { city: "Delhi NCR", country: "IN", aliases: ["ncr", "delhi ncr", "new delhi", "delhi"] },
  { city: "Gurugram", country: "IN", aliases: ["gurgaon", "gurugram"] },
  { city: "Noida", country: "IN", aliases: ["noida", "greater noida"] },
  { city: "Hyderabad", country: "IN", aliases: ["hyderabad", "hyd"] },
  { city: "Chennai", country: "IN", aliases: ["chennai", "madras"] },
  { city: "Pune", country: "IN", aliases: ["pune"] },
  { city: "Kolkata", country: "IN", aliases: ["kolkata", "calcutta"] },
  { city: "Ahmedabad", country: "IN", aliases: ["ahmedabad"] },
  { city: "Jaipur", country: "IN", aliases: ["jaipur"] },
  { city: "Indore", country: "IN", aliases: ["indore"] },
  { city: "New York City", country: "US", aliases: ["nyc", "new york", "new york city"] },
  { city: "San Francisco", country: "US", aliases: ["san francisco", "sf", "bay area"] },
  { city: "London", country: "GB", aliases: ["london"] },
  { city: "Singapore", country: "SG", aliases: ["singapore"] },
  { city: "Dubai", country: "AE", aliases: ["dubai"] },
];

export const COUNTRY_SEEDS: Record<string, string> = {
  india: "IN",
  in: "IN",
  bharat: "IN",
  "united states": "US",
  usa: "US",
  us: "US",
  "united kingdom": "GB",
  uk: "GB",
  singapore: "SG",
  germany: "DE",
  canada: "CA",
  australia: "AU",
  uae: "AE",
  "united arab emirates": "AE",
  // Region pseudo-codes. MarketFilter decides eligibility per market:
  // APAC counts as India-eligible; the rest are foreign regions.
  apac: "APAC",
  europe: "EU",
  emea: "EMEA",
  latam: "LATAM",
  "north america": "NAMER",
  americas: "AMER",
};

export interface TitleSeed {
  canonical: string;
  function: string;
  aliases: string[]; // lowercased
}

export const TITLE_SEEDS: TitleSeed[] = [
  {
    canonical: "Product Manager",
    function: "Product",
    aliases: [
      "product manager",
      "pm",
      "apm",
      "associate product manager",
      "product owner",
      "program manager - product",
      "product management",
      "product",
    ],
  },
  {
    canonical: "Product Designer",
    function: "Design",
    aliases: ["product designer", "ux designer", "ui/ux designer"],
  },
  {
    canonical: "Software Engineer",
    function: "Engineering",
    aliases: [
      "software engineer",
      "sde",
      "software development engineer",
      "developer",
      "software developer",
      "member of technical staff",
      "mts",
    ],
  },
  {
    canonical: "Data Analyst",
    function: "Data",
    aliases: ["data analyst", "business analyst", "analytics"],
  },
  {
    canonical: "Data Scientist",
    function: "Data",
    aliases: ["data scientist", "ml engineer", "machine learning engineer"],
  },
  {
    canonical: "Growth Marketer",
    function: "Marketing",
    aliases: [
      "growth marketer",
      "growth marketing",
      "performance marketer",
      "digital marketer",
      "seo specialist",
      "seo manager",
    ],
  },
  {
    canonical: "Marketing Manager",
    function: "Marketing",
    aliases: ["marketing manager", "brand manager", "content marketer"],
  },
  {
    canonical: "Sales Manager",
    function: "Sales",
    aliases: ["sales manager", "account executive", "business development manager", "bdm"],
  },
  {
    canonical: "Customer Success Manager",
    function: "Customer Success",
    aliases: ["customer success manager", "csm", "account manager"],
  },
  {
    canonical: "Operations Manager",
    function: "Operations",
    aliases: ["operations manager", "ops manager", "business operations"],
  },
  {
    canonical: "Finance Manager",
    function: "Finance",
    aliases: ["finance manager", "financial analyst", "fp&a"],
  },
  {
    canonical: "HR Manager",
    function: "HR",
    aliases: ["hr manager", "people operations", "talent acquisition", "recruiter"],
  },
  { canonical: "Accountant", function: "Finance", aliases: ["accountant", "chartered accountant"] },
];

/** Title tokens that carry seniority, mapped to the normalized ladder (PRD §45). */
export const SENIORITY_MARKERS: Array<{ level: string; patterns: RegExp[] }> = [
  { level: "intern", patterns: [/\bintern(ship)?\b/i, /\btrainee\b/i] },
  {
    level: "entry",
    patterns: [
      /\bjunior\b/i,
      /\bjr\.?\b/i,
      /\bgraduate\b/i,
      /\bassociate\b/i,
      /\b[i1]\b$/i,
      /\bentry\b/i,
    ],
  },
  {
    level: "executive",
    patterns: [/\bchief\b/i, /\bc[eoftpm]o\b/i, /\bfounder\b/i, /\bpresident\b/i],
  },
  { level: "vp", patterns: [/\bvp\b/i, /\bvice president\b/i, /\bavp\b/i] },
  { level: "director", patterns: [/\bdirector\b/i, /\bhead of\b/i] },
  { level: "lead", patterns: [/\bstaff\b/i, /\bprincipal\b/i, /\blead\b/i, /\btech lead\b/i] },
  { level: "senior", patterns: [/\bsenior\b/i, /\bsr\.?\b/i, /\b(iii|3)\b$/i] },
  {
    level: "manager",
    patterns: [
      /\b(engineering|product|marketing|sales|design|data|operations) manager\b/i,
      /\bmanager,\s/i,
      /\bem\b/,
    ],
  },
];

/** Modifier tokens preserved on titles — they matter for similarity. */
export const TITLE_MODIFIERS = [
  "growth",
  "platform",
  "payments",
  "lending",
  "wealth",
  "credit",
  "consumer",
  "b2b",
  "b2c",
  "core",
  "monetization",
  "onboarding",
  "risk",
  "fraud",
  "data",
  "ai",
  "ml",
  "mobile",
  "backend",
  "frontend",
  "fullstack",
  "full-stack",
  "infrastructure",
  "devops",
  "qa",
  "sre",
];

export const SKILL_ALIASES: Record<string, string> = {
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  "react.js": "React",
  reactjs: "React",
  react: "React",
  "node.js": "Node.js",
  nodejs: "Node.js",
  node: "Node.js",
  py: "Python",
  python: "Python",
  ga4: "Google Analytics",
  "google analytics": "Google Analytics",
  "google analytics 4": "Google Analytics",
  gsc: "Google Search Console",
  sql: "SQL",
  excel: "Excel",
  "ms excel": "Excel",
  figma: "Figma",
  jira: "Jira",
  amplitude: "Amplitude",
  mixpanel: "Mixpanel",
  clevertap: "CleverTap",
  "a/b testing": "Experimentation",
  "ab testing": "Experimentation",
  experimentation: "Experimentation",
  seo: "SEO",
  sem: "SEM",
  k8s: "Kubernetes",
  kubernetes: "Kubernetes",
  aws: "AWS",
  gcp: "Google Cloud",
};

/** Ambiguous tokens that must NOT be alias-mapped without context (PRD §37). */
export const AMBIGUOUS_SKILLS = new Set(["pm", "ba", "qa", "cs", "ml"]);
