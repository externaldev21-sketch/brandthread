/**
 * Install reporting for the admin install → sign-up → first purchase funnel
 * (POST /api/app/installs, server side in routes/app-installs.ts).
 *
 * - On the first launch of an install, a random id is generated and kept in
 *   AsyncStorage. Nothing about the device is read or sent: only that id,
 *   the platform and the app version.
 * - The install is reported once signed out, and once more after the first
 *   sign-in so the server can link it to the account.
 * - Native only: web is never an install, and preview / dev-bypass sessions
 *   never report.
 * - Best effort: any failure is retried on a later launch, never surfaced.
 *
 * Kept free of React Native imports (dependencies are injected) so it runs in
 * Node tests.
 */

export const INSTALL_STORAGE_KEY = 'bt:install:v1';

export type InstallState = { id: string; reported: boolean; linked: boolean };

export type InstallDeps = {
  storage: { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> };
  fetchImpl: typeof fetch;
  apiBase: string;
  newId: () => string | Promise<string>;
  platform: string;
  appVersion?: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseInstallState(raw: string | null): InstallState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<InstallState>;
    if (typeof v.id !== 'string' || !UUID.test(v.id)) return null;
    return { id: v.id, reported: v.reported === true, linked: v.linked === true };
  } catch {
    return null;
  }
}

/** Reads the install, creating it on first launch. `isNew` is true exactly once per install. */
export async function loadInstall(deps: InstallDeps): Promise<{ state: InstallState; isNew: boolean }> {
  const existing = parseInstallState(await deps.storage.getItem(INSTALL_STORAGE_KEY).catch(() => null));
  if (existing) return { state: existing, isNew: false };
  const state: InstallState = { id: String(await deps.newId()).toLowerCase(), reported: false, linked: false };
  await deps.storage.setItem(INSTALL_STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  return { state, isNew: true };
}

/**
 * Sends whatever the install still owes the server: the first report, and the
 * account link once a token is available. Returns the updated state.
 */
export async function reportInstall(deps: InstallDeps, state: InstallState, token: string | null): Promise<InstallState> {
  const needsReport = !state.reported;
  const needsLink = !!token && !state.linked;
  if (!needsReport && !needsLink) return state;
  try {
    const res = await deps.fetchImpl(`${deps.apiBase.replace(/\/$/, '')}/api/app/installs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(needsLink ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        installId: state.id,
        platform: deps.platform,
        ...(deps.appVersion ? { appVersion: deps.appVersion } : {}),
      }),
    });
    if (!res.ok) return state;
    const next: InstallState = { ...state, reported: true, linked: state.linked || needsLink };
    await deps.storage.setItem(INSTALL_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
    return next;
  } catch {
    return state;
  }
}

/** RFC 4122 v4 from any random source; used when expo-crypto isn't available. */
export function fallbackUuid(random: () => number = Math.random): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
