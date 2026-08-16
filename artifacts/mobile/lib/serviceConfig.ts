/**
 * Shared API access configuration for background services (analyticsService,
 * inventoryService, manufacturerService).
 *
 * Call configureServices(getToken) once from _layout.tsx after Clerk auth is ready.
 * Services call serviceRequest() which uses the stored token getter.
 * If called before configureServices(), throws so callers can fall back to demo data.
 */

type GetToken = () => Promise<string | null>;

let _getToken: GetToken | null = null;

/**
 * Wire all background services to the authenticated API client.
 * Call this in _layout.tsx after Clerk is loaded.
 */
export function configureServices(getToken: GetToken): void {
  _getToken = getToken;
}

/**
 * Make an authenticated GET/POST/PATCH request to the Brandthread API.
 * Throws if services haven't been configured yet.
 */
export async function serviceRequest<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!_getToken) throw new Error("Services not configured");
  const token = await _getToken();
  const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}
