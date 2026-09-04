import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("handles the LinkedIn export preamble, quotes, and CRLF", () => {
    const text =
      "Notes:\r\n\"When exporting your connection data, you may notice that some of the email addresses are missing.\"\r\n\r\n" +
      "First Name,Last Name,URL,Email Address,Company,Position,Connected On\r\n" +
      'Anita,Desai,https://www.linkedin.com/in/anita,,Razorpay,"Talent Partner, Product",01 Sep 2026\r\n' +
      'Rohan,"Mehta ""RM""",https://www.linkedin.com/in/rohan,rohan@example.com,Postman,Recruiter,02 Sep 2026\r\n';
    const rows = parseCsv(text);
    const header = rows.findIndex((r) => r[0] === "First Name");
    expect(header).toBeGreaterThan(0);
    expect(rows[header + 1]).toEqual(["Anita", "Desai", "https://www.linkedin.com/in/anita", "", "Razorpay", "Talent Partner, Product", "01 Sep 2026"]);
    expect(rows[header + 2]![1]).toBe('Mehta "RM"');
    expect(rows[header + 2]![3]).toBe("rohan@example.com");
  });
});
