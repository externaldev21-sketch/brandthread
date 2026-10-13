import forge from "node-forge";

/** Throwaway self-signed "WWDR" + signer pair, so tests can sign real passes. */
export function makeTestWalletEnv(): Record<string, string> {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const make = (cn: string, serial: string) => {
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = serial;
    cert.validity.notBefore = new Date(Date.now() - 60_000);
    cert.validity.notAfter = new Date(Date.now() + 86_400_000);
    const attrs = [{ name: "commonName", value: cn }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    return forge.pki.certificateToPem(cert);
  };
  return {
    APPLE_WALLET_PASS_TYPE_ID: "pass.com.brandthread.test",
    APPLE_WALLET_TEAM_ID: "TEAM123456",
    APPLE_WALLET_SIGNER_CERT: make("Pass Type ID: pass.com.brandthread.test", "01"),
    APPLE_WALLET_SIGNER_KEY: forge.pki.privateKeyToPem(keys.privateKey),
    // Base64 of the PEM: the other accepted form.
    APPLE_WALLET_WWDR_CERT: Buffer.from(make("Test WWDR", "02")).toString("base64"),
  };
}

/** Reads the names + contents back out of a stored zip. */
export function readStoredZip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (buf.readUInt32LE(offset) === 0x04034b50) {
    const size = buf.readUInt32LE(offset + 18);
    const nameLength = buf.readUInt16LE(offset + 26);
    const name = buf.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength;
    files.set(name, buf.subarray(start, start + size));
    offset = start + size;
  }
  return files;
}
