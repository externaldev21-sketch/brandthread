/**
 * Shared API access configuration for background services (analyticsService,
 * inventoryService, manufacturerService).
 *
 * Call configureServices(getToken) once from _layout.tsx after Clerk auth is ready.
 * Services call serviceRequest() which uses the stored token getter.
 * If called before configureServices(), throws so callers can fall back to demo data.
 */

import {
  ApiError,
  dismissNetworkNotice,
  reportNetworkError,
} from '@/lib/networkNotice';
import { createApi, signedOutGate, signedOutPreviewAnswer, storeContextHeaders, versionApiPath } from '@/lib/api';
import { isSignedInOnlyPath } from '@/lib/guestApiPolicy';
import { isSellerDevPreview } from '@/lib/devPreview';
import { AUTO_RETRY_DELAY_MS, isTransientFailure, slowRequests } from '@/lib/requestResilience';

type GetToken = () => Promise<string | null>;

let _getToken: GetToken | null = null;
let _configured: Promise<void> | null = null;
let _resolveConfigured: (() => void) | null = null;

/**
 * Screens opened from a deep link or notification mount before the root
 * layout's effect wires auth in (child effects run first). Wait briefly for
 * configuration instead of failing the first request.
 */
/**
 * Every request gets a hard ceiling so a hung connection (dead server, black
 * hole route) always resolves into an error the caller can show instead of
 * leaving a screen's loading state stuck forever.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * fetch() with a hard timeout. A plain fetch() never rejects or resolves on
 * its own if the connection just hangs — AbortController is the only way to
 * bound it. A timeout surfaces as ApiError(408) so it flows through the same
 * classification/retry path as a real server timeout.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(408, JSON.stringify({ error: { message: 'Request timed out. Try again.', code: 'timeout' } }));
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function whenConfigured(timeoutMs = 8_000): Promise<void> {
  if (_getToken) return Promise.resolve();
  _configured ??= new Promise<void>((resolve) => { _resolveConfigured = resolve; });
  return Promise.race([
    _configured,
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error("Services not configured")), timeoutMs)),
  ]);
}

/**
 * Wire all background services to the authenticated API client.
 * Call this in _layout.tsx after Clerk is loaded.
 */
export function configureServices(getToken: GetToken): void {
  _getToken = getToken;
  _resolveConfigured?.();
  for (const fn of [..._configListeners]) { try { fn(); } catch { /* one listener must not break another */ } }
}

const _configListeners = new Set<() => void>();

/**
 * Called every time auth is re-wired (sign-in, sign-out, account switch), so
 * long-lived connections (the realtime messages socket) reconnect as the
 * account that is now active.
 */
export function onServicesConfigured(fn: () => void): () => void {
  _configListeners.add(fn);
  return () => { _configListeners.delete(fn); };
}

/** The active session token, or null when signed out / not configured yet. */
export async function getServiceToken(): Promise<string | null> {
  if (!_getToken) return null;
  try {
    return await _getToken();
  } catch {
    return null;
  }
}

/**
 * Whether a signed-in session token is available right now. Optional surfaces
 * (Sponsored placement) use this to avoid calling protected APIs signed out.
 */
export async function hasServiceToken(): Promise<boolean> {
  if (!_getToken) return false;
  try {
    return !!(await _getToken());
  } catch {
    return false;
  }
}

let _uploadApi: ReturnType<typeof createApi> | null = null;

/**
 * Upload one product photo through the same pipeline Add Product uses
 * (api.products.uploadImage → POST /api/products/images) for services that
 * have no React hook context — e.g. background draft sync. Resolves to the
 * stored object path/URL. Throws in the signed-out seller preview, like
 * every other protected call.
 */
export async function serviceUploadProductImage(image: { uri: string; mimeType?: string | null }): Promise<string> {
  if (isSellerDevPreview()) {
    throw new ApiError(403, JSON.stringify({
      error: { message: 'This action is unavailable in the signed-out seller preview.', code: 'dev_preview_offline' },
    }));
  }
  await whenConfigured();
  _uploadApi ??= createApi(() => _getToken!());
  const uploaded = await _uploadApi.products.uploadImage(image) as { objectPath?: string; url?: string } | null;
  const remote = uploaded?.objectPath || uploaded?.url;
  if (!remote) throw new Error('Upload returned no image path');
  return remote;
}

/**
 * Make an authenticated GET/POST/PATCH request to the Brandthread API.
 * Throws if services haven't been configured yet.
 */
export async function serviceRequest<T = unknown>(
  path: string,
  options: RequestInit = {},
  reportErrors = true,
  attempt = 0,
): Promise<T> {
  if (!_getToken) {
    const preview = await signedOutPreviewAnswer<T>(versionApiPath(path), options.method ?? 'GET');
    if (preview) return preview.data;
  }
  if (!_getToken && isSellerDevPreview()) {
    await signedOutGate<T>(versionApiPath(path), options.method ?? 'GET', async () => null);
  }
  await whenConfigured();
  // Same signed-out guard as lib/api.ts: no session never reaches a protected endpoint.
  const signedOut = await signedOutGate<T>(versionApiPath(path), options.method ?? 'GET', _getToken!);
  if (signedOut) return signedOut.data;
  const token = await _getToken!();
  // Guest guard (App Store 5.1.1(v)): no account-scoped/paid calls when signed out.
  if (!token && isSignedInOnlyPath(path)) {
    throw new ApiError(401, JSON.stringify({ error: { message: 'Sign in required', code: 'auth_required' } }));
  }
  const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
  const isRead = !options.method || options.method.toUpperCase() === 'GET';
  // Same as lib/api.ts: one quiet retry for a transient read failure, and
  // ordinary reads feed the slow-connection strip (lib/requestResilience.ts).
  const retryQuietly = (failure: unknown) => isRead && attempt === 0 && isTransientFailure(failure)
    ? new Promise((r) => setTimeout(r, AUTO_RETRY_DELAY_MS)).then(() =>
        serviceRequest<T>(path, options, reportErrors, attempt + 1))
    : null;
  const endSlowTracking = isRead && reportErrors ? slowRequests.start() : null;
  let res: Response;
  try {
    res = await fetchWithTimeout(`${base}${versionApiPath(path)}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...storeContextHeaders(),
        ...(options.headers ?? {}),
      },
    });
  } catch (error) {
    endSlowTracking?.();
    const quiet = retryQuietly(error);
    if (quiet) return quiet;
    const retry = !options.method || options.method === 'GET'
      ? () => serviceRequest<T>(path, options, reportErrors)
      : undefined;
    if (reportErrors) reportNetworkError(error, retry);
    throw error;
  }
  endSlowTracking?.();
  if (!res.ok) {
    const quiet = retryQuietly(res);
    if (quiet) return quiet;
    const body = await res.text();
    const error = new ApiError(res.status, body);
    const retry = !options.method || options.method === 'GET'
      ? () => serviceRequest<T>(path, options, reportErrors)
      : undefined;
    if (reportErrors) reportNetworkError(error, retry);
    throw error;
  }
  if (reportErrors) dismissNetworkNotice();
  return res.json() as Promise<T>;
}

/**
 * The signed-in session token + API base, for the realtime socket
 * (lib/realtime/userEvents.ts). Null when services aren't configured yet or
 * nobody is signed in.
 */
export async function serviceSession(): Promise<{ token: string; base: string } | null> {
  if (!_getToken) return null;
  const token = await _getToken().catch(() => null);
  return token ? { token, base: process.env.EXPO_PUBLIC_API_BASE_URL ?? "" } : null;
}
