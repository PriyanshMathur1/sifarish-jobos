import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SafeFetcher } from "../fetch/safe-fetcher.ts";
import { greenhouseProvider } from "./greenhouse.ts";
import { leverProvider } from "./lever.ts";
import { ashbyProvider } from "./ashby.ts";
import { genericJsonLdProvider } from "./generic-jsonld.ts";
import { detectProvider } from "./registry.ts";

/**
 * Provider contract tests (PRD §127): recorded real payloads, zero live
 * network. Fixtures: greenhouse=Postman, lever=FamPay (Bengaluru fintech),
 * ashby=Linear — recorded 2026-08-27.
 */
const fx = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");

/** SafeFetcher wired to serve a fixture body instead of the network. */
const fixtureFetcher = (body: string, status = 200) =>
  new SafeFetcher({
    resolve: async () => ["93.184.216.34"],
    fetchImpl: async () => new Response(body, { status }),
    sleep: async () => {},
  });

describe("greenhouse", () => {
  it("detects board tokens from URLs", () => {
    expect(greenhouseProvider.detect({ url: "https://boards.greenhouse.io/stripe" })).toMatchObject(
      {
        providerId: "greenhouse",
        atsIdentifier: "stripe",
        confidence: "high",
      },
    );
    expect(
      greenhouseProvider.detect({ url: "https://job-boards.greenhouse.io/postman/jobs/1" }),
    ).toMatchObject({ atsIdentifier: "postman" });
    expect(greenhouseProvider.detect({ url: "https://example.com/careers" })).toBeNull();
  });

  it("lists and normalizes the recorded board", async () => {
    const res = await greenhouseProvider.listJobs(fixtureFetcher(fx("greenhouse.json")), {
      atsIdentifier: "postman",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toHaveLength(2);

    const n = greenhouseProvider.normalize(res.value[1]!);
    expect(n).toMatchObject({
      externalId: "8000000001",
      title: "Senior Product Manager, Growth",
      locations: ["Bengaluru, Karnataka, India", "Bengaluru"],
      applyUrl: "https://job-boards.greenhouse.io/postman/jobs/8000000001",
    });
    expect(n.sourcePostedAt?.toISOString()).toBe("2026-08-18T06:00:00.000Z");
    expect(n.descriptionHtml).toContain("<p>"); // entities unescaped
    expect(n.employmentType).toBeNull(); // not stated by source → never guessed

    const dubai = greenhouseProvider.normalize(res.value[0]!);
    expect(dubai.remoteType).toBe("remote"); // office "Remote, Dubai"
  });

  it("surfaces 404 as notFound (board disabled ≠ jobs removed)", async () => {
    const res = await greenhouseProvider.listJobs(fixtureFetcher("Not found", 404), {
      atsIdentifier: "nope",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("notFound");
  });
});

describe("lever", () => {
  it("detects site tokens from URLs", () => {
    expect(leverProvider.detect({ url: "https://jobs.lever.co/fampay" })).toMatchObject({
      providerId: "lever",
      atsIdentifier: "fampay",
    });
  });

  it("lists and normalizes the recorded board", async () => {
    const res = await leverProvider.listJobs(fixtureFetcher(fx("lever.json")), {
      atsIdentifier: "fampay",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toHaveLength(2);
    const n = leverProvider.normalize(res.value[0]!);
    expect(n).toMatchObject({
      externalId: "09c9d0cd-f422-4138-a065-8d45e71d01a7",
      title: "Assistant Manager(Controllership)",
      locations: ["Bengaluru"],
      remoteType: "onsite",
      employmentType: "Fulltime- Office",
      sourceUrl: "https://jobs.lever.co/fampay/09c9d0cd-f422-4138-a065-8d45e71d01a7",
    });
    expect(n.sourcePostedAt).toEqual(new Date(1785842845029));
    expect(n.sourceUpdatedAt).toBeNull(); // lever doesn't expose it → not invented
  });
});

describe("ashby", () => {
  it("detects board names from URLs", () => {
    expect(ashbyProvider.detect({ url: "https://jobs.ashbyhq.com/linear" })).toMatchObject({
      providerId: "ashby",
      atsIdentifier: "linear",
    });
  });

  it("lists and normalizes the recorded board", async () => {
    const res = await ashbyProvider.listJobs(fixtureFetcher(fx("ashby.json")), {
      atsIdentifier: "linear",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const n = ashbyProvider.normalize(res.value[1]!);
    expect(n).toMatchObject({
      title: "Senior / Staff Fullstack Engineer",
      locations: ["North America", "Toronto, Canada"],
      remoteType: "remote",
      employmentType: "FullTime",
    });
    expect(n.salary).toBeNull(); // prose tiers never parsed into fake ranges
  });
});

describe("generic-jsonld", () => {
  it("detects JSON-LD JobPosting pages, including @graph nesting", () => {
    expect(
      genericJsonLdProvider.detect({ url: "x", html: fx("generic-jsonld.html") }),
    ).toMatchObject({ providerId: "generic-jsonld", confidence: "medium" });
  });

  it("yields ZERO jobs for a careers page without JSON-LD — never scrapes speculatively", async () => {
    const res = await genericJsonLdProvider.listJobs(fixtureFetcher(fx("careers-no-jsonld.html")), {
      atsIdentifier: "jsonld",
      careersUrl: "https://careers.example.com",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toHaveLength(0);
  });

  it("extracts and normalizes JSON-LD postings faithfully", async () => {
    const res = await genericJsonLdProvider.listJobs(fixtureFetcher(fx("generic-jsonld.html")), {
      atsIdentifier: "jsonld",
      careersUrl: "https://careers.acme.example/jobs",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toHaveLength(2);

    const pm = genericJsonLdProvider.normalize(res.value[0]!);
    expect(pm).toMatchObject({
      externalId: "acme-pm-lending-01",
      title: "Product Manager - Lending",
      locations: ["Mumbai, MH, IN"],
      employmentType: "FULL_TIME",
      salary: { min: 3500000, max: 5000000, currency: "INR", period: "YEAR" },
    });

    const be = genericJsonLdProvider.normalize(res.value[1]!);
    expect(be.remoteType).toBe("remote"); // TELECOMMUTE
    expect(be.locations).toContain("Remote - India"); // applicantLocationRequirements
  });
});

describe("registry detection order", () => {
  it("ATS URL beats generic JSON-LD", () => {
    const d = detectProvider({
      url: "https://boards.greenhouse.io/acme",
      html: fx("generic-jsonld.html"),
    });
    expect(d?.providerId).toBe("greenhouse");
  });

  it("unknown page with no JSON-LD → null (unsupported, PRD §19)", () => {
    expect(
      detectProvider({ url: "https://example.com/careers", html: fx("careers-no-jsonld.html") }),
    ).toBeNull();
  });
});
