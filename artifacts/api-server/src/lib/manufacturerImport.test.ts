import { describe, expect, it } from "vitest";
import { inviteEmailCopy, parseCsv, parseManufacturerLeads } from "./manufacturerImport";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
});

describe("parseManufacturerLeads", () => {
  const header = "Company Name,Contact Email,Country,Contact Name,Specialty,Twitter";

  it("validates rows and reports problems by line", () => {
    const { leads, problems } = parseManufacturerLeads([
      header,
      "Saigon Knit Co.,Sales@SaigonKnit.vn,Vietnam,Linh,Knitwear,@x",
      "No Email Mill,,Portugal,,,",
      "Bad Email Mill,not-an-email,Portugal,,,",
      "Saigon Knit Again,sales@saigonknit.vn,Vietnam,,,",
    ].join("\n"));
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ company_name: "Saigon Knit Co.", contact_email: "sales@saigonknit.vn", contact_name: "Linh", line: 2 });
    expect(problems.map((p) => p.line)).toEqual([1, 3, 4, 5]);
    expect(problems[0].problem).toContain("twitter");
  });

  it("rejects files without the required columns", () => {
    expect(parseManufacturerLeads("name,email\nA,a@b.co").problems[0].problem).toBe("Missing column(s): company_name, contact_email, country");
    expect(parseManufacturerLeads("").problems[0].problem).toBe("The file is empty.");
  });
});

describe("inviteEmailCopy", () => {
  it("states the honest fee and mentions the inviting seller when there is one", () => {
    const pub = inviteEmailCopy({ companyName: "Porto Knit", joinUrl: "https://x/join" });
    expect(pub.subject).toBe("List Porto Knit on Brandthread");
    expect(pub.paragraphs).toContain("Free to join. 5% + processing on paid orders. No listing fee.");
    const priv = inviteEmailCopy({ companyName: "Porto Knit", contactName: "Rui", joinUrl: "https://x/join?invite=t", sellerName: "Maya Studio" });
    expect(priv.subject).toBe("Maya Studio invited Porto Knit to Brandthread");
    expect(priv.paragraphs[0]).toBe("Hi Rui,");
  });
});
