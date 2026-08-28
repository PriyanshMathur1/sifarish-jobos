import type { Detection, JobProvider, ProviderId } from "./types.ts";
import { greenhouseProvider } from "./greenhouse.ts";
import { leverProvider } from "./lever.ts";
import { ashbyProvider } from "./ashby.ts";
import { genericJsonLdProvider } from "./generic-jsonld.ts";

/** Provider registry — supported ATS adapters, first-party APIs preferred. */
const providers: JobProvider[] = [
  greenhouseProvider,
  leverProvider,
  ashbyProvider,
  genericJsonLdProvider,
];

export function getProvider(id: ProviderId): JobProvider {
  const p = providers.find((x) => x.id === id);
  if (!p) throw new Error(`unknown provider: ${id}`);
  return p;
}

export function allProviders(): readonly JobProvider[] {
  return providers;
}

/**
 * ATS detection (PRD §19): URL patterns first (high confidence), then page
 * HTML (scripts/iframes/links), then JSON-LD presence as the generic
 * fallback. Returns the first, most-confident hit.
 */
export function detectProvider(input: { url: string; html?: string }): Detection | null {
  for (const p of providers) {
    const d = p.detect(input);
    if (d) return d;
  }
  return null;
}
