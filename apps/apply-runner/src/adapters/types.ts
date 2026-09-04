import type { Locator, Page } from "playwright";

/**
 * One adapter per hosted-form family. Adapters supply selectors and quirks;
 * the generic filler (fill.ts) does the work. Keep them small.
 */
export interface FormAdapter {
  id: string;
  /** does this adapter handle the URL? */
  matches(url: string): boolean;
  /** navigate from the posting page to the application form and return its root locator */
  openForm(page: Page): Promise<Locator | null>;
  /** the submit control */
  submit(page: Page): Locator;
  /** true once the application went through */
  isSubmitted(page: Page): Promise<boolean>;
}
