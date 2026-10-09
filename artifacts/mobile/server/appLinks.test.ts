import { describe, expect, it } from "vitest";

const { appLinkFile, appleAppSiteAssociation, assetLinks, APP_LINK_PATHS } = require("./appLinks.js");
const { server } = require("./serve.js") as { server: { emit: (e: string, req: unknown, res: unknown) => void } };

const FP = Array.from({ length: 32 }, (_, i) => (i + 10).toString(16).toUpperCase().padStart(2, "0")).join(":");

function get(url: string, headers: Record<string, string> = {}) {
  let status = 0;
  let resHeaders: Record<string, string> = {};
  let body = "";
  server.emit("request", { url, headers, method: "GET" }, {
    writeHead(s: number, h: Record<string, string> = {}) { status = s; resHeaders = h; },
    end(chunk?: string) { body = chunk ?? ""; },
  });
  return { status, headers: resHeaders, body };
}

describe("universal link / app link verification files", () => {
  it("claims the share paths /p/, /post/, /s/ and /u/", () => {
    for (const p of ["/p/*", "/post/*", "/s/*", "/u/*"]) expect(APP_LINK_PATHS).toContain(p);
  });

  it("builds apple-app-site-association from the Apple team id, in both formats", () => {
    const aasa = appleAppSiteAssociation({ APPLE_TEAM_ID: "ABCDE12345" });
    const detail = aasa.applinks.details[0];
    expect(detail.appID).toBe("ABCDE12345.com.brandthread.mobile");
    expect(detail.appIDs).toEqual(["ABCDE12345.com.brandthread.mobile"]);
    expect(detail.paths).toContain("/s/*");
    expect(detail.components).toContainEqual({ "/": "/post/*" });
    expect(appleAppSiteAssociation({ APPLE_TEAM_ID: "ABCDE12345", IOS_BUNDLE_IDENTIFIER: "com.x.y" }).applinks.details[0].appID).toBe("ABCDE12345.com.x.y");
  });

  it("is valid but empty until the developer accounts are set up", () => {
    expect(appleAppSiteAssociation({}).applinks.details).toEqual([]);
    expect(appleAppSiteAssociation({ APPLE_TEAM_ID: "not-a-team" }).applinks.details).toEqual([]);
    expect(assetLinks({})).toEqual([]);
    expect(assetLinks({ ANDROID_SHA256_CERT_FINGERPRINTS: "nope" })).toEqual([]);
  });

  it("builds assetlinks.json from the signing fingerprints", () => {
    const links = assetLinks({ ANDROID_SHA256_CERT_FINGERPRINTS: `${FP.toLowerCase()}, bad` });
    expect(links).toEqual([{
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: "com.brandthread.mobile", sha256_cert_fingerprints: [FP] },
    }]);
  });

  it("only answers the exact verification paths", () => {
    expect(appLinkFile("/.well-known/apple-app-site-association")?.contentType).toBe("application/json");
    expect(appLinkFile("/apple-app-site-association")).not.toBeNull();
    expect(appLinkFile("/.well-known/assetlinks.json")).not.toBeNull();
    expect(appLinkFile("/.well-known/other")).toBeNull();
  });

  it("serves them as JSON, 200, with no redirect even on the generated host", () => {
    const res = get("/.well-known/apple-app-site-association", { host: "brandthread.replit.app" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(res.body)).toHaveProperty("applinks");
    const android = get("/.well-known/assetlinks.json", { host: "brandthread.app" });
    expect(android.status).toBe(200);
    expect(Array.isArray(JSON.parse(android.body))).toBe(true);
  });
});
