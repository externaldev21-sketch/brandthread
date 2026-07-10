/**
 * Brandthread API client.
 * Base URL is resolved from EXPO_PUBLIC_API_BASE_URL (set in the dev script).
 * Every request attaches the Clerk Bearer token supplied by getToken().
 */

const BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  `https://${process.env.EXPO_PUBLIC_DOMAIN}/api-server`;

type GetToken = () => Promise<string | null>;

async function request<T = any>(
  path: string,
  options: RequestInit,
  getToken: GetToken,
): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
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

export function createApi(getToken: GetToken) {
  const get  = <T>(path: string) => request<T>(path, { method: 'GET' }, getToken);
  const post  = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST',  body: JSON.stringify(body) }, getToken);
  const put   = <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT',   body: JSON.stringify(body) }, getToken);
  const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }, getToken);
  const del   = <T>(path: string) => request<T>(path, { method: 'DELETE' }, getToken);

  return {
    auth: {
      sync:        ()             => post('/api/auth/sync', {}),
      me:          ()             => get('/api/auth/me'),
      onboarding:  (body: unknown) => patch('/api/auth/onboarding', body),
    },
    products: {
      list:           ()                       => get('/api/products'),
      get:            (id: string)             => get(`/api/products/${id}`),
      create:         (body: unknown)          => post('/api/products', body),
      update:         (id: string, body: unknown) => put(`/api/products/${id}`, body),
      archive:        (id: string)             => del(`/api/products/${id}`),
      addVariant:     (id: string, body: unknown) => post(`/api/products/${id}/variants`, body),
      updateVariant:  (id: string, vId: string, body: unknown) => patch(`/api/products/${id}/variants/${vId}`, body),
    },
    orders: {
      list:           ()                       => get('/api/orders'),
      get:            (id: string)             => get(`/api/orders/${id}`),
      create:         (body: unknown)          => post('/api/orders', body),
      updateStatus:   (id: string, status: string) => patch(`/api/orders/${id}/status`, { status }),
      addTracking:    (id: string, body: unknown)  => patch(`/api/orders/${id}/tracking`, body),
    },
    customers: {
      list:    (search?: string) => get(`/api/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
      get:     (id: string)      => get(`/api/customers/${id}`),
      create:  (body: unknown)   => post('/api/customers', body),
      update:  (id: string, body: unknown) => put(`/api/customers/${id}`, body),
    },
    drops: {
      list:    ()                       => get('/api/drops'),
      get:     (id: string)             => get(`/api/drops/${id}`),
      create:  (body: unknown)          => post('/api/drops', body),
      update:  (id: string, body: unknown) => patch(`/api/drops/${id}`, body),
    },
    analytics: {
      dashboard: () => get('/api/analytics/dashboard'),
      revenue:   (period: string) => get(`/api/analytics/revenue?period=${period}`),
    },
    logo: {
      generate: (brandName: string, style: string) => post<any>('/api/logo/generate', { brandName, style }),
    },
    mockup: {
      generate: (prompt: string) => post<any>('/api/mockup/generate', { prompt }),
    },
    photography: {
      generate: (images: string[], prompt: string) => post<any>('/api/photography/generate', { images, prompt }),
    },
    integrations: {
      klaviyoStatus:      () => get<any>('/api/integrations/klaviyo'),
      klaviyoConnect:     (apiKey: string) => post<any>('/api/integrations/klaviyo/connect', { apiKey }),
      klaviyoSync:        () => post<any>('/api/integrations/klaviyo/sync', {}),
      klaviyoDisconnect:  () => del<any>('/api/integrations/klaviyo'),
    },
  };
}

export type BrandthreadApi = ReturnType<typeof createApi>;
