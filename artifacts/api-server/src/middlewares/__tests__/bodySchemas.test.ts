import { describe, expect, it } from "vitest";
import {
  boundedBody, cappedList, cappedUnknown, jsonList, jsonValue, looseBody, optBoolish, optNumberish, optText,
} from "../bodySchemas";

describe("bodySchemas", () => {
  it("looseBody treats a missing body as {} and keeps unknown keys", () => {
    const schema = looseBody({ text: optText(5) });
    expect(schema.parse(undefined)).toEqual({});
    expect(schema.parse({ text: "hi", extra: 1 })).toEqual({ text: "hi", extra: 1 });
    expect(schema.safeParse([1, 2]).success).toBe(false);
    expect(schema.safeParse({ text: "too long" }).success).toBe(false);
  });

  it("does not add keys the client did not send", () => {
    const out = looseBody({ title: cappedUnknown(10) }).parse({ other: true }) as Record<string, unknown>;
    expect("title" in out).toBe(false);
  });

  it("cappedUnknown only caps strings, leaving type checks to the handler", () => {
    const schema = cappedUnknown(3);
    expect(schema.safeParse(42).success).toBe(true);
    expect(schema.safeParse({ a: 1 }).success).toBe(true);
    expect(schema.safeParse("abc").success).toBe(true);
    expect(schema.safeParse("abcd").success).toBe(false);
  });

  it("cappedList caps arrays but lets non-arrays reach the handler", () => {
    const schema = cappedList(2, 3);
    expect(schema.safeParse("not-an-array").success).toBe(true);
    expect(schema.safeParse(["a", 1]).success).toBe(true);
    expect(schema.safeParse(["a", "b", "c"]).success).toBe(false);
    expect(schema.safeParse(["abcd"]).success).toBe(false);
  });

  it("jsonList / jsonValue cap serialised size", () => {
    expect(jsonList(2, 20).safeParse([{ a: 1 }]).success).toBe(true);
    expect(jsonList(2, 20).safeParse([{ a: "x".repeat(30) }]).success).toBe(false);
    expect(jsonList(1, 20).safeParse([{}, {}]).success).toBe(false);
    expect(jsonValue(10).safeParse({ a: "x".repeat(20) }).success).toBe(false);
    expect(jsonValue(10).safeParse(undefined).success).toBe(true);
  });

  it("boolish / numberish accept JSON and form-style values unchanged", () => {
    expect(optBoolish.parse("true")).toBe("true");
    expect(optBoolish.parse(false)).toBe(false);
    expect(optNumberish.parse("12")).toBe("12");
    expect(optNumberish.parse(12)).toBe(12);
    expect(optNumberish.safeParse({}).success).toBe(false);
  });

  it("boundedBody caps the whole body", () => {
    const schema = boundedBody({}, 20);
    expect(schema.safeParse({ a: 1 }).success).toBe(true);
    expect(schema.safeParse({ a: "x".repeat(30) }).success).toBe(false);
  });
});
