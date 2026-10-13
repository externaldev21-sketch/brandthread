/**
 * Keeps the Maestro suite (.maestro/flows) honest without a simulator: every
 * testID, on-screen text and deep link a flow relies on must still exist in
 * the app. Renaming a button or route fails here, not on release day.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const flowsDir = path.join(root, ".maestro", "flows");
const FLOWS = ["sign-up", "buy", "sell", "ship", "refund"];

/** Text shown by the OS or Stripe, not by Brandthread's own source. */
const EXTERNAL_TEXT = new Set(["Card number", "Add"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const source = ["app", "components"].flatMap((d) => sourceFiles(path.join(root, d))).map((f) => readFileSync(f, "utf8")).join("\n");
const flows = Object.fromEntries(FLOWS.map((name) => [name, readFileSync(path.join(flowsDir, `${name}.yaml`), "utf8")]));

function unquote(raw: string) {
  return raw.trim().replace(/^["']|["']$/g, "");
}

function idsIn(flow: string) {
  return [...flow.matchAll(/^\s*id:\s*(\S+)\s*$/gm)].map((m) => unquote(m[1]));
}

function textsIn(flow: string) {
  return [...flow.matchAll(/^\s*-?\s*(?:tapOn|assertNotVisible|assertVisible|visible|notVisible|element|text):\s*(".*"|'.*')\s*$/gm)]
    .map((m) => unquote(m[1]))
    .filter((t) => !t.includes("${") && !t.includes(".*") && !EXTERNAL_TEXT.has(t));
}

function routesIn(flow: string) {
  return [...flow.matchAll(/openLink:\s*brandthread:\/\/([\w-]+)/g)].map((m) => m[1]);
}

describe("Maestro e2e flows", () => {
  it("covers sign-up, buy, sell, ship and refund", () => {
    expect(Object.keys(flows)).toEqual(FLOWS);
    for (const [name, flow] of Object.entries(flows)) {
      expect(flow, name).toMatch(/^appId: com\.brandthread\.mobile$/m);
      expect(flow, name).toMatch(new RegExp(`^name: ${name}$`, "m"));
      expect(flow.split(/^---$/m), name).toHaveLength(2);
    }
  });

  it("targets the app's real bundle ID", () => {
    const appJson = JSON.parse(readFileSync(path.join(root, "app.json"), "utf8"));
    expect(appJson.expo.ios.bundleIdentifier).toBe("com.brandthread.mobile");
  });

  it.each(FLOWS)("%s: every testID it taps exists", (name) => {
    for (const id of idsIn(flows[name])) {
      expect(source.includes(`testID="${id}"`) || source.includes(`testID: '${id}'`), `testID "${id}"`).toBe(true);
    }
  });

  it.each(FLOWS)("%s: every on-screen text it uses exists", (name) => {
    for (const text of textsIn(flows[name])) {
      expect(source.includes(text), `text "${text}"`).toBe(true);
    }
  });

  it.each(FLOWS)("%s: every deep link opens a real screen", (name) => {
    for (const route of routesIn(flows[name])) {
      expect(existsSync(path.join(root, "app", `${route}.tsx`)), `app/${route}.tsx`).toBe(true);
    }
  });

  it("ships the photo the sell flow adds", () => {
    expect(existsSync(path.join(root, ".maestro", "media", "listing-photo.png"))).toBe(true);
  });
});
