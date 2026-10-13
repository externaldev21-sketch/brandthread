import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readPem, walletPassConfig } from "../config";
import { createWalletLinkToken, readWalletLinkToken, WALLET_LINK_TTL_MS } from "../linkToken";
import { buildPreorderPass, isWalletEligible, preorderPassJson } from "../pass";
import { zipStored } from "../zip";
import { makeTestWalletEnv, readStoredZip } from "./testCerts";

const ORDER = "11111111-1111-4111-8111-111111111111";

function hasOpenssl(): boolean {
  try { execFileSync("openssl", ["version"], { stdio: "ignore" }); return true; } catch { return false; }
}

describe("wallet pass config", () => {
  it("is off until every key is set", () => {
    expect(walletPassConfig({})).toBeNull();
    const env = makeTestWalletEnv();
    expect(walletPassConfig({ ...env, APPLE_WALLET_WWDR_CERT: "" })).toBeNull();
    expect(walletPassConfig(env)?.teamIdentifier).toBe("TEAM123456");
  });

  it("accepts PEMs with escaped newlines or as base64", () => {
    const pem = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----";
    expect(readPem(pem.replace(/\n/g, "\\n"))).toBe(pem);
    expect(readPem(Buffer.from(pem).toString("base64"))).toBe(pem);
    expect(readPem("not a pem")).toBeNull();
  });
});

describe("wallet link tokens", () => {
  it("round-trips order + buyer", () => {
    const token = createWalletLinkToken(ORDER, "buyer_1", "secret");
    expect(readWalletLinkToken(token, "secret")).toEqual({ orderId: ORDER, buyerId: "buyer_1" });
  });

  it("rejects a wrong secret, a tampered payload and an expired link", () => {
    const now = 1_000_000;
    const token = createWalletLinkToken(ORDER, "buyer_1", "secret", now);
    expect(readWalletLinkToken(token, "other", now)).toBeNull();
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ o: ORDER, b: "buyer_2", e: now + WALLET_LINK_TTL_MS })).toString("base64url");
    expect(readWalletLinkToken(`${forged}.${sig}`, "secret", now)).toBeNull();
    expect(readWalletLinkToken(`${payload}.${sig}`, "secret", now + WALLET_LINK_TTL_MS + 1)).toBeNull();
    expect(readWalletLinkToken("garbage", "secret", now)).toBeNull();
  });
});

describe("pre-order pass", () => {
  const input = {
    orderId: ORDER,
    orderNumber: "BT-4821",
    productName: "Boxy tee",
    moreCount: 1,
    storeName: "Studio Nine",
    promisedShipDate: new Date("2026-11-20T00:00:00Z"),
  };

  it("describes the pre-order and surfaces on its ship date", () => {
    const json = preorderPassJson(input, { passTypeIdentifier: "pass.x", teamIdentifier: "T" });
    expect(json.serialNumber).toBe(ORDER);
    expect(json.relevantDate).toBe("2026-11-20T00:00:00.000Z");
    expect(json.generic.primaryFields[0]).toMatchObject({ label: "PRE-ORDER", value: "Boxy tee +1" });
    expect(json.generic.secondaryFields.map((f) => f.key)).toEqual(["ships", "order"]);
    expect(json.generic.auxiliaryFields[0]?.value).toBe("Studio Nine");
  });

  it("leaves the ship date out when the store hasn't promised one", () => {
    const json = preorderPassJson({ ...input, promisedShipDate: null }, { passTypeIdentifier: "pass.x", teamIdentifier: "T" });
    expect(json).not.toHaveProperty("relevantDate");
    expect(json.generic.secondaryFields.map((f) => f.key)).toEqual(["order"]);
  });

  it("only offers passes for unshipped, live pre-orders", () => {
    expect(isWalletEligible({ isPreorder: true, status: "pending" })).toBe(true);
    expect(isWalletEligible({ isPreorder: true, status: "processing" })).toBe(true);
    expect(isWalletEligible({ isPreorder: false, status: "pending" })).toBe(false);
    expect(isWalletEligible({ isPreorder: true, status: "cancelled" })).toBe(false);
    expect(isWalletEligible({ isPreorder: true, status: "pending", shippedAt: new Date() })).toBe(false);
  });

  it("builds a pkpass whose manifest matches its files and whose signature verifies", () => {
    const cfg = walletPassConfig(makeTestWalletEnv())!;
    const files = readStoredZip(buildPreorderPass(input, cfg));
    expect([...files.keys()]).toEqual(expect.arrayContaining(["pass.json", "icon.png", "icon@2x.png", "logo.png", "manifest.json", "signature"]));
    const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8")) as Record<string, string>;
    for (const [name, hash] of Object.entries(manifest)) {
      expect(createHash("sha1").update(files.get(name)!).digest("hex")).toBe(hash);
    }
    expect(JSON.parse(files.get("pass.json")!.toString("utf8")).passTypeIdentifier).toBe("pass.com.brandthread.test");

    if (hasOpenssl()) {
      const dir = mkdtempSync(path.join(tmpdir(), "pkpass-"));
      writeFileSync(path.join(dir, "manifest.json"), files.get("manifest.json")!);
      writeFileSync(path.join(dir, "signature"), files.get("signature")!);
      execFileSync("openssl", [
        "cms", "-verify", "-binary", "-noverify", "-inform", "DER",
        "-in", path.join(dir, "signature"), "-content", path.join(dir, "manifest.json"), "-out", path.join(dir, "out"),
      ], { stdio: "pipe" });
    }
  });

  it("writes a zip other tools can read", () => {
    const zip = zipStored([{ name: "a.txt", data: Buffer.from("hello") }, { name: "b/c.txt", data: Buffer.from("") }]);
    const files = readStoredZip(zip);
    expect(files.get("a.txt")?.toString()).toBe("hello");
    expect(files.get("b/c.txt")?.length).toBe(0);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  });
});
