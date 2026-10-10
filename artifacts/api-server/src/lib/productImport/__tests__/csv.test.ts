import { describe, expect, it } from "vitest";
import { CsvParseError, parseCsv, sniffDelimiter } from "../csv";

describe("parseCsv", () => {
  it("parses simple comma data and pads short rows", () => {
    const r = parseCsv("a,b,c\n1,2\n4,5,6\n");
    expect(r.headers).toEqual(["a", "b", "c"]);
    expect(r.rows).toEqual([["1", "2", ""], ["4", "5", "6"]]);
    expect(r.lineNumbers).toEqual([2, 3]);
  });

  it("strips a UTF-8 BOM from the first header", () => {
    expect(parseCsv("﻿name,price\nTee,1").headers).toEqual(["name", "price"]);
  });

  it("handles CRLF, lone CR and LF", () => {
    expect(parseCsv("a,b\r\n1,2\r\n3,4").rows).toEqual([["1", "2"], ["3", "4"]]);
    expect(parseCsv("a,b\r1,2\r3,4").rows).toEqual([["1", "2"], ["3", "4"]]);
  });

  it("keeps embedded delimiters, doubled quotes and newlines inside quotes", () => {
    const r = parseCsv('name,desc\n"Tee, long","He said ""hi""\nsecond line"\nNext,ok');
    expect(r.rows[0]).toEqual(["Tee, long", 'He said "hi"\nsecond line']);
    expect(r.rows[1]).toEqual(["Next", "ok"]);
    // Line numbers count physical lines, so the third record starts on line 4.
    expect(r.lineNumbers).toEqual([2, 4]);
  });

  it("preserves whitespace inside quotes but trims unquoted cells", () => {
    const r = parseCsv('a,b\n  x  ," y "');
    expect(r.rows[0]).toEqual(["x", " y "]);
  });

  it("skips fully blank lines but keeps empty cells", () => {
    const r = parseCsv("a,b\n\n1,\n\n\n,2\n");
    expect(r.rows).toEqual([["1", ""], ["", "2"]]);
  });

  it("sniffs semicolon, tab and pipe delimiters", () => {
    expect(parseCsv("a;b;c\n1;2;3").delimiter).toBe(";");
    expect(parseCsv("a\tb\tc\n1\t2\t3").delimiter).toBe("\t");
    expect(parseCsv("a|b|c\n1|2|3").delimiter).toBe("|");
    expect(parseCsv("a,b,c\n1,2,3").delimiter).toBe(",");
  });

  it("does not mistake commas inside decimal prices for the delimiter", () => {
    const r = parseCsv("name;price;tags\nTee;12,50;a,b");
    expect(r.delimiter).toBe(";");
    expect(r.rows[0]).toEqual(["Tee", "12,50", "a,b"]);
  });

  it("ignores delimiters that only occur inside quotes when sniffing", () => {
    expect(sniffDelimiter('name,desc\n"a;b;c;d","x;y;z"')).toBe(",");
  });

  it("honours an explicit delimiter", () => {
    expect(parseCsv("a;b\n1;2", { delimiter: ";" }).rows).toEqual([["1", "2"]]);
  });

  it("returns a header-only file with zero rows", () => {
    expect(parseCsv("a,b\n").rows).toEqual([]);
  });

  it("rejects empty input and unterminated quotes", () => {
    expect(() => parseCsv("  \n ")).toThrow(CsvParseError);
    expect(() => parseCsv('a,b\n"open,1\n2,3')).toThrow(/never closes/);
  });

  it("treats a quote in the middle of an unquoted cell as literal", () => {
    expect(parseCsv('a,b\n5" nail,x').rows[0]).toEqual(['5" nail', "x"]);
  });

  it("handles a last record without a trailing newline", () => {
    expect(parseCsv("a,b\n1,2").rows).toEqual([["1", "2"]]);
  });
});
