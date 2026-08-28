import { describe, expect, it } from "vitest";
import { SafeFetcher } from "../fetch/safe-fetcher.ts";
import { discoverContacts, contactRelevance } from "./discovery.ts";

const fetcherFor = (body: string, status = 200) =>
  new SafeFetcher({
    resolve: async () => ["93.184.216.34"],
    fetchImpl: async (url) =>
      String(url).endsWith("/robots.txt")
        ? new Response("", { status: 404 })
        : new Response(body, { status }),
    sleep: async () => {},
  });

const TEAM_PAGE = `<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization","name":"Acme",
 "employee":[
   {"@type":"Person","name":"Anita Desai","jobTitle":"Talent Partner","email":"mailto:anita@acme.com"},
   {"@type":"Person","name":"Rahul Verma","jobTitle":"Director of Product"},
   {"@type":"Person","name":"Sam Founder","jobTitle":"CEO"}
 ]}
</script></head><body>Team</body></html>`;

const GRAPH_PAGE = `<html><head>
<script type="application/ld+json">
{"@graph":[{"@type":"Person","name":"Maya Iyer","jobTitle":"Recruiter","url":"https://acme.com/maya"}]}
</script></head><body></body></html>`;

const NO_PEOPLE_PAGE = `<html><body><div class="team-member">Jane Doe — CTO</div></body></html>`;

describe("discoverContacts (PRD §66–69)", () => {
  it("extracts Person nodes with provenance, ranked by relevance", async () => {
    const r = await discoverContacts(fetcherFor(TEAM_PAGE), "https://acme.com/team", {
      companySizeHint: 20,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((p) => p.fullName)).toEqual(["Anita Desai", "Sam Founder", "Rahul Verma"]);
    expect(r.value[0]).toMatchObject({
      title: "Talent Partner",
      email: "anita@acme.com", // page-published email = observed
      sourceUrl: "https://acme.com/team",
    });
  });

  it("walks @graph structures", async () => {
    const r = await discoverContacts(fetcherFor(GRAPH_PAGE), "https://acme.com/about");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[0]).toMatchObject({ fullName: "Maya Iyer", title: "Recruiter" });
  });

  it("yields ZERO people from a page without Person JSON-LD — no HTML guessing", async () => {
    const r = await discoverContacts(fetcherFor(NO_PEOPLE_PAGE), "https://acme.com/team");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([]);
  });
});

describe("contactRelevance (PRD §69)", () => {
  it("talent roles > function heads > managers > unknown", () => {
    const talent = contactRelevance("Talent Acquisition Lead");
    const head = contactRelevance("Head of Product");
    const mgr = contactRelevance("Marketing Manager");
    const none = contactRelevance(null);
    expect(talent).toBeGreaterThan(head);
    expect(head).toBeGreaterThan(mgr);
    expect(mgr).toBeGreaterThan(none);
  });

  it("CEO relevance scales inversely with company size", () => {
    expect(contactRelevance("CEO", 10)).toBeGreaterThan(0.8);
    expect(contactRelevance("CEO", 50000)).toBeLessThan(0.2);
    expect(contactRelevance("CEO", null)).toBe(0.5);
  });
});
