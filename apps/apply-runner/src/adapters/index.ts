import { ashby } from "./ashby.ts";
import { greenhouse } from "./greenhouse.ts";
import { lever } from "./lever.ts";
import type { FormAdapter } from "./types.ts";

export const ADAPTERS: FormAdapter[] = [greenhouse, lever, ashby];

export function adapterFor(url: string): FormAdapter | null {
  return ADAPTERS.find((a) => a.matches(url)) ?? null;
}
