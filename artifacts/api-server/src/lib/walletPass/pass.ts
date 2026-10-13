/**
 * Builds a signed Apple Wallet pass (.pkpass) for a buyer's pre-order:
 * what they ordered, the store, the order number and the date it ships.
 * `relevantDate` is the promised ship date, so the pass surfaces on the
 * Lock Screen around the day it ships.
 *
 * A .pkpass is a zip of pass.json + images, a manifest.json of their SHA-1
 * hashes, and a detached PKCS#7 signature of the manifest made with the
 * Pass Type ID certificate (chain: Apple WWDR).
 */
import { createHash } from "node:crypto";
import forge from "node-forge";
import type { WalletPassConfig } from "./config";
import { WALLET_PASS_IMAGES } from "./images";
import { zipStored } from "./zip";

export interface PreorderPassInput {
  orderId: string;
  orderNumber: string;
  productName: string;
  /** Other line items in the same order. */
  moreCount: number;
  storeName: string;
  promisedShipDate: Date | null;
}

export function preorderPassJson(input: PreorderPassInput, cfg: Pick<WalletPassConfig, "passTypeIdentifier" | "teamIdentifier">) {
  const item = input.moreCount > 0 ? `${input.productName} +${input.moreCount}` : input.productName;
  const secondaryFields: Array<Record<string, unknown>> = [];
  if (input.promisedShipDate) {
    secondaryFields.push({
      key: "ships",
      label: "SHIPS BY",
      value: input.promisedShipDate.toISOString(),
      dateStyle: "PKDateStyleMedium",
      timeStyle: "PKDateStyleNone",
      ignoresTimeZone: true,
      changeMessage: "Ship date moved to %@",
    });
  }
  secondaryFields.push({ key: "order", label: "ORDER", value: input.orderNumber });

  return {
    formatVersion: 1,
    passTypeIdentifier: cfg.passTypeIdentifier,
    teamIdentifier: cfg.teamIdentifier,
    serialNumber: input.orderId,
    organizationName: "Brandthread",
    description: `Brandthread pre-order ${input.orderNumber}`,
    logoText: "Brandthread",
    foregroundColor: "rgb(255, 255, 255)",
    backgroundColor: "rgb(10, 10, 11)",
    labelColor: "rgb(174, 174, 178)",
    sharingProhibited: true,
    ...(input.promisedShipDate ? { relevantDate: input.promisedShipDate.toISOString() } : {}),
    generic: {
      primaryFields: [{ key: "item", label: "PRE-ORDER", value: item }],
      secondaryFields,
      auxiliaryFields: [{ key: "store", label: "FROM", value: input.storeName }],
      backFields: [
        { key: "about", label: "About this pre-order", value: `${input.storeName} makes this to order. Track it in Brandthread under Orders.` },
      ],
    },
  };
}

export function passManifest(files: ReadonlyArray<{ name: string; data: Buffer }>): Buffer {
  const manifest: Record<string, string> = {};
  for (const file of files) manifest[file.name] = createHash("sha1").update(file.data).digest("hex");
  return Buffer.from(JSON.stringify(manifest), "utf8");
}

/** Detached PKCS#7 (DER) signature of the manifest. */
export function signManifest(manifest: Buffer, cfg: WalletPassConfig): Buffer {
  const signerCert = forge.pki.certificateFromPem(cfg.signerCertPem);
  const wwdrCert = forge.pki.certificateFromPem(cfg.wwdrCertPem);
  const key = cfg.signerKeyPassphrase
    ? forge.pki.decryptRsaPrivateKey(cfg.signerKeyPem, cfg.signerKeyPassphrase)
    : forge.pki.privateKeyFromPem(cfg.signerKeyPem);
  if (!key) throw new Error("Wallet signer key could not be read");

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifest.toString("binary"));
  p7.addCertificate(signerCert);
  p7.addCertificate(wwdrCert);
  p7.addSigner({
    key,
    certificate: signerCert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), "binary");
}

export function buildPreorderPass(input: PreorderPassInput, cfg: WalletPassConfig): Buffer {
  const files = [
    { name: "pass.json", data: Buffer.from(JSON.stringify(preorderPassJson(input, cfg)), "utf8") },
    ...Object.entries(WALLET_PASS_IMAGES).map(([name, b64]) => ({ name, data: Buffer.from(b64, "base64") })),
  ];
  const manifest = passManifest(files);
  return zipStored([
    ...files,
    { name: "manifest.json", data: manifest },
    { name: "signature", data: signManifest(manifest, cfg) },
  ]);
}

/** Orders a pass can describe: a live pre-order that hasn't shipped yet. */
export function isWalletEligible(order: { isPreorder: boolean; status: string; shippedAt?: Date | null }): boolean {
  if (!order.isPreorder || order.shippedAt) return false;
  return !["cancelled", "refunded", "refund_pending", "delivered", "shipped", "fulfilled"].includes(order.status);
}
