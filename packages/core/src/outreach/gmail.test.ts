import { describe, expect, it } from "vitest";
import { toRfc822 } from "./gmail.ts";

describe("toRfc822 — header safety", () => {
  it("CR/LF in subject or recipient cannot smuggle extra headers (Bcc injection)", () => {
    const raw = toRfc822({
      to: "a@x.com\r\nBcc: victim@example.com",
      subject: "Hello\r\nBcc: sneaky@example.com",
      body: "body text\r\nwith lines is fine",
    });
    // The injected text survives as literal VALUE content, but no header
    // LINE may start with Bcc: — that's what mail servers would act on.
    const headerLines = raw.split("\r\n\r\n")[0]!.split("\r\n");
    expect(headerLines.some((l) => /^bcc:/i.test(l))).toBe(false);
    expect(headerLines).toContain("Subject: Hello Bcc: sneaky@example.com");
  });

  it("keeps body content verbatim after the blank line", () => {
    const raw = toRfc822({ to: "a@x.com", subject: "s", body: "line1\nline2" });
    expect(raw.split("\r\n\r\n")[1]).toBe("line1\nline2");
  });
});
