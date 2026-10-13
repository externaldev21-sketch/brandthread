/**
 * Every link a person can share out of the app must unfurl with a real card.
 * This enumerates the app's share-URL builders and asserts that sharePreview
 * has a matcher (or serve.js a dedicated page) for each produced path — so a
 * new share link without a preview fails here instead of shipping a generic
 * card.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as shareLinks from "../lib/shareLinks";
import * as shareProfile from "../lib/shareProfile";
import * as shareDrop from "../lib/shareDrop";
import * as shareCollection from "../lib/shareCollection";
import * as storeQr from "../lib/storeQr";
import * as communityInvite from "../lib/communities/inviteLink";
import { inviteLink as referralInviteLink } from "../../api-server/src/lib/referrals/policy";

const { findMatcher } = require("./sharePreview.js") as {
  findMatcher: (pathname: string) => { matcher: unknown; match: RegExpMatchArray } | null;
};
const { matchProductPath } = require("./seo/productPage.js") as { matchProductPath: (p: string) => string | null };

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";
import * as dropWaitlist from "../lib/dropWaitlist";
import * as shareLive from "../lib/shareLive";

const SAMPLE_ARG: Record<string, string> = {
  buildPostUrl: UUID,
  buildLiveUrl: UUID,
  buildCanonicalLiveUrl: UUID,
  buildDropWaitlistUrl: "nova_goods",
  buildStoreUrl: "nova_goods",
  buildProductUrl: UUID,
  buildProfileUrl: "jordanreyes",
  buildHashtagUrl: "#StreetWear",
  buildPlaceUrl: "place_12345",
  buildCanonicalDropUrl: UUID,
  buildCanonicalCollectionUrl: UUID,
  buildCanonicalProfileUrl: "jordanreyes",
};

/** Exported share-URL builders (build*Url) across the app's share modules. */
const BUILDER_MODULES: Record<string, Record<string, unknown>> = {
  "lib/shareLinks.ts": shareLinks,
  "lib/shareProfile.ts": shareProfile,
  "lib/shareDrop.ts": shareDrop,
  "lib/shareCollection.ts": shareCollection,
  "lib/storeQr.ts": storeQr,
  "lib/dropWaitlist.ts": dropWaitlist,
  "lib/shareLive.ts": shareLive,
};

function builders() {
  const out: Array<{ file: string; name: string; fn: (arg: string) => string | null }> = [];
  for (const [file, mod] of Object.entries(BUILDER_MODULES)) {
    for (const [name, value] of Object.entries(mod)) {
      if (/^build\w*Url$/.test(name) && typeof value === "function") {
        out.push({ file, name, fn: value as (arg: string) => string | null });
      }
    }
  }
  return out;
}

function hasPreview(pathname: string): boolean {
  return Boolean(findMatcher(pathname)) || Boolean(matchProductPath(pathname));
}

describe("every shareable link has a link preview", () => {
  it.each(builders().map((b) => [`${b.file} ${b.name}`, b] as const))("%s", (_label, b) => {
    const arg = SAMPLE_ARG[b.name];
    expect(arg, `add a sample argument for ${b.name} to SAMPLE_ARG`).toBeTruthy();
    const url = b.fn(arg);
    expect(url).toBeTruthy();
    const { pathname } = new URL(url!);
    expect(hasPreview(pathname), `no share-preview matcher for ${pathname} (from ${b.name})`).toBe(true);
  });

  it("covers referral invite links and community invite links", () => {
    expect(hasPreview(new URL(referralInviteLink("K7M2QP")).pathname)).toBe(true);
    expect(hasPreview(new URL(communityInvite.inviteUrlForCode("abc123")).pathname)).toBe(true);
  });

  it("knows about every share-URL builder exported from mobile lib/", () => {
    // A new `export function build…Url` anywhere under lib/share*.ts (or the
    // store QR helper) must be added to BUILDER_MODULES above.
    const libDir = path.resolve(__dirname, "..", "lib");
    const files = fs.readdirSync(libDir).filter((f) => /^share.*\.tsx?$/.test(f) && !/\.test\./.test(f));
    const found = new Set<string>();
    for (const file of [...files, "storeQr.ts"]) {
      const src = fs.readFileSync(path.join(libDir, file), "utf8");
      for (const m of src.matchAll(/export (?:async )?function (build\w*Url)\b/g)) found.add(`lib/${file} ${m[1]}`);
    }
    const covered = new Set(builders().map((b) => `${b.file} ${b.name}`));
    expect([...found].filter((k) => !covered.has(k))).toEqual([]);
    expect(found.size).toBeGreaterThanOrEqual(9);
  });
});
