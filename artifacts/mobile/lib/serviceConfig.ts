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
import { storeContextHeaders, versionApiPath } from '@/lib/api';

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
      throw new ApiError(408, JSON.stringify({ error: { message: 'Request timed out. Please try again.', code: 'timeout' } }));
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
}

/**
 * Make an authenticated GET/POST/PATCH request to the Brandthread API.
 * Throws if services haven't been configured yet.
 */
export async function serviceRequest<T = unknown>(
  path: string,
  options: RequestInit = {},
  reportErrors = true,
): Promise<T> {
  await whenConfigured();
  const token = await _getToken!();
  const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
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
    const retry = !options.method || options.method === 'GET'
      ? () => serviceRequest<T>(path, options, reportErrors)
      : undefined;
    if (reportErrors) reportNetworkError(error, retry);
    throw error;
  }
  if (!res.ok) {
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
