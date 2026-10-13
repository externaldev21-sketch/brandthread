/**
 * Apple Wallet pass signing config. Every key is read from the server's
 * environment and the feature stays OFF until all of them are set: no pass
 * is built, the status endpoint answers `{ enabled: false }`, and the app
 * hides the "Add to Apple Wallet" button.
 *
 *   APPLE_WALLET_PASS_TYPE_ID   pass.com.brandthread.preorder (Identifiers → Pass Type IDs)
 *   APPLE_WALLET_TEAM_ID        10-character Apple Developer Team ID
 *   APPLE_WALLET_SIGNER_CERT    the Pass Type ID certificate, PEM (or base64 of the PEM)
 *   APPLE_WALLET_SIGNER_KEY     its private key, PEM (or base64 of the PEM)
 *   APPLE_WALLET_SIGNER_KEY_PASSPHRASE  optional, when the key is encrypted
 *   APPLE_WALLET_WWDR_CERT      Apple WWDR intermediate (G4), PEM (or base64)
 */

export interface WalletPassConfig {
  passTypeIdentifier: string;
  teamIdentifier: string;
  signerCertPem: string;
  signerKeyPem: string;
  signerKeyPassphrase?: string;
  wwdrCertPem: string;
}

/** Accepts a PEM as-is (with literal or escaped newlines) or base64 of a PEM. */
export function readPem(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.includes("-----BEGIN")) return raw.replace(/\\n/g, "\n");
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    return decoded.includes("-----BEGIN") ? decoded : null;
  } catch {
    return null;
  }
}

export function walletPassConfig(env: NodeJS.ProcessEnv = process.env): WalletPassConfig | null {
  const passTypeIdentifier = env.APPLE_WALLET_PASS_TYPE_ID?.trim();
  const teamIdentifier = env.APPLE_WALLET_TEAM_ID?.trim();
  const signerCertPem = readPem(env.APPLE_WALLET_SIGNER_CERT);
  const signerKeyPem = readPem(env.APPLE_WALLET_SIGNER_KEY);
  const wwdrCertPem = readPem(env.APPLE_WALLET_WWDR_CERT);
  if (!passTypeIdentifier || !teamIdentifier || !signerCertPem || !signerKeyPem || !wwdrCertPem) return null;
  return {
    passTypeIdentifier,
    teamIdentifier,
    signerCertPem,
    signerKeyPem,
    signerKeyPassphrase: env.APPLE_WALLET_SIGNER_KEY_PASSPHRASE?.trim() || undefined,
    wwdrCertPem,
  };
}
