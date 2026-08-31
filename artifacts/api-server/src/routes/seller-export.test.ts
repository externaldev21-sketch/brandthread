import { describe, expect, it } from "vitest";
import { toCSV } from "./seller-export";

describe("seller export CSV safety", () => {
  it("neutralizes spreadsheet formulas after leading whitespace", () => {
    const csv = toCSV([
      { name: "=HYPERLINK(\"https://bad.example\")" },
      { name: "  +SUM(1,1)" },
      { name: "@malicious" },
      { name: "-1+2" },
    ], ["name"]);
    expect(csv).toContain(`"'=HYPERLINK(""https://bad.example"")"`);
    expect(csv).toContain(`"'  +SUM(1,1)"`);
    expect(csv).toContain("'@malicious");
    expect(csv).toContain("'-1+2");
  });

  it("does not alter ordinary cells", () => {
    expect(toCSV([{ name: "Normal product" }], ["name"])).toBe("name\nNormal product");
  });
});