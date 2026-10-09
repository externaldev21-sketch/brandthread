/**
 * Client for GET/PATCH /api/me/settings — account settings that follow the
 * signed-in user across devices (server: artifacts/api-server/src/lib/userSettings.ts).
 *
 * Callers (lib/buyerSettings.ts, socialService privacy, edit-profile) keep a
 * per-account local cache and only reach this module when
 * canSyncAccountServer() is true, so signed-out users and the dev web preview
 * never call it. A short per-account memo lets several screens share one GET.
 */
import { serviceRequest } from '@/lib/serviceConfig';
import { ApiError } from '@/lib/networkNotice';
import { ANON_SCOPE, getAccountStorageScope } from '@/lib/accountStorage';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';

export type AccountSettings = Record<string, unknown>;
export interface AccountSettingsResponse {
  settings: AccountSettings;
  updatedAt: string | null;
}

/** True when this session may call account APIs: signed in and not the dev web preview. */
export function canSyncAccountServer(userId: string = getAccountStorageScope()): boolean {
  return userId !== ANON_SCOPE && !isBuyerDevPreview() && !isSellerDevPreview();
}

const PATH = '/api/me/settings';
const FRESH_MS = 60_000;

const memo = new Map<string, { at: number; value: AccountSettingsResponse }>();
const inflight = new Map<string, Promise<AccountSettingsResponse>>();

function normalize(raw: unknown): AccountSettingsResponse {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const settings = obj.settings && typeof obj.settings === 'object' && !Array.isArray(obj.settings)
    ? obj.settings as AccountSettings : {};
  return { settings, updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : null };
}

function notAvailable(): ApiError {
  return new ApiError(401, JSON.stringify({ error: { message: 'Sign in required', code: 'auth_required' } }));
}

/** The signed-in account's settings. Reuses a result younger than a minute unless `force`. */
export async function fetchAccountSettings(opts: { force?: boolean } = {}): Promise<AccountSettingsResponse> {
  const uid = getAccountStorageScope();
  if (!canSyncAccountServer(uid)) throw notAvailable();
  const cached = memo.get(uid);
  if (!opts.force && cached && Date.now() - cached.at < FRESH_MS) return cached.value;
  let p = inflight.get(uid);
  if (!p) {
    p = serviceRequest<unknown>(PATH, {}, false).then(normalize);
    inflight.set(uid, p);
  }
  try {
    const value = await p;
    memo.set(uid, { at: Date.now(), value });
    return value;
  } finally {
    if (inflight.get(uid) === p) inflight.delete(uid);
  }
}

/** Shallow merge on the server (null resets a key). Returns the merged settings. */
export async function patchAccountSettings(patch: AccountSettings): Promise<AccountSettingsResponse> {
  const uid = getAccountStorageScope();
  if (!canSyncAccountServer(uid)) throw notAvailable();
  const value = normalize(await serviceRequest<unknown>(PATH, {
    method: 'PATCH', body: JSON.stringify(patch),
  }, false));
  memo.set(uid, { at: Date.now(), value });
  return value;
}

/** A rejection that retrying the same body can never fix (validation, auth). */
export function isPermanentSettingsError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 408 && error.status !== 429;
}

/** Resolve within `ms` or reject — settings screens fall back to the local cache. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Test-only. */
export function __resetAccountSettingsForTests(): void {
  memo.clear();
  inflight.clear();
}
