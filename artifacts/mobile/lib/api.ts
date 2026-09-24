/**
 * Brandthread API client.
 * Base URL is resolved from EXPO_PUBLIC_API_BASE_URL (set in the dev script).
 * Every request attaches the Clerk Bearer token supplied by getToken().
 */
import { useAuth } from '@clerk/expo';
import type {
  AccountDeletionCheck, AccountSession, BlockedAccount, CommentThread, CreatedComment,
  ModerationAction, ModerationQueue, MutedWord, ReportReasonId, ReportTargetType,
} from './safetyTypes';
import { useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ApiError,
  dismissNetworkNotice,
  reportNetworkError,
} from '@/lib/networkNotice';
import type { FinanceSummary } from '@/lib/financeSummary';

const BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type GetToken = () => Promise<string | null>;
type GetCacheScope = () => string | Promise<string>;

const API_CACHE_PREFIX = 'bt:api-cache:v1:';
const API_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

type ApiCacheEntry<T> = { savedAt: number; data: T };

export function versionApiPath(path: string): string {
  if (path === '/api') return '/api/v1';
  if (path.startsWith('/api/v')) return path;
  return path.startsWith('/api/') ? `/api/v1/${path.slice(5)}` : path;
}

async function apiCacheKey(path: string, getCacheScope: GetCacheScope): Promise<string> {
  const scope = (await getCacheScope()) || 'anonymous';
  const store = _storeContext ?? 'joined';
  return `${API_CACHE_PREFIX}${encodeURIComponent(scope)}:${store}:${encodeURIComponent(path)}`;
}

async function readApiCache<T>(key: string): Promise<T | null> {
  try {
    const stored = await AsyncStorage.getItem(key);
    if (!stored) return null;
    const entry = JSON.parse(stored) as ApiCacheEntry<T>;
    if (!entry.savedAt || Date.now() - entry.savedAt > API_CACHE_MAX_AGE_MS) {
      await AsyncStorage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

async function writeApiCache<T>(key: string, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // Cache persistence is best-effort.
  }
}

export async function clearApiCache(cacheScope?: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const prefix = cacheScope
      ? `${API_CACHE_PREFIX}${encodeURIComponent(cacheScope)}:`
      : API_CACHE_PREFIX;
    const matches = keys.filter((key) => key.startsWith(prefix));
    if (matches.length > 0) await AsyncStorage.multiRemove(matches);
  } catch {
    // Cache cleanup must not block a mutation or account switch.
  }
}

// Seller payment readiness changes infrequently, but product browsing and
// checkout can ask for it repeatedly in a short window. Keep this cache in
// module scope so separate screen API clients share the same result.
export const SELLER_PAYMENT_STATUS_CACHE_TTL_MS = 60_000;

export interface SellerPaymentStatus {
  ready: boolean;
  reason?: string;
}

type SellerPaymentStatusCacheEntry = {
  status: SellerPaymentStatus;
  expiresAt: number;
};

const sellerPaymentStatusCache = new Map<string, SellerPaymentStatusCacheEntry>();
const sellerPaymentStatusInFlight = new Map<string, Promise<SellerPaymentStatus>>();
const sellerPaymentStatusGenerations = new Map<string, number>();

/**
 * Clear cached seller payment readiness. Checkout screens call this before a
 * user-initiated refresh so a refresh always gets a fresh server response.
 * With no sellerId, clear all sellers (useful when cart contents change).
 */
export function invalidateSellerPaymentStatusCache(sellerId?: string): void {
  if (sellerId) {
    sellerPaymentStatusCache.delete(sellerId);
    sellerPaymentStatusInFlight.delete(sellerId);
    sellerPaymentStatusGenerations.set(
      sellerId,
      (sellerPaymentStatusGenerations.get(sellerId) ?? 0) + 1,
    );
    return;
  }

  sellerPaymentStatusCache.clear();
  sellerPaymentStatusInFlight.clear();
  for (const sellerKey of sellerPaymentStatusGenerations.keys()) {
    sellerPaymentStatusGenerations.set(
      sellerKey,
      (sellerPaymentStatusGenerations.get(sellerKey) ?? 0) + 1,
    );
  }
}

async function getCachedSellerPaymentStatus(
  sellerId: string,
  fetchStatus: () => Promise<SellerPaymentStatus>,
): Promise<SellerPaymentStatus> {
  const now = Date.now();
  const cached = sellerPaymentStatusCache.get(sellerId);
  if (cached) {
    if (cached.expiresAt > now) return cached.status;
    sellerPaymentStatusCache.delete(sellerId);
  }

  const inFlight = sellerPaymentStatusInFlight.get(sellerId);
  if (inFlight) return inFlight;

  const generation = sellerPaymentStatusGenerations.get(sellerId) ?? 0;
  sellerPaymentStatusGenerations.set(sellerId, generation);
  const requestPromise = fetchStatus().then((status) => {
    // An explicit refresh may have started a newer generation while this
    // request was pending. Do not let the older response repopulate the cache.
    if ((sellerPaymentStatusGenerations.get(sellerId) ?? 0) === generation) {
      sellerPaymentStatusCache.set(sellerId, {
        status,
        expiresAt: Date.now() + SELLER_PAYMENT_STATUS_CACHE_TTL_MS,
      });
    }
    return status;
  });
  sellerPaymentStatusInFlight.set(sellerId, requestPromise);
  void requestPromise.then(
    () => {
      if (sellerPaymentStatusInFlight.get(sellerId) === requestPromise) {
        sellerPaymentStatusInFlight.delete(sellerId);
      }
    },
    () => {
      if (sellerPaymentStatusInFlight.get(sellerId) === requestPromise) {
        sellerPaymentStatusInFlight.delete(sellerId);
      }
    },
  );
  return requestPromise;
}

// ─── Store context switcher ───────────────────────────────────────────────────
// The client sends X-Store-Context: own for the user's store or the selected
// team_members.id for a joined store. 'joined' (or null) preserves the legacy
// newest-membership behavior for older sessions.
export type StoreContext = 'own' | 'joined' | (string & {});
let _storeContext: StoreContext | null = null;
const _storeContextListeners = new Set<(ctx: StoreContext | null) => void>();

export function storeContextStorageKey(userId: string): string {
  return `@brandthread/store_context:${userId}`;
}

export function storeContextHeaders(): Record<string, string> {
  return _storeContext && _storeContext !== 'joined'
    ? { 'X-Store-Context': _storeContext }
    : {};
}

/** Set the active store context. Call this from the switcher UI and persist
 *  the value to AsyncStorage for the next app launch. */
export function setStoreContext(ctx: StoreContext | null): void {
  _storeContext = ctx;
  _storeContextListeners.forEach((listener) => listener(ctx));
}

/** Read the current store context. */
export function getStoreContext(): StoreContext | null {
  return _storeContext;
}

/** Subscribe to context changes made by the store switcher. */
export function subscribeStoreContext(listener: (ctx: StoreContext | null) => void): () => void {
  _storeContextListeners.add(listener);
  return () => _storeContextListeners.delete(listener);
}

async function request<T = any>(
  path: string,
  options: RequestInit,
  getToken: GetToken,
  asText = false,
  getCacheScope: GetCacheScope = () => 'anonymous',
  reportErrors = true,
): Promise<T> {
  const resolvedPath = versionApiPath(path);
  const isRead = (options.method ?? 'GET').toUpperCase() === 'GET';
  const cacheKey = isRead && options.cache !== 'no-store' && !asText
    ? await apiCacheKey(resolvedPath, getCacheScope)
    : null;
  const token = await getToken();
  // Build a plain Record so TypeScript is happy with every HeadersInit variant.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...storeContextHeaders(),
    // Normalize any HeadersInit shape (Headers instance, string[][], or plain object).
    ...(options.headers
      ? options.headers instanceof Headers
        ? Object.fromEntries((options.headers as Headers).entries())
        : Array.isArray(options.headers)
          ? Object.fromEntries(options.headers as string[][])
          : (options.headers as Record<string, string>)
      : {}),
  };
  let res: Response;
  try {
    res = await fetch(`${BASE}${resolvedPath}`, { ...options, headers });
  } catch (error) {
    const retry = isRead
      ? () => request<T>(path, options, getToken, asText, getCacheScope, reportErrors)
      : undefined;
    const cached = cacheKey ? await readApiCache<T>(cacheKey) : null;
    if (reportErrors) reportNetworkError(error, retry, cached !== null);
    if (cached !== null) return cached;
    throw error;
  }
  if (!res.ok) {
    const body = await res.text();
    const error = new ApiError(res.status, body);
    const retry = isRead
      ? () => request<T>(path, options, getToken, asText, getCacheScope, reportErrors)
      : undefined;
    const cached = cacheKey && res.status >= 500 ? await readApiCache<T>(cacheKey) : null;
    if (reportErrors) reportNetworkError(error, retry, cached !== null);
    if (cached !== null) return cached;
    throw error;
  }
  if (reportErrors) dismissNetworkNotice();
  if (asText) return res.text() as Promise<T>;
  const data = await res.json() as T;
  if (cacheKey) {
    await writeApiCache(cacheKey, data);
  } else if (!isRead) {
    await clearApiCache(await getCacheScope());
  }
  return data;
}

async function uploadImage<T = any>(
  path: string,
  image: { uri: string; mimeType?: string | null },
  getToken: GetToken,
  getCacheScope: GetCacheScope = () => 'anonymous',
): Promise<T> {
  const source = await fetch(image.uri);
  if (!source.ok) {
    throw new Error("Could not read the selected image.");
  }
  const imageBlob = await source.blob();
  const contentType = image.mimeType || imageBlob.type || "image/jpeg";
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}${versionApiPath(path)}`, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...storeContextHeaders(),
      },
      body: imageBlob,
    });
  } catch (error) {
    reportNetworkError(error);
    throw error;
  }
  if (!res.ok) {
    const error = new ApiError(res.status, await res.text());
    reportNetworkError(error);
    throw error;
  }
  dismissNetworkNotice();
  const data = await res.json() as T;
  await clearApiCache(await getCacheScope());
  return data;
}

async function uploadVideo<T = any>(
  path: string,
  video: { uri: string; mimeType?: string | null },
  getToken: GetToken,
  getCacheScope: GetCacheScope = () => 'anonymous',
): Promise<T> {
  const source = await fetch(video.uri);
  if (!source.ok) throw new Error("Could not read the recorded video.");
  const videoBlob = await source.blob();
  const contentType = video.mimeType || videoBlob.type || "video/mp4";
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}${versionApiPath(path)}`, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...storeContextHeaders(),
      },
      body: videoBlob,
    });
  } catch (error) {
    reportNetworkError(error);
    throw error;
  }
  if (!res.ok) {
    const error = new ApiError(res.status, await res.text());
    reportNetworkError(error);
    throw error;
  }
  dismissNetworkNotice();
  const data = await res.json() as T;
  await clearApiCache(await getCacheScope());
  return data;
}
// ─── Ad Campaign Types ────────────────────────────────────────────────────────

export type AdCtaKind =
  | 'shop_now' | 'learn_more' | 'view_product' | 'sign_up' | 'contact_us';

export type AdCtaDestinationKind = 'product' | 'store' | 'profile' | 'contact';

export type AdFormatKind =
  | 'story_9x16' | 'square_1x1' | 'portrait_4x5' | 'landscape_16x9';

export type AdMediaKind = 'video' | 'photos';

export type AdCampaignStatus =
  | 'draft' | 'pending_payment' | 'active' | 'failed' | 'cancelled';

export interface AdCampaign {
  id: string;
  sellerId: string;
  mediaKind: AdMediaKind;
  mediaObjectPaths: string[];
  mediaMimeTypes: string[];
  /** Resolved signed URLs — parallel to mediaObjectPaths */
  mediaUrls: string[];
  headline: string | null;
  description: string | null;
  ctaKind: AdCtaKind | null;
  ctaDestinationKind: AdCtaDestinationKind | null;
  ctaDestinationId: string | null;
  formats: AdFormatKind[];
  budgetCents: number;
  durationDays: number;
  estimatedReachLow: number;
  estimatedReachHigh: number;
  estimatedReach: { low: number; high: number; label: 'estimate' };
  status: AdCampaignStatus;
  /** Stripe Checkout Session ID — persisted after /pay */
  stripeCheckoutSessionId: string | null;
  paidAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  creativeConfig: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/** Response from POST /api/ad-campaigns/:id/pay */
export interface AdCampaignCheckoutSession {
  sessionId: string;
  url: string;
  paymentStatus: 'paid' | 'unpaid' | 'no_payment_required';
  status: AdCampaignStatus;
}

export interface Freelancer {
  id: string;
  userId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  serviceType: string;
  skillTags: string[];
  hourlyRateCents: number;
  bio: string;
  portfolioUrls: string[];
  isActive: boolean;
  totalJobsCompleted: number;
  avgRatingTenths: number | null;
  /** Freelancer has begun Connect onboarding — hireable. */
  hasConnectedAccount: boolean;
  /** Connect account fully verified (charges + payouts enabled). */
  payoutsReady: boolean;
  stripeAccountStatus?: string | null;
  createdAt: string;
}

export interface FreelancerJob {
  id: string;
  freelancerId: string;
  sellerId: string;
  title: string;
  description: string;
  agreedPriceCents: number;
  status: 'pending' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';
  paymentStatus: 'unpaid' | 'paid' | 'refunded';
  platformFeeCents: number;
  freelancerPayoutCents: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Extras returned by list/get endpoints. */
  role?: 'hirer' | 'freelancer';
  freelancerName?: string;
  freelancerAvatarUrl?: string | null;
  freelancerUserId?: string;
  hirerName?: string;
  hirerAvatarUrl?: string | null;
  serviceType?: string;
}

export interface LocalUserProfile {
  id: string;
  clerkId: string;
  email: string;
  name: string;
  displayName: string | null;
  bio: string | null;
  website: string | null;
  username: string | null;
  accountType: 'buyer' | 'seller' | null;
  appThemeId: string;
  appIconId: string | null;
  brandName: string | null;
  onboardingComplete: boolean;
  /** Version of the Terms/Guidelines/Privacy Policy the person agreed to. */
  termsVersion?: string | null;
  termsAcceptedAt?: string | null;
  /** Set when a moderator suspends the account. */
  suspendedAt?: string | null;
}

export interface ShopifyImportJob {
  id: string;
  sourceUrl: string;
  status: 'queued' | 'running' | 'needs_continuation' | 'complete' | 'failed';
  stage: 'validating' | 'fetching_products' | 'counting_products' | 'analyzing_brand' | 'creating_listings' | 'building_storefront';
  importedCount: number;
  failedCount: number;
  hasMore: boolean;
  sourceStoreName: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface PostAnalyticsResponse {
  post: {
    id: string;
    mediaType: string;
    mediaUrl: string;
    caption: string | null;
    createdAt: string;
  };
  metrics: {
    likes: number;
    reposts: number;
    views: {
      tracked: boolean;
      count: number | null;
      uniqueViewers: number | null;
    };
    saves: {
      tracked: true;
      count: number;
    };
    productClicks: {
      tracked: true;
      count: number;
      uniqueClickers: number;
    };
    conversions: {
      tracked: true;
      orders: number;
      revenueCents: number;
      rate: number | null;
    };
    retention: {
      tracked: boolean;
      sampleCount: number;
      averageWatchTimeSeconds: number | null;
    };
  };
}
export function createApi(getToken: GetToken, getCacheScope: GetCacheScope = () => 'anonymous') {
  const get     = <T>(path: string) => request<T>(path, { method: 'GET' }, getToken, false, getCacheScope);
  const freshGet = <T>(path: string) => request<T>(path, { method: 'GET', cache: 'no-store' }, getToken, false, getCacheScope);
  const quietGet = <T>(path: string) => request<T>(path, { method: 'GET' }, getToken, false, getCacheScope, false);
  const getText  = (path: string)   => request<string>(path, { method: 'GET' }, getToken, true, getCacheScope);
  const post  = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST',  body: JSON.stringify(body) }, getToken, false, getCacheScope);
  const put   = <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT',   body: JSON.stringify(body) }, getToken, false, getCacheScope);
  const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }, getToken, false, getCacheScope);
  const del   = <T>(path: string) => request<T>(path, { method: 'DELETE' }, getToken, false, getCacheScope);

  return {
    config: {
      featureFlags: () =>
        get<{ flags: Record<string, boolean>; updatedAt: string | null }>('/api/config/features'),
    },
    auth: {
      /** Create the matching local user record after Clerk authentication.
       * During onboarding, pass the name that the person explicitly entered so
       * it wins over incomplete OAuth provider profile data. */
      sync:        (body: { name?: string } = {}) =>
        post<LocalUserProfile>('/api/auth/sync', body),
      me:          ()             => get<LocalUserProfile>('/api/auth/me'),
      onboarding:  (body: unknown) => patch('/api/auth/onboarding', body),
      completeOnboarding: (accountType: 'buyer' | 'seller', expectedClerkId?: string) =>
        post<LocalUserProfile>('/api/auth/onboarding/complete', {
          accountType,
          ...(expectedClerkId ? { expectedClerkId } : {}),
        }),
      saveBuyerPreferences: (styleInterests: string[], expectedClerkId: string) =>
        patch<{ ok: boolean }>('/api/auth/onboarding/buyer-preferences', {
          styleInterests,
          expectedClerkId,
        }),
      /** Check whether a username handle is available for the current user.
       *  Returns { available: true } if free (or already owned by this user),
       *  { available: false, error: string } if taken or invalid format. */
      checkUsername: (username: string) =>
        get<{ available: boolean; error?: string }>(
          `/api/auth/username/check?username=${encodeURIComponent(username)}`
        ),
      /** Update editable profile fields. username must be letters/numbers/underscores, 3-30 chars. */
      updateProfile: (body: {
        displayName?: string;
        brandName?:   string;
        bio?:         string;
        website?:     string;
        name?:        string;
        username?:    string;
        accountType?: 'buyer' | 'seller';
        appThemeId?: string;
        appIconId?: string | null;
        expectedClerkId?: string;
      }) => patch<any>('/api/auth/profile', body),
      /** Permanently erase this account after the explicit DELETE confirmation. */
      deleteAccount: () => request<{ ok: true }>(
        '/api/auth/account',
        { method: 'DELETE', body: JSON.stringify({ confirmation: 'DELETE' }) },
        getToken,
        false,
        getCacheScope,
      ),
      /** Everything deletion removes/retains, plus anything that must be settled first. */
      deletionCheck: () => freshGet<AccountDeletionCheck>('/api/auth/account/deletion-check'),
      /** Record agreement to the Terms, Community Guidelines and Privacy Policy version shown. */
      acceptLegal: (version: string) =>
        post<{ termsVersion: string; termsAcceptedAt: string }>('/api/auth/legal-acceptance', { version }),
      /** Real Clerk sessions for this account (Login Activity). */
      sessions: () => freshGet<{ sessions: AccountSession[] }>('/api/auth/sessions'),
      revokeSession: (sessionId: string) =>
        del<{ ok: boolean; revoked: number }>(`/api/auth/sessions/${encodeURIComponent(sessionId)}`),
      revokeOtherSessions: () =>
        post<{ ok: boolean; revoked: number }>('/api/auth/sessions/revoke-others', {}),
      /** Download an authenticated portability export for the active account. */
      exportData: (include: Array<'profile' | 'orders' | 'messages'>) =>
        post<{
          exportedAt: string;
          include: string[];
          profile?: unknown;
          orders?: unknown[];
          messages?: { conversations: unknown[]; messages: unknown[] };
        }>('/api/auth/data-export', { include }),
    },
    products: {
      list:           ()                       => get('/api/products'),
      publicList:     (ownerId?: string)       =>
        get<any[]>(`/api/public/products${ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : ''}`),
      get:            (id: string)             => get(`/api/products/${id}`),
      create:         (body: unknown)          => post('/api/products', body),
      update:         (id: string, body: unknown) => put(`/api/products/${id}`, body),
      archive:        (id: string)             => del(`/api/products/${id}`),
      restore:        (id: string)             => post(`/api/products/${id}/restore`, {}),
      addVariant:     (id: string, body: unknown) => post(`/api/products/${id}/variants`, body),
      updateVariant:  (id: string, vId: string, body: unknown) => patch(`/api/products/${id}/variants/${vId}`, body),
      /** Bulk-import products from a rows array. Returns { successCount, failCount, errors }. */
      import: (rows: Array<{ name: string; description?: string; category?: string; price?: string }>) =>
        post<{ successCount: number; failCount: number; errors?: string[] }>('/api/products/import', { rows }),
      /** Upload one product photo and return the URL to store in `images`. */
      uploadImage: (image: { uri: string; mimeType?: string | null }) =>
        uploadImage<{ objectPath: string }>('/api/products/images', image, getToken, getCacheScope),
    },
    ipCases: {
      create: (body: { listingProductId: string; claimantName: string; claimantEmail: string; rightsType: string; description: string; evidenceReferences: string[] }) =>
        post<{ caseReference: string; statusToken: string; status: string }>('/api/ip-cases', body),
      status: (caseReference: string, token: string) =>
        get<{ caseReference: string; status: string }>(`/api/ip-cases/${encodeURIComponent(caseReference)}/status?token=${encodeURIComponent(token)}`),
    },
    orders: {
      list:           ()                       => quietGet('/api/orders'),
      get:            (id: string)             => get(`/api/orders/${id}`),
      create:         (body: unknown)          => post('/api/orders', body),
      updateStatus:   (id: string, status: string, opts?: { reason?: string; notes?: string }) =>
        patch(`/api/orders/${id}/status`, { status, ...opts }),
      addTracking:    (id: string, body: unknown)  => patch(`/api/orders/${id}/tracking`, body),
      updateTracking: (id: string, body: {
        trackingStatus: 'label_created' | 'accepted' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | 'returned_to_sender';
        estimatedDelivery?: string | null;
      }) => patch(`/api/orders/${id}/tracking`, body),
    },
    customers: {
      list:    (search?: string) => get(`/api/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
      get:     (id: string)      => quietGet(`/api/customers/${id}`),
      create:  (body: unknown)   => post('/api/customers', body),
      update:  (id: string, body: unknown) => put(`/api/customers/${id}`, body),
      /** Overwrite customer tags array */
      addTag:  (id: string, tags: string[]) => put<any>(`/api/customers/${id}`, { tags }),
      /** Full order history for one customer */
      orders:  (id: string) => quietGet<any[]>(`/api/customers/${id}/orders`),
    },
    drops: {
      list:    ()                       => get('/api/drops'),
      get:     (id: string)             => get(`/api/drops/${id}`),
      create:  (body: unknown)          => post('/api/drops', body),
      update:  (id: string, body: unknown) => patch(`/api/drops/${id}`, body),
      /** Return the number of unique recipients who would receive a drop broadcast. */
      broadcastPreview: (dropId: string) =>
        get<{ followers: number }>(`/api/drops/${encodeURIComponent(dropId)}/broadcast-preview`),
      /** Send a push broadcast to followers when a drop goes live. */
      broadcast: (dropId: string) =>
        post<{ ok: boolean; sent: number; errors: number; followers: number }>(
          `/api/drops/${encodeURIComponent(dropId)}/broadcast`, {}
        ),
      /** Schedule the follower broadcast for the drop's releaseAt. */
      scheduleBroadcast: (dropId: string, scheduledBroadcastAt: string) =>
        patch<any>(`/api/drops/${encodeURIComponent(dropId)}`, { scheduledBroadcastAt }),
    },
    analytics: {
      dashboard:  () => get('/api/analytics/dashboard'),
      home: (range: 'live' | 'today' | 'yesterday' | 'week') =>
        get<{
          range: string;
          totalCents: number;
          orderCount: number;
          visitorCount: number;
          toFulfill: number;
          toCapture: number;
          buckets: Array<{ bucket: string; totalCents: number; orderCount: number }>;
        }>(`/api/analytics/home?range=${range}`),
      revenue:    (period: string) => get(`/api/analytics/revenue?period=${period}`),
      products:   () => get<any[]>('/api/analytics/products'),
      /** Top customers by spend + repeat-buyer stats — derived from real orders */
      customers:  (limit = 10) => get<{
        topCustomers: Array<{
          buyerId: string | null; customerId: string | null; name: string; email: string;
          orderCount: number; totalCents: number;
          lastOrderAt: string | null; firstOrderAt: string | null;
        }>;
        stats: { totalCustomers: number; repeatCustomers: number; repeatRate: number; avgOrdersPerCustomer: number };
      }>(`/api/analytics/customers?limit=${limit}`),
    },
    inventory: {
      list:   () => get<any[]>('/api/inventory'),
      adjust: (variantId: string, body: { delta?: number; newStock?: number }) =>
        patch<any>(`/api/inventory/${variantId}/adjust`, body),
    },
    discounts: {
      list:   () => get<any[]>('/api/discount-codes'),
      create: (body: { code: string; type: 'percentage' | 'fixed' | 'free_shipping'; value: number; minOrderCents?: number; maxUses?: number | null; expiresAt?: string | null }) =>
        post<any>('/api/discount-codes', body),
      update: (id: string, body: { active?: boolean; expiresAt?: string | null }) =>
        patch<any>(`/api/discount-codes/${encodeURIComponent(id)}`, body),
      remove: (id: string) => del<any>(`/api/discount-codes/${encodeURIComponent(id)}`),
    },
    /** Manufacturer hub — public directory, invite tokens, threads, sample orders, drop wallets. */
    manufacturers: {
      public: {
        list: (params?: { q?: string; country?: string; specialty?: string }) => {
          const qs = params ? '?' + Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&') : '';
          return get<any[]>(`/api/manufacturers/public${qs}`);
        },
        get:   (id: string)  => get<any>(`/api/manufacturers/public/${encodeURIComponent(id)}`),
        apply: (body: any)   => post<any>('/api/manufacturers/public/apply', body),
      },
      inviteTokens: {
        create: (body: { companyName?: string; contactName?: string; contactEmail?: string; notes?: string }) =>
          post<any>('/api/manufacturers/invite-tokens', body),
        list:    () => get<any[]>('/api/manufacturers/invite-tokens'),
        resolve: (token: string) => get<any>(`/api/manufacturers/invite-tokens/resolve/${encodeURIComponent(token)}`),
      },
      registerViaInvite: (token: string, body: any) =>
        post<any>(`/api/manufacturers/register-via-invite/${encodeURIComponent(token)}`, body),
      /** Upload a factory/production photo for the signed-in manufacturer.
       *  Requires an already-registered manufacturer profile (invite/claim
       *  flow) — anonymous public applications cannot attach photos. */
      uploadPhoto: (image: { uri: string; mimeType?: string | null }) =>
        uploadImage<{ photo: string; photos: string[]; revision: number }>(
          '/api/manufacturers/me/photos', image, getToken, getCacheScope,
        ),
      favorites: {
        list: () => get<Array<{ manufacturerId: string; createdAt: string }>>('/api/manufacturers/favorites'),
        add: (manufacturerId: string) =>
          post<{ manufacturerId: string; createdAt: string }>('/api/manufacturers/favorites', { manufacturerId }),
        remove: (manufacturerId: string) =>
          del<{ ok: boolean }>(`/api/manufacturers/favorites/${encodeURIComponent(manufacturerId)}`),
      },
      threads: {
        list:   () => get<any[]>('/api/manufacturers/threads'),
        create: (body: { manufacturerId: string; subject?: string }) =>
          post<any>('/api/manufacturers/threads', body),
        uploadAttachment: (
          threadId: string,
          image: { uri: string; mimeType?: string | null },
        ) => uploadImage<{ objectPath: string }>(
          `/api/manufacturers/threads/${encodeURIComponent(threadId)}/attachments`,
          image,
          getToken,
          getCacheScope,
        ),
        messages: {
          list: (threadId: string) => get<any[]>(`/api/manufacturers/threads/${encodeURIComponent(threadId)}/messages`),
          send: (threadId: string, body: { clientRequestId: string; content?: string; messageType?: string; mediaUrls?: string[]; cardData?: any }) =>
            post<any>(`/api/manufacturers/threads/${encodeURIComponent(threadId)}/messages`, body),
        },
      },
      connect: {
        onboard: (body?: { refreshUrl?: string; returnUrl?: string }) =>
          post<{ url: string; stripeAccountId: string }>('/api/manufacturers/connect/onboard', body ?? {}),
        status: () => get<{
          connected: boolean;
          stripeAccountId?: string;
          chargesEnabled: boolean;
          payoutsEnabled: boolean;
          detailsSubmitted: boolean;
          ready?: boolean;
          requirementsDue?: string[];
          disabledReason?: string | null;
          recovery?: string | null;
          status: 'not_started' | 'pending' | 'active' | string;
        }>('/api/manufacturers/connect/status'),
        payments: () => get<Array<{
          id: string;
          category: 'payment' | 'payout';
          type: string;
          sampleOrderId?: string | null;
          orderTitle?: string | null;
          orderType?: 'sample' | 'bulk' | null;
          metadata?: Record<string, unknown> | null;
          createdAt: string;
        }>>('/api/manufacturers/connect/payments'),
      },
      sampleOrders: {
        list:       () => get<any[]>('/api/sample-orders'),
        create:     (body: any) => post<any>('/api/sample-orders', body),
        get:        (id: string) => get<any>(`/api/sample-orders/${encodeURIComponent(id)}`),
        createCheckoutSession: (id: string, returnUrl: string) =>
          post<{ sessionId: string; url: string | null; paymentStatus: string }>(
            `/api/sample-orders/${encodeURIComponent(id)}/checkout-session`, { returnUrl },
          ),
        confirmPayment: (id: string) =>
          post<any>(`/api/sample-orders/${encodeURIComponent(id)}/pay`, {}),
        paymentOptions: (id: string) =>
          get<{ orderId: string; requiredCents: number; wallets: Array<{ id: string; dropId: string; availableCents: number; eligible: boolean }> }>(
            `/api/sample-orders/${encodeURIComponent(id)}/payment-options`,
          ),
        advance:    (id: string) => patch<any>(`/api/sample-orders/${encodeURIComponent(id)}/advance`, {}),
        addTracking: (id: string, body: { trackingNumber: string; carrier?: string }) =>
          patch<any>(`/api/sample-orders/${encodeURIComponent(id)}/tracking`, body),
        payFromWallet: (id: string, walletId: string) =>
          post<any>(`/api/sample-orders/${encodeURIComponent(id)}/pay-from-wallet`, { walletId }),
      },
      dropWallets: {
        create:       (dropId: string) => post<any>(`/api/drop-wallets/${encodeURIComponent(dropId)}`, {}),
        get:          (dropId: string) => get<any>(`/api/drop-wallets/${encodeURIComponent(dropId)}`),
        deposit:      (dropId: string, body: { orderId: string; amountCents: number }) =>
          post<any>(`/api/drop-wallets/${encodeURIComponent(dropId)}/deposit`, body),
        releaseOrder: (dropId: string, orderId: string) =>
          post<any>(`/api/drop-wallets/${encodeURIComponent(dropId)}/release-order/${encodeURIComponent(orderId)}`, {}),
        payShipping:  (dropId: string, orderId: string, body: { labelCents: number; carrier?: string; trackingNumber?: string }) =>
          post<any>(`/api/drop-wallets/${encodeURIComponent(dropId)}/pay-shipping/${encodeURIComponent(orderId)}`, body),
      },
    },
    sellerHub: {
      manufacturers: () => get<any[]>('/api/seller-hub/manufacturers'),
      quoteRequests: {
        list:   () => get<any[]>('/api/seller-hub/quote-requests'),
        get:    (id: string) => get<any>(`/api/seller-hub/quote-requests/${id}`),
        create: (body: {
          manufacturerId: string; type?: string; productName: string;
          productType?: string; quantity?: number; colorways?: string; details?: string;
        }) => post<any>('/api/seller-hub/quote-requests', body),
        update: (id: string, body: {
          status?: string;
          counteroffer?: {
            desiredUnitPriceCents?: number;
            desiredMoq?: number;
            desiredProductionDays?: number;
            desiredPaymentTerms?: string;
            notes?: string;
          };
        }) =>
          patch<any>(`/api/seller-hub/quote-requests/${id}`, body),
      },
    },
    push: {
      register:   (body: { token: string; platform?: string }) =>
        post<{ ok: boolean }>('/api/push/register', body),
      deregister: (token: string) =>
        request<{ ok: boolean }>(
          '/api/push/deregister',
          { method: 'DELETE', body: JSON.stringify({ token }) },
          getToken,
        ),
    },
    notifications: {
      trackEvent: (body: {
        notificationId: string;
        eventType: 'receipt' | 'open' | 'tap';
        occurredAt?: string;
      }) => post<{ ok: boolean; recorded: boolean }>('/api/notifications/events', body),
    },
    notificationPrefs: {
      get: () =>
        get<{
          digest: 'realtime' | 'daily';
          role: 'buyer' | 'seller';
          pushEnabled: boolean;
          quietHours: { start: string | null; end: string | null; timezone: string };
          categories: Record<string, boolean>;
        }>('/api/notification-prefs'),
      update: (body: {
        digest?: 'realtime' | 'daily';
        categories?: Record<string, boolean>;
        pushEnabled?: boolean;
        quietHours?: { start: string; end: string; timezone?: string } | null;
      }) =>
        put<{
          digest: 'realtime' | 'daily';
          role: 'buyer' | 'seller';
          pushEnabled: boolean;
          quietHours: { start: string | null; end: string | null; timezone: string };
          categories: Record<string, boolean>;
        }>('/api/notification-prefs', body),
    },
    logo: {
      generate: (brandName: string, style: string) => post<any>('/api/logo/generate', { brandName, style }),
      onboardingSample: (brandName: string, style: string) =>
        post<{ b64_json: string }>('/api/onboarding-sample/logo', { brandName, style }),
    },
    mockup: {
      generate: (
        prompt: string,
        referenceImage?: string,
        mode: 'text_to_design' | 'sketch_to_design' | 'prompt_edit' = referenceImage ? 'prompt_edit' : 'text_to_design',
      ) =>
        post<any>('/api/mockup/generate', { prompt, mode, ...(referenceImage ? { referenceImage } : {}) }),
    },
    photography: {
      generate: (
        images: string[],
        prompt: string,
        mode: 'photoshoot' | 'mockup_to_model' = 'photoshoot',
      ) => post<any>('/api/photography/generate', { images, prompt, mode }),
      generateOutfitSwap: (
        heroImage: string,
        garmentImages: string[],
        prompt: string,
      ) => post<{
        results: { garmentIndex: number; b64_json: string }[];
        errors?: { garmentIndex: number }[];
      }>('/api/photography/outfit-swap', { heroImage, garmentImages, prompt }),
      retryOutfitSwap: (
        heroImage: string,
        garmentImage: string,
        garmentIndex: number,
        prompt: string,
      ) => post<{
        garmentIndex: number;
        b64_json: string;
      }>('/api/photography/outfit-swap/retry', { heroImage, garmentImage, garmentIndex, prompt }),
    },
    bgRemoval: {
      /**
       * Remove the background from a base64 data-URL image.
       * Returns: { b64_json, storageKey, size, mime, createdAt, id }
       */
      remove: (image: string) => post<{
        b64_json: string;
        storageKey: string | null;
        size: number;
        mime: string;
        createdAt: string;
        id: string;
      }>('/api/bg-removal/remove', { image }),
      replace: (body: {
        image: string; backgroundImage?: string; prompt?: string; color?: string; bgType?: string;
      }) => post<{ b64_json: string }>('/api/bg-removal/replace', body),
    },
    lifestyle: {
      generate: (referenceImages: string[], productImages: string[], prompt: string) =>
        post<any>('/api/lifestyle/generate', { referenceImages, productImages, prompt }),
    },
    techpack: {
      generate: (payload: {
        productName: string;
        brandName: string;
        category: string;
        season: string;
        styleNumber: string;
        description: string;
        colorways: string[];
        materialsNotes: string;
        printPlacementNotes: string;
        careNotes: string;
        sizeChart: { sizes: string[]; rows: { point: string; values: Record<string, string> }[] };
        photos: string[];
      }) => post<any>('/api/techpack/generate', payload),
    },
    integrations: {
      klaviyoStatus:      () => get<any>('/api/integrations/klaviyo'),
      klaviyoConnect:     (apiKey: string) => post<any>('/api/integrations/klaviyo/connect', { apiKey }),
      klaviyoSync:        () => post<any>('/api/integrations/klaviyo/sync', {}),
      klaviyoDisconnect:  () => del<any>('/api/integrations/klaviyo'),
    },
    buyer: {
      addresses: {
        list:   () => get<any[]>('/api/buyer/addresses'),
        autocomplete: (query: string, country = 'US') =>
          get<Array<{ placeId: string; label: string }>>(
            `/api/buyer/address-suggestions?q=${encodeURIComponent(query)}&country=${encodeURIComponent(country)}`,
          ),
        resolveSuggestion: (placeId: string) =>
          get<{
            line1: string;
            city: string;
            state: string;
            postalCode: string;
            country: string;
          }>(`/api/buyer/address-suggestions/${encodeURIComponent(placeId)}`),
        create: (body: any) => post<any>('/api/buyer/addresses', body),
        update: (id: string, body: any) => patch<any>(`/api/buyer/addresses/${encodeURIComponent(id)}`, body),
        delete: (id: string) => del<void>(`/api/buyer/addresses/${encodeURIComponent(id)}`),
        setDefault: (id: string) => post<any>(`/api/buyer/addresses/${encodeURIComponent(id)}/default`, {}),
      },
      checkout: {
        /** Create a Stripe Checkout Session. Returns { sessionId, url }. */
        createSession: (
          items: { variantId: string; productId: string; quantity: number }[],
          opts: {
            contactEmail: string;
            contactPhone: string;
            shippingAddress?: {
              recipientName: string; street: string; line2?: string; city: string;
              state: string; postalCode: string; country?: string; phone: string;
            };
            /** Per-seller idempotency key (format: {checkoutSessionId}_{sellerId}).
             *  The server uses this to detect and reuse an identical in-flight session
             *  (e.g. after a component remount) without creating a duplicate Stripe charge.
             *  A UNIQUE DB index makes this race-condition-safe server-side. */
            clientIdempotencyKey?: string;
            /** One-time rewards token created by /api/loyalty/redeem. */
            loyaltyToken?: string;
          },
        ) =>
          post<{ sessionId: string; url: string }>('/api/buyer/checkout/session', {
            items,
            successUrl: 'mobile://checkout/return?session_id={CHECKOUT_SESSION_ID}',
            cancelUrl:  'mobile://checkout/cancel',
            ...(opts.contactEmail          ? { contactEmail:          opts.contactEmail          } : {}),
            ...(opts.contactPhone          ? { contactPhone:          opts.contactPhone          } : {}),
            ...(opts.shippingAddress       ? { shippingAddress:       opts.shippingAddress       } : {}),
            ...(opts.clientIdempotencyKey  ? { clientIdempotencyKey:  opts.clientIdempotencyKey  } : {}),
            ...(opts.loyaltyToken          ? { loyaltyToken:          opts.loyaltyToken          } : {}),
          }),
        /** Verify payment status after Stripe redirect.
         *  Returns { status, paymentStatus, amountTotal, orderId?, orderNumber?, declineReason? }. */
        verifySession: (sessionId: string) =>
          get<{
            status: string;
            paymentStatus: string;
            amountTotal: number | null;  // Stripe's authoritative charge in cents
            orderId: string | null;
            orderNumber: string | null;
            /** Plain-language decline reason from Stripe, when available. Never a raw Stripe string. */
            declineReason: string | null;
          }>(`/api/buyer/checkout/session/${encodeURIComponent(sessionId)}`),
      },
      orders: {
        list:   () => get<any[]>('/api/buyer/orders'),
        get:    (id: string) => get<any>(`/api/buyer/orders/${encodeURIComponent(id)}`),
        /** Cancel a pending order within the 60-minute window. Returns { cancelled, refunded, orderNumber }. */
        cancel: (id: string) => post<{ cancelled: boolean; refunded: boolean; orderNumber: string }>(
          `/api/buyer/orders/${encodeURIComponent(id)}/cancel`, {}
        ),
      },
      /** Saved / wishlisted items — DB-backed. */
      saved: {
        list:   () => get<any[]>('/api/buyer/saved'),
        save:   (body: { type: string; targetId: string; title: string; subtitle?: string; accentColor?: string }) =>
          post<any>('/api/buyer/saved', body),
        remove: (targetId: string) => del<any>(`/api/buyer/saved/${encodeURIComponent(targetId)}`),
      },
      /** Server-side cart — full-replace sync model. */
      cart: {
        load: () => get<{ items: any[]; savedItems: any[] }>('/api/buyer/cart'),
        sync: (items: any[], savedItems: any[]) =>
          post<{ ok: boolean; count: number }>('/api/buyer/cart/sync', { items, savedItems }),
        clear: () => del<{ ok: boolean }>('/api/buyer/cart'),
      },
      /** In-app notification feed. */
      notifications: {
        list:       () => get<any[]>('/api/buyer/notifications'),
        markRead:   (id: string) => patch<{ ok: boolean }>(`/api/buyer/notifications/${encodeURIComponent(id)}/read`, {}),
        markAllRead: () => patch<{ ok: boolean }>('/api/buyer/notifications/read-all', {}),
        delete:     (id: string) => del<{ ok: boolean }>(`/api/buyer/notifications/${encodeURIComponent(id)}`),
      },
      /** Check whether a seller's Stripe Connect account can accept payments.
       *  Returns { ready: boolean, reason?: string }. */
      sellerPaymentStatus: (sellerId: string) =>
        getCachedSellerPaymentStatus(
          sellerId,
          () => get<SellerPaymentStatus>(
            `/api/buyer/seller-payment-status/${encodeURIComponent(sellerId)}`
          ),
        ),
    },
    guest: {
      checkout: {
        createSession: (
          items: { variantId: string; productId: string; quantity: number }[],
          opts: {
            contactEmail: string;
            contactPhone: string;
            shippingAddress?: {
              name?: string; street: string; line2?: string; city: string;
              state: string; zip: string; country?: string; phone: string;
            };
            clientIdempotencyKey?: string;
          },
        ) => post<{ sessionId: string; url: string; guestAccessToken: string }>('/api/guest/checkout/session', {
          items,
          successUrl: 'mobile://checkout/return?session_id={CHECKOUT_SESSION_ID}',
          cancelUrl:  'mobile://checkout/cancel',
          ...opts,
        }),
        verifySession: (sessionId: string, guestAccessToken: string) =>
          post<{
            status: string;
            paymentStatus: string;
            amountTotal: number | null;
            orderId: string | null;
            orderNumber: string | null;
            orderStatus: string | null;
          }>(`/api/guest/checkout/session/${encodeURIComponent(sessionId)}/verify`, { guestAccessToken }),
      }
    },
    /** DM conversations between buyers and sellers. */
    conversations: {
      list:    () => quietGet<any[]>('/api/conversations'),
      get:     (id: string) => get<any>(`/api/conversations/${encodeURIComponent(id)}`),
      /** Create a new conversation or return the existing one between the same two participants. */
      createOrGet: (body: {
        type: string;
        participant: { userId: string; name: string; handle: string; initials: string; color: string; accountType: string };
        myInfo?: { name: string; handle: string; initials: string; color: string; accountType: string };
        contextOrderId?: string; contextOrderNumber?: string; contextOrderStatus?: string;
        contextProductId?: string; contextProductName?: string; contextSellerName?: string;
      }) => post<any>('/api/conversations', body),
      messages:   (id: string, limit = 50) =>
        get<any[]>(`/api/conversations/${encodeURIComponent(id)}/messages?limit=${limit}`),
      send:       (id: string, body: { text: string; attachment?: any; replyToId?: string }) =>
        post<any>(`/api/conversations/${encodeURIComponent(id)}/messages`, body),
      markRead:   (id: string) =>
        patch<{ ok: boolean }>(`/api/conversations/${encodeURIComponent(id)}/read`, {}),
      /** Accept a message request — moves it from Requests to main inbox */
      accept:  (id: string) =>
        patch<any>(`/api/conversations/${encodeURIComponent(id)}/accept`, {}),
      /** Decline / delete a conversation (used for request rejection) */
      decline: (id: string) =>
        del<{ ok: boolean }>(`/api/conversations/${encodeURIComponent(id)}`),
      /** Upload a base64-encoded image/video/audio file and get back a public URL. */
      uploadMedia: (body: { data: string; mimeType: string; extension: string }) =>
        post<{ url: string }>('/api/conversations/upload-media', body),
    },
    /** 1:1 voice / video call tokens (Agora RTC). */
    call: {
      token: (body: { conversationId: string; mode: 'voice' | 'video' }) =>
        post<{ appId: string; token: string; channelName: string; uid: number; mode: string; expiresAt?: string }>(
          '/api/call/token', body
        ),
      renew: (body: {
        threadId: string;
        mode: 'voice' | 'video';
        clientRenewalId: string;
      }) =>
        post<{
          renewed: true;
          duplicate: boolean;
          appId: string;
          token: string;
          channelName: string;
          uid: number;
          mode: string;
          expiresAt: string;
        }>('/api/call/token/renew', body),
      event: (body: {
        threadId: string;
        type: 'started' | 'ended' | 'declined' | 'failed';
        mode: 'voice' | 'video';
        /** Stable UUID used by the server to make lifecycle retries idempotent. */
        clientEventId: string;
      }) =>
        post<{ recorded: true }>('/api/call/events', body),
    },
    /** Unauthenticated public endpoints — no Authorization header needed. */
    publicProducts: {
      list: (opts: { limit?: number; category?: string; tag?: string } = {}) => {
        const params = new URLSearchParams();
        if (opts.limit)    params.set('limit',    String(opts.limit));
        if (opts.category) params.set('category', opts.category);
        if (opts.tag)      params.set('tag',       opts.tag);
        const q = params.toString();
        return get<any[]>(`/api/public/products${q ? `?${q}` : ''}`);
      },
      get: (id: string) => get<any>(`/api/public/products/${encodeURIComponent(id)}`),
      related: (productId: string, limit?: number) =>
        get<any[]>(`/api/public/products/${encodeURIComponent(productId)}/related${limit ? `?limit=${limit}` : ''}`),
      /** Product-backed rows that meet the platform qualified high-demand criteria.
       *  Returns an empty array when nothing qualifies — no fallback list. */
      highDemand: (limit = 6) =>
        get<any[]>(`/api/public/products/high-demand?limit=${encodeURIComponent(String(limit))}`),
    },
    public: {
      search: (opts: { q: string; sort?: string; minPriceCents?: number; maxPriceCents?: number; category?: string; limit?: number }) => {
        const params = new URLSearchParams();
        if (opts.q) params.set('q', opts.q);
        if (opts.sort) params.set('sort', opts.sort);
        if (opts.minPriceCents !== undefined) params.set('minPriceCents', String(opts.minPriceCents));
        if (opts.maxPriceCents !== undefined) params.set('maxPriceCents', String(opts.maxPriceCents));
        if (opts.category) params.set('category', opts.category);
        if (opts.limit) params.set('limit', String(opts.limit));
        return get<{ results: any[] }>(`/api/public/search?${params.toString()}`);
      }
    },
    reviews: {
      /** List reviews for a product (public). Returns { reviews, avgRating, totalCount }. */
      forProduct: (productId: string) =>
        get<{ reviews: any[]; avgRating: number; totalCount: number }>(
          `/api/reviews/product/${encodeURIComponent(productId)}`
        ),
      /** List reviews for a seller (public). Returns { reviews, avgRating, totalCount }. */
      forSeller: (sellerId: string) =>
        get<{ reviews: any[]; avgRating: number; totalCount: number }>(
          `/api/reviews/seller/${encodeURIComponent(sellerId)}`
        ),
      /** Create a review (buyer, authenticated). */
      create: (body: {
        orderId?:   string;
        sellerId:   string;
        productId?: string;
        rating:     number;
        body?:      string;
      }) => post<any>('/api/reviews', body),
      /** Seller — all received reviews with buyer + product info (authenticated as seller). */
      mine:  () => quietGet<any[]>('/api/reviews/mine'),
      /** Seller — post a public reply to a received review. */
      reply: (reviewId: string, replyText: string) =>
        post<any>(`/api/reviews/${encodeURIComponent(reviewId)}/reply`, { replyText }),
      /** Buyer Payment Methods — Stripe-backed saved cards */
      paymentMethods:      () => get<{ paymentMethods: any[] }>('/api/buyer/payment-methods'),
      setDefaultPaymentMethod: (pmId: string) =>
        post<{ ok: boolean; paymentMethodId: string }>(
          `/api/buyer/payment-methods/${encodeURIComponent(pmId)}/default`, {},
        ),
      removePaymentMethod: (pmId: string) => del<{ ok: boolean }>(`/api/buyer/payment-methods/${encodeURIComponent(pmId)}`),
    },
    seller: {
      /** Get the current seller's profile (verified status, policies). */
      getProfile: () =>
        get<{
          id: string;
          clerkId: string;
          displayName: string | null;
          brandName:   string | null;
          bio:         string | null;
          website:     string | null;
          username:    string | null;
          profileImageUrl: string | null;
          verified:    boolean;
          returnPolicy:       string | null;
          cancellationPolicy: string | null;
          subscriptionStatus: string | null;
          subscriptionPlanId: string | null;
          totalLikes: number;
          metrics: {
            revenueCents: number;
            visitors: number;
            orders: number;
            conversionRate: number;
          };
        }>('/api/seller/profile'),
      /** Upload a seller-owned brand avatar after the server validates its bytes. */
      uploadAvatar: (image: { uri: string; mimeType?: string | null }) =>
        uploadImage<{ profileImageUrl: string }>('/api/seller/profile/avatar/upload', image, getToken, getCacheScope),
      /** Update return / cancellation policy text. */
      updatePolicy: (body: { returnPolicy?: string; cancellationPolicy?: string }) =>
        patch<{ returnPolicy: string | null; cancellationPolicy: string | null }>(
          '/api/seller/policy', body
        ),
      /** Search products and brand sellers by keyword. Returns results in
       *  SearchResult shape (kind='brand'|'product') compatible with searchData.ts. */
      search: (q: string, limit = 20) =>
        get<{ results: any[] }>(`/api/public/search?q=${encodeURIComponent(q)}&limit=${limit}`),
      verification: {
        /** Returns the seller's current identity verification status. */
        status: () =>
          get<{
            verified:           boolean;
            verificationStatus: 'unverified' | 'pending' | 'verified' | 'failed';
            sessionId:          string | null;
          }>('/api/seller/verification/status'),
        /** Creates a Stripe Identity hosted session and returns { url, sessionId }. */
        start: () => post<{ url: string; sessionId: string; reused: boolean }>('/api/seller/verification/start', {}),
        /** Cancels the current session so the seller can retry. */
        cancel: () => post<{ ok: boolean }>('/api/seller/verification/cancel', {}),
      },
      connect: {
        /** Initiate Stripe Connect Express onboarding. Returns { url, stripeAccountId }. */
        onboard: () => post<{ url: string; stripeAccountId: string }>('/api/seller/connect/onboard', {}),
        /** Get current Connect account status. */
        status:  () => get<{
          connected: boolean;
          stripeAccountId: string | null;
          chargesEnabled: boolean;
          payoutsEnabled: boolean;
          detailsSubmitted?: boolean;
          status: string;
          verified: boolean;
          bankLast4: string | null;
        }>('/api/seller/connect/status'),
      },
      /** Update the current user's public profile. username must be letters/numbers/underscores, 3-30 chars. */
      updateProfile: (body: {
        displayName?: string;
        brandName?: string;
        bio?: string;
        website?: string;
        name?: string;
        username?: string;
        appThemeId?: string;
        appIconId?: string | null;
      }) =>
        patch<any>('/api/auth/profile', body),
      /** Platform subscription — billed to the seller's own payment method (sellers only).
       *  Completely separate from Stripe Connect (buyer payouts). */
      subscription: {
        /** Returns the seller's current plan, subscription status, renewal date,
         *  and payment-method label. */
        status: () => get<{
          plan: string;               // 'starter' | 'growth' | 'pro'
          status: string;             // 'active' | 'trialing' | 'past_due' | 'canceled' | 'none'
          trialEnd: string | null;    // formatted date when in trial, null otherwise
          trialStartAt: string | null;
          trialEndAt: string | null;
          trialBanner: {
            visible: boolean;
            day: number | null;
            daysRemaining: number;
            trialEndsAt: string;
            message: string;
            cta: string;
          } | null;
          renewsOn: string | null;    // e.g. "Aug 14, 2026"
          amountCents: number;        // monthly charge in cents (0 for starter)
          paymentMethodLabel: string | null; // e.g. "Visa ···4242"
          effectiveProvider: 'stripe' | 'revenuecat' | 'none';
        }>('/api/seller/subscription/status'),
        dismissTrialBanner: (trialEndAt: string) =>
          post<{ ok: boolean; trialEndAt: string }>('/api/seller/subscription/trial-banner/dismiss', { trialEndAt }),
        /** Read-only invoice summaries for the active seller store. */
        invoices: () => get<{
          invoices: Array<{
            id: string;
            created: string;
            description: string;
            amountCents: number;
            currency: string;
            status: 'paid' | 'unpaid';
          }>;
        }>('/api/seller/subscription/invoices'),
        /** Create a Stripe Checkout Session in subscription mode.
         *  Returns { url } for the mobile client to open in the system browser. */
        checkout: (planId: 'starter' | 'growth' | 'pro') =>
          post<{ url: string }>('/api/seller/subscription/checkout', { planId }),
        /** Create a Stripe Billing Portal session so the seller can manage their
         *  payment method, view invoices, or cancel. Returns { url }. */
        portal: () =>
          post<{ url: string }>('/api/seller/subscription/portal', {}),
        /** Server verifies the current RevenueCat customer; no plan is client supplied. */
        syncNative: () => post<{
          plan: string;
          status: string;
          trialEnd: string | null;
          renewsOn: string | null;
          amountCents: number;
          paymentMethodLabel: string | null;
          managementURL?: string | null;
          billingProvider?: 'stripe' | 'revenuecat';
        }>('/api/seller/subscription/native/sync', {}),
      },
      // ─ Locations ──────────────────────────────────────────────────────────
      locations:            () => get<any>('/api/seller/locations'),
      createLocation:       (body: Record<string, any>) => post<any>('/api/seller/locations', body),
      updateLocation:       (id: string, body: Record<string, any>) => patch<any>(`/api/seller/locations/${encodeURIComponent(id)}`, body),
      deleteLocation:       (id: string) => del<any>(`/api/seller/locations/${encodeURIComponent(id)}`),
      // ─ Metafields ─────────────────────────────────────────────────────────
      metafieldCounts:      () => get<{ counts: Record<string, number> }>('/api/seller/metafields'),
      metafieldsByResource: (resource: string) => get<any>(`/api/seller/metafields/${encodeURIComponent(resource)}`),
      createMetafield:      (body: Record<string, any>) => post<any>('/api/seller/metafields', body),
      deleteMetafield:      (id: string) => del<any>(`/api/seller/metafields/${encodeURIComponent(id)}`),
      // ─ Settings (language, preferences) ──────────────────────────────────
      getSettings:          () => get<{ settings: Record<string, any> }>('/api/seller/settings'),
      updateSettings:       (body: Record<string, any>) => patch<any>('/api/seller/settings', body),
      // ─ Policies ───────────────────────────────────────────────────────────
      getPolicies:          () => get<{ policies: any[] }>('/api/seller/settings/policies'),
      savePolicies:         (policies: any[]) => put<any>('/api/seller/settings/policies', { policies }),
      // ─ Integration status ─────────────────────────────────────────────────
      integrationStatus:    () => get<{ integrations: Array<{ key: string }> }>('/api/seller/settings/integrations'),
      connectIntegration:   (key: string, settings: Record<string, any>) =>
        post<any>(`/api/seller/settings/integrations/${encodeURIComponent(key)}/connect`, { settings }),
      disconnectIntegration:(key: string) => del<any>(`/api/seller/settings/integrations/${encodeURIComponent(key)}`),
      /** Mark the one-time seller tutorial overlay as seen (persisted to DB). */
      markTutorialSeen: () => post<{ ok: boolean }>('/api/seller/tutorial/seen', {}),
      /** Save questionnaire answers from onboarding to the user's DB record. */
      saveOnboardingData: (body: {
        goals?: string[]; brandStage?: string; sellModel?: string; styleInterests?: string[];
      }) => post<{ ok: boolean }>('/api/seller/onboarding/data', body),
      /** Vacation / away mode — pause storefront without removing listings. */
      /** Push notification frequency preference (realtime vs daily digest) */
      notificationPrefs: {
        get: () =>
          get<{ digest: 'realtime' | 'daily'; role: 'buyer' | 'seller'; categories: Record<string, boolean> }>('/api/seller/notification-prefs'),
        update: (body: { digest?: 'realtime' | 'daily'; categories?: Record<string, boolean> }) =>
          put<{ digest: 'realtime' | 'daily'; role: 'buyer' | 'seller'; categories: Record<string, boolean> }>('/api/seller/notification-prefs', body),
      },
      vacation: {
        get: () =>
          get<{ vacationMode: boolean; vacationMessage: string | null; vacationUntil: string | null }>(
            '/api/seller/vacation'
          ),
        update: (body: { vacationMode: boolean; vacationMessage?: string | null; vacationUntil?: string | null }) =>
          put<{ vacationMode: boolean; vacationMessage: string | null; vacationUntil: string | null }>(
            '/api/seller/vacation', body
          ),
      },
    },
    /** In-app support tickets */
    support: {
      submitTicket: (body: { subject: string; body: string; category: string; email: string; name: string }) =>
        post<any>('/api/support/tickets', body),
      getTickets: () => get<any[]>('/api/support/tickets'),
    },
    /** AI Support Chatbot — account-aware chat + human escalation */
    supportChat: {
      send: (messages: { role: string; content: string }[]) =>
        post<{ content: string; shouldEscalate?: boolean; escalateReason?: string; role?: string }>(
          '/api/support-chat/message', { messages }
        ),
      escalate: (summary: string, conversationSnippet: string) =>
        post<{ ok: boolean; message: string }>(
          '/api/support-chat/escalate', { summary, conversationSnippet }
        ),
    },
    /** Seller data export */
    sellerExport: {
      request: (format: 'json' | 'csv', include: ('products' | 'orders' | 'customers')[]) =>
        post<any>('/api/seller/export', { format, include }),
    },
    /** Thread-feed posts — create with product tags, read, like/repost */
    posts: {
      create: (body: {
        mediaUrl?: string; thumbnailUrl?: string; mediaPath?: string; thumbnailPath?: string;
        mediaPaths?: string[]; slideOverlays?: unknown;
        mediaUrls?: string[]; mediaType?: string; aspectRatio?: string; caption?: string;
        hashtags?: string[]; styleTags?: string[]; taggedProductIds?: string[];
        sound?: unknown; visibility?: unknown; isDraft?: boolean; scheduledAt?: string | null;
      }) => post<any>('/api/posts', body),
      patch: (id: string, body: {
        mediaUrl?: string; thumbnailUrl?: string | null; mediaUrls?: string[];
        mediaPaths?: string[]; slideOverlays?: unknown;
        mediaType?: string; aspectRatio?: string; caption?: string;
        hashtags?: string[]; styleTags?: string[]; taggedProductIds?: string[];
        sound?: unknown; visibility?: unknown; isDraft?: boolean; postStatus?: string;
        scheduledAt?: string | null;
      }) => patch<any>(`/api/posts/${encodeURIComponent(id)}`, body),
      uploadVideoClip: (uri: string, mimeType?: string | null) =>
        uploadVideo<{
          objectPath: string;
          contentType: string;
          size: number;
        }>('/api/posts/video-clips', { uri, mimeType }, getToken, getCacheScope),
      /** Upload a single raw photo slide (JPEG/PNG/WEBP) for slideshow composition */
      uploadPhotoSlide: (uri: string, mimeType?: string | null) =>
        uploadImage<{
          objectPath: string;
          contentType: string;
          size: number;
        }>('/api/posts/photo-slides', { uri, mimeType }, getToken, getCacheScope),
      composeVideo: (body: {
        clips: Array<{ objectPath: string; duration?: number; speed?: number; filter?: 'none' | 'warm' | 'cool' | 'mono' }>;
        trimStart: number;
        trimEnd: number;
        textOverlays?: Array<{
          id: string; text: string; x: number; y: number; color: string;
          fontStyle: string; align: string; bgStyle: string; fontSize: number;
          startTime?: number; endTime?: number;
        }>;
      }) => post<{
        mediaUrl: string;
        mediaPath: string;
        thumbnailUrl: string;
        thumbnailPath: string;
        duration: number;
        clipCount: number;
      }>('/api/posts/compose-video', body),
      /** Compose ordered photo slides with per-slide text overlays into portrait rendered images */
      composeSlideshow: (body: {
        slides: Array<{
          objectPath: string;
          overlays?: Array<{
            id: string; text: string; x: number; y: number; color: string;
            fontStyle: string; align: string; bgStyle: string; fontSize: number;
          }>;
        }>;
      }) => post<{
        mediaPaths: string[];
        mediaUrls: string[];
        thumbnailPath: string;
        thumbnailUrl: string;
        slideCount: number;
      }>('/api/posts/compose-slideshow', body),
      publicList: (ownerId?: string) =>
        get<any[]>(`/api/public/posts${ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : ''}`),
      get: (id: string) => get<any>(`/api/posts/${encodeURIComponent(id)}`),
      /** Owner-only verified performance. Untracked metrics return tracked=false and null values. */
      analytics: (id: string) =>
        get<PostAnalyticsResponse>(`/api/posts/${encodeURIComponent(id)}/analytics`),
      interact: (id: string, body: { type: 'like' | 'repost' | 'view' | 'watch_time' | 'shop_click'; value?: string }) =>
        post<{ action: string; count?: number }>(`/api/posts/${encodeURIComponent(id)}/interact`, body),
    },
    /** Content reporting (buyers and sellers can submit reports) */
    reports: {
      /** Report content or a person. `note` is required when reason is "other". */
      submit: (body: {
        targetType: ReportTargetType; targetId: string;
        reason: ReportReasonId; note?: string;
      }) => post<{ id?: string; status: string }>('/api/reports', body),
    },
    /** Moderator review queue (users.role = admin). */
    moderation: {
      me: () => freshGet<{ isModerator: boolean }>('/api/moderation/me'),
      queue: (params: { status?: 'open' | 'resolved' | 'all'; type?: ReportTargetType; offset?: number } = {}) => {
        const query = new URLSearchParams();
        if (params.status) query.set('status', params.status);
        if (params.type) query.set('type', params.type);
        if (params.offset) query.set('offset', String(params.offset));
        const suffix = query.toString();
        return freshGet<ModerationQueue>(`/api/moderation/reports${suffix ? `?${suffix}` : ''}`);
      },
      resolve: (reportId: string, action: ModerationAction, note?: string) =>
        post<{ ok: boolean; status: string; resolvedReports: number; signedOut: boolean }>(
          `/api/moderation/reports/${encodeURIComponent(reportId)}/resolve`,
          { action, ...(note ? { note } : {}) },
        ),
      reinstate: (userId: string) =>
        post<{ ok: boolean }>(`/api/moderation/users/${encodeURIComponent(userId)}/reinstate`, {}),
    },
    /** Personal safety settings. */
    safety: {
      mutedWords: () => freshGet<{ words: MutedWord[]; limit: number }>('/api/safety/muted-words'),
      muteWord: (phrase: string) =>
        post<MutedWord & { alreadyMuted?: boolean }>('/api/safety/muted-words', { phrase }),
      unmuteWord: (phrase: string) =>
        del<{ ok: boolean }>(`/api/safety/muted-words/${encodeURIComponent(phrase)}`),
    },
    /** Thread post comments (filtered, block-aware, moderated). */
    comments: {
      list: (postId: string, before?: string) =>
        freshGet<CommentThread>(`/api/posts/${encodeURIComponent(postId)}/comments${before ? `?before=${encodeURIComponent(before)}` : ''}`),
      create: (postId: string, body: string, parentId?: string | null) =>
        post<CreatedComment>(`/api/posts/${encodeURIComponent(postId)}/comments`, { body, ...(parentId ? { parentId } : {}) }),
      remove: (postId: string, commentId: string) =>
        del<{ ok: boolean }>(`/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`),
      like: (postId: string, commentId: string, liked: boolean) =>
        post<{ liked: boolean; likesCount: number }>(
          `/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/like`,
          { liked },
        ),
    },
    /** Buyer-to-buyer social graph: follows, profiles, search */
    social: {
      /** Follow another buyer */
      follow: (userId: string) =>
        post<{ ok: boolean; isFollowing: boolean; followersCount: number }>('/api/social/follow', { userId }),
      /** Unfollow a buyer */
      unfollow: (userId: string) =>
        del<{ ok: boolean; isFollowing: boolean; followersCount: number }>(`/api/social/follow/${encodeURIComponent(userId)}`),
      /** Check follow status between me and another user */
      status: (userId: string) =>
        get<{ isFollowing: boolean; isFollowedBy: boolean; isMutual: boolean; followersCount: number }>(
          `/api/social/status/${encodeURIComponent(userId)}`
        ),
      /** Get a buyer's public profile + follow counts */
      profile: (userId: string) =>
        get<{
          userId: string; name: string; username: string | null;
          displayName: string | null; bio: string | null; avatarUrl: string | null;
          accountType: string; initials: string; color: string; handle: string;
          followersCount: number; followingCount: number; postsCount: number;
          isFollowing: boolean; isFollowedBy: boolean; isMutual: boolean;
          iBlockedThem: boolean;
        }>(`/api/social/profile/${encodeURIComponent(userId)}`),
      profilePosts: (userId: string, limit = 30, offset = 0) =>
        get<any[]>(`/api/social/profile/${encodeURIComponent(userId)}/posts?limit=${limit}&offset=${offset}`),
      friendActivity: (limit = 30, offset = 0) =>
        get<any[]>(`/api/social/friends/activity?limit=${limit}&offset=${offset}`),
      /** List buyers I follow */
      following: (userId?: string) =>
        quietGet<Array<{
          userId: string; name: string; username: string | null; handle: string;
          initials: string; color: string; followedAt: string;
        }>>(`/api/social/following${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`),
      /** List buyers who follow me (with isFollowingBack flag) */
      followers: (userId?: string) =>
        quietGet<Array<{
          userId: string; name: string; username: string | null; handle: string;
          initials: string; color: string; followedAt: string; isFollowingBack: boolean;
        }>>(`/api/social/followers${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`),
      /** Search buyers by name / username */
      search: (q: string, limit = 20) =>
        get<Array<{
          userId: string; name: string; username: string | null; handle: string;
          initials: string; color: string; bio: string | null; isFollowing: boolean;
        }>>(`/api/social/search?q=${encodeURIComponent(q)}&limit=${limit}`),

      // ── Stories ─────────────────────────────────────────────────────────────
      /** Create a story (any authenticated user) */
      createStory: (body: {
        authorName: string; authorHandle?: string; authorInitials?: string;
        authorColor?: string; authorAccountType?: string;
        media: any[]; repliesDisabled?: boolean;
        privacy?: { visibility?: string; replyPermission?: string };
      }) => post<any>('/api/social/stories', body),
      /** My active stories */
      myStories: () => get<any[]>('/api/social/stories/me'),
      /** Another user's active stories — visible to all viewers */
      storiesForUser: (userId: string) =>
        get<any[]>(`/api/social/stories/user/${encodeURIComponent(userId)}`),
      /** Toggle like on a story */
      likeStory: (storyId: string) =>
        post<{ liked: boolean; likesCount: number }>(`/api/social/stories/${encodeURIComponent(storyId)}/like`, {}),
      /** Record a story view */
      viewStory: (storyId: string) =>
        post<{ ok: boolean }>(`/api/social/stories/${encodeURIComponent(storyId)}/view`, {}),
      /** Block a user — removes mutual follows, prevents messaging/following */
      block: (userId: string) =>
        post<{ ok: boolean }>('/api/social/block', { userId }),
      /** Unblock a user */
      unblock: (userId: string) =>
        del<{ ok: boolean }>(`/api/social/block/${encodeURIComponent(userId)}`),
      /** List users I have blocked, newest first */
      blocks: () => freshGet<BlockedAccount[]>('/api/social/blocks'),
    },
    /** Referral / invite-code system */
    referrals: {
      /** Get (or lazily generate) my invite code + shareable link */
      code: () =>
        get<{ code: string; link: string; shareText: string }>('/api/referrals/code'),
      /** How many people signed up using my code */
      stats: () =>
        get<{ total: number; pointsEarned: number; referrals: Array<{ inviteeId: string; name: string | null; joinedAt: string }> }>(
          '/api/referrals/stats'
        ),
      /** Attribute a referral to the current user — call once after signup with the code they entered */
      apply: (code: string, expectedClerkId?: string) =>
        post<{ ok: boolean; inviterId: string }>('/api/referrals/apply', {
          code,
          ...(expectedClerkId ? { expectedClerkId } : {}),
        }),
    },
    /** Server-side privacy settings */
    privacy: {
      /** Get current server-side privacy preferences */
      get: () =>
        get<{ dmPrivacy: 'requests' | 'followers_only' }>('/api/auth/privacy'),
      /** Update server-side privacy preferences */
      update: (settings: { dmPrivacy?: 'requests' | 'followers_only' }) =>
        patch<{ dmPrivacy: 'requests' | 'followers_only' }>('/api/auth/privacy', settings),
    },
    /** Public seller storefront — profile + products + posts */
    publicSellers: {
      get: (sellerId: string) =>
        get<{ profile: any; products: any[]; posts: any[] }>(
          `/api/public/sellers/${encodeURIComponent(sellerId)}`
        ),
      recordVisit: (sellerId: string) =>
        post<void>(`/api/public/sellers/${encodeURIComponent(sellerId)}/visit`, {}),
    },
    /** Buyer-facing drops listing (active, with countdown releaseAt) */
    publicDrops: {
      list: () => get<any[]>('/api/public/drops'),
      get:  (id: string) => get<any>(`/api/public/drops/${encodeURIComponent(id)}`),
      notificationStatus: (id: string) =>
        get<{ subscribed: boolean }>(`/api/public/drops/${encodeURIComponent(id)}/notify`),
      subscribe: (id: string) =>
        post<{ subscribed: boolean }>(`/api/public/drops/${encodeURIComponent(id)}/notify`, {}),
      unsubscribe: (id: string) =>
        del<{ subscribed: boolean }>(`/api/public/drops/${encodeURIComponent(id)}/notify`),
    },
    /** Discount codes — seller-managed promo codes */
    discountCodes: {
      list:   () => get<any[]>('/api/discount-codes'),
      create: (data: { code: string; type: string; value: number; minOrderCents?: number; maxUses?: number | null; expiresAt?: string | null }) =>
        post<any>('/api/discount-codes', data),
      update: (id: string, data: { active?: boolean; expiresAt?: string | null }) =>
        patch<any>(`/api/discount-codes/${id}`, data),
      delete: (id: string) => del<any>(`/api/discount-codes/${id}`),
      validate: (code: string, sellerId: string, subtotalCents: number) =>
        get<any>(`/api/discount-codes/validate?code=${encodeURIComponent(code)}&sellerId=${encodeURIComponent(sellerId)}&subtotalCents=${subtotalCents}`),
    },
    /** Returns — buyer-initiated return requests */
    returns: {
      create: (data: {
        orderId: string;
        reason: string;
        notes?: string;
        resolutionRequested?: string;
        evidenceUrls?: string[];
        requestedItems?: Array<{
          lineItemId?: string;
          productName?: string;
          variantTitle?: string;
          quantity?: number;
          unitPriceCents?: number;
        }>;
      }) =>
        post<any>('/api/returns', data),
      listBuyer:    () => get<any[]>('/api/returns/buyer'),
      listSeller:   () => get<any[]>('/api/returns'),
      get:          (id: string) => get<any>(`/api/returns/${id}`),
      updateStatus: (id: string, data: { status: string; sellerResponse?: string; refundAmountCents?: number }) =>
        patch<any>(`/api/returns/${id}/status`, data),
    },
    /** Shipping rates — seller-configured rates */
    shippingRates: {
      list:   () => get<any[]>('/api/shipping-rates'),
      create: (data: { name?: string; flatRateCents: number; freeAboveCents?: number | null }) =>
        post<any>('/api/shipping-rates', data),
      update: (id: string, data: { name?: string; flatRateCents?: number; freeAboveCents?: number | null; active?: boolean }) =>
        patch<any>(`/api/shipping-rates/${id}`, data),
      delete: (id: string) => del<any>(`/api/shipping-rates/${id}`),
      calculate: (sellerId: string, subtotalCents: number) =>
        get<any>(`/api/shipping-rates/calculate?sellerId=${encodeURIComponent(sellerId)}&subtotalCents=${subtotalCents}`),
    },
    // (products key defined earlier in this object — no duplicate)
    /** Waitlist — out-of-stock variant demand tracking. */
    waitlist: {
      join:          (productId: string, variantId?: string) =>
        post<{ joined: boolean }>('/api/waitlist/join', { productId, variantId }),
      leave:         (productId: string, variantId?: string) => {
        const q = new URLSearchParams({ productId });
        if (variantId) q.set('variantId', variantId);
        return del<{ left: boolean }>(`/api/waitlist/leave?${q.toString()}`);
      },
      check:         (variantId: string) =>
        get<{ joined: boolean }>(`/api/waitlist/check/${encodeURIComponent(variantId)}`),
      sellerDemand:  () => get<any[]>('/api/waitlist/seller'),
      sellerNotify:  (variantId: string) =>
        post<{ notified: number }>(`/api/waitlist/seller/notify/${encodeURIComponent(variantId)}`, {}),
    },
    /** Product bundles — seller CRUD. */
    bundles: {
      list:       () => get<any[]>('/api/bundles'),
      create:     (data: { name: string; description?: string; bundlePriceCents: number; compareAtCents?: number; images?: string[] }) =>
        post<any>('/api/bundles', data),
      get:        (id: string) => get<any>(`/api/bundles/${encodeURIComponent(id)}`),
      update:     (id: string, data: Record<string, unknown>) => patch<any>(`/api/bundles/${encodeURIComponent(id)}`, data),
      delete:     (id: string) => del<any>(`/api/bundles/${encodeURIComponent(id)}`),
      addItem:    (id: string, data: { productId: string; variantId?: string; quantity?: number }) =>
        post<any>(`/api/bundles/${encodeURIComponent(id)}/items`, data),
      removeItem: (id: string, itemId: string) =>
        del<any>(`/api/bundles/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`),
      publicList: (sellerId: string) =>
        get<any[]>(`/api/bundles/public/${encodeURIComponent(sellerId)}`),
    },
    // (buyer key defined earlier in this object — no duplicate)
    /** Team members — invite flow, roles, and activity log */
    team: {
      members:   () => get<any[]>('/api/team/members'),
      member:    (id: string) => get<any>(`/api/team/members/${encodeURIComponent(id)}`),
      invite:    (data: { email: string; name?: string; role?: string }) => post<any>('/api/team/invite', data),
      /** Public: resolve invite details for the accept screen (works signed-out) */
      resolveInvite: (token: string) => get<any>(`/api/team/invite/accept/${encodeURIComponent(token)}`),
      accept:    (token: string) => post<any>(`/api/team/invite/accept/${encodeURIComponent(token)}`, {}),
      regenerateInvite: (memberId: string) => post<any>(`/api/team/invite/${encodeURIComponent(memberId)}/regenerate`, {}),
      changeRole: (memberId: string, role: string) => patch<any>(`/api/team/members/${encodeURIComponent(memberId)}/role`, { role }),
      remove:    (memberId: string) => del<any>(`/api/team/members/${encodeURIComponent(memberId)}`),
      roles:     () => get<any[]>('/api/team/roles'),
      roleMembers: (role: string) => get<any[]>(`/api/team/roles/${encodeURIComponent(role)}/members`),
      /** Resolves the caller's permission tier for the active store context. */
      context: () => get<{ role: 'owner' | 'manager' | 'staff' }>('/api/team/context'),
      /** Returns all of the caller's active memberships in other seller stores. */
      myMemberships: () =>
        get<{
          memberships: Array<{
            id: string;
            ownerId: string;
            role: 'owner' | 'manager' | 'staff' | string;
            acceptedAt: string | null;
            ownerName: string;
          }>;
        }>('/api/team/my-memberships'),
      /** Validate a store selection before applying it to subsequent requests. */
      selectContext: (storeContext: StoreContext) =>
        post<{
          storeContext: StoreContext;
          storeOwnerId: string | null;
          teamMembershipId: string | null;
          role: 'owner' | 'manager' | 'staff';
        }>('/api/team/context', { storeContext }),
      /** Legacy single-membership response retained for older screens. */
      myMembership: () =>
        get<{
          membership: {
            id: string;
            ownerId: string;
            role: 'owner' | 'manager' | 'staff' | string;
            acceptedAt: string | null;
            ownerName: string;
          } | null;
        }>('/api/team/my-membership'),
      activity:  (params?: number | { limit?: number; offset?: number; actorClerkId?: string; resourceType?: string }) => {
        const p = typeof params === 'number' ? { limit: params } : (params ?? {});
        const qs = new URLSearchParams();
        if (p.limit) qs.set('limit', String(p.limit));
        if (p.offset) qs.set('offset', String(p.offset));
        if (p.actorClerkId) qs.set('actorClerkId', p.actorClerkId);
        if (p.resourceType) qs.set('resourceType', p.resourceType);
        const s = qs.toString();
        return get<any>(`/api/team/activity${s ? `?${s}` : ''}`);
      },
    },
    /** Seller storefront — store builder CRUD */
    store: {
      get:        () => get<any>('/api/store'),
      save:       (data: Record<string, unknown>) => put<any>('/api/store', data),
      publish:    () => post<any>('/api/store/publish', {}),
      unpublish:  () => post<any>('/api/store/unpublish', {}),
      versions:   () => get<any[]>('/api/store/versions'),
      saveVersion: (label: string, snapshot?: Record<string, unknown>) =>
        post<any>('/api/store/versions', { label, ...(snapshot ? { snapshot } : {}) }),
      restoreVersion: (versionId: string) => post<any>(`/api/store/versions/${encodeURIComponent(versionId)}/restore`, {}),
      domains:    () => get<any[]>('/api/store/domains'),
      addDomain:  (domain: string) => post<any>('/api/store/domains', { domain }),
      verifyDomain: (domainId: string) => post<any>(`/api/store/domains/${encodeURIComponent(domainId)}/verify`, {}),
      deleteDomain: (domainId: string) => del<any>(`/api/store/domains/${encodeURIComponent(domainId)}`),
      // AI generation
      generate:   (answers: Record<string, unknown>) => post<any>('/api/store/ai/generate', { answers }),
      fromLogo:   (base64: string, answers?: Record<string, unknown>) => post<any>('/api/store/ai/from-logo', { base64, answers }),
      fromMoodboard: (base64List: string[], answers?: Record<string, unknown>) => post<any>('/api/store/ai/from-moodboard', { base64List, answers }),
      fromSocial:  (socialUrl: string, context?: Record<string, unknown>) => post<any>('/api/store/ai/from-social', { socialUrl, ...(context ?? {}) }),
      previewToken: () => get<{ token: string; ttlSeconds: number }>('/api/store/preview-token'),
      previewHtml:  () => getText('/api/store/preview'),
      sharePreview: () => post<{ token: string; url: string; expiresAt: string; ttlSeconds: number }>('/api/store/share-preview', {}),
      revokePreview: () => del<{ ok: boolean; revokedAt: string }>('/api/store/share-preview'),
    },
    shopifyImports: {
      start: (url: string) => post<ShopifyImportJob>('/api/shopify-imports', { url }),
      latest: () => get<ShopifyImportJob | null>('/api/shopify-imports/latest'),
      get: (id: string) => get<ShopifyImportJob>(`/api/shopify-imports/${encodeURIComponent(id)}`),
      continue: (id: string) => post<ShopifyImportJob>(`/api/shopify-imports/${encodeURIComponent(id)}/continue`, {}),
    },
    /** Disputes / chargebacks — Stripe dispute data and evidence submission */
    disputes: {
      list: () => get<any[]>('/api/disputes'),
      get:  (id: string) => get<any>(`/api/disputes/${encodeURIComponent(id)}`),
      submitEvidence: (id: string, data: { type: string; description: string; trackingNumber?: string }) =>
        post<any>(`/api/disputes/${encodeURIComponent(id)}/evidence`, data),
      submitAll: (id: string) =>
        post<any>(`/api/disputes/${encodeURIComponent(id)}/submit`, {}),
      accept: (id: string) =>
        post<any>(`/api/disputes/${encodeURIComponent(id)}/accept`, {}),
    },
    /** Finance / Payouts dashboard — real Stripe Connect data */
    finance: {
      balance:      () => freshGet<any>('/api/finance/balance'),
      /** Held vs on-the-way vs available vs paid out, from the money ledger. */
      summary:      () => freshGet<FinanceSummary>('/api/finance/summary'),
      payouts:      (limit?: number) => get<any>(`/api/finance/payouts${limit ? `?limit=${limit}` : ''}`),
      transactions: (limit?: number, type?: string) => {
        const q = new URLSearchParams();
        if (limit) q.set('limit', String(limit));
        if (type)  q.set('type', type);
        return get<any>(`/api/finance/transactions${q.toString() ? `?${q}` : ''}`);
      },
      statementCsvUrl: () => '/api/finance/statement.csv',
      payout: (data: { idempotencyKey: string; amount: number; currency: string }) =>
        post<any>('/api/finance/payout', data),
    },
    /** Taxes & Duties — Stripe Tax integration */
    taxes: {
      status:    () => get<{
        stripeTaxEnabled: boolean;
        provider: string;
        providerConfigured: boolean;
        providerStatus: string;
        automaticTaxAtCheckout: boolean;
        complianceNote: string;
        chargeShippingTax: boolean;
        chargeVat: boolean;
      }>('/api/taxes/status'),
      enable:    () => post<any>('/api/taxes/enable', {}),
      config:    (data: { collectDuties?: boolean; chargeShippingTax?: boolean; chargeVat?: boolean }) =>
        patch<any>('/api/taxes/config', data),
      forms1099: (year?: number) => get<any>(`/api/taxes/1099${year ? `?year=${year}` : ''}`),
      calculate: (data: { lineItems: any[]; shippingAddress: any; currency?: string; shippingCents?: number }) =>
        post<any>('/api/taxes/calculate', data),
    },
    /** Live Shopping — Agora-powered live streams */
    live: {
      start:          (data: { title: string; description?: string; productTags?: any[]; thumbnailUrl?: string }) =>
        post<any>('/api/live/start', data),
      active:         () => get<{ streams: any[] }>('/api/live/active'),
      get:            (id: string) => get<{ stream: any }>(`/api/live/${encodeURIComponent(id)}`),
      join:           (id: string) => post<any>(`/api/live/${encodeURIComponent(id)}/join`, {}),
      leave:          (id: string) => post<any>(`/api/live/${encodeURIComponent(id)}/leave`, {}),
      end:            (id: string) => post<any>(`/api/live/${encodeURIComponent(id)}/end`, {}),
      updateProducts: (id: string, productTags: any[]) =>
        patch<any>(`/api/live/${encodeURIComponent(id)}/products`, { productTags }),
      comment:        (id: string, data: { message: string; displayName?: string; avatarUrl?: string }) =>
        post<any>(`/api/live/${encodeURIComponent(id)}/comment`, data),
      comments:       (id: string, since?: string) =>
        get<{ comments: any[] }>(`/api/live/${encodeURIComponent(id)}/comments${since ? `?since=${encodeURIComponent(since)}` : ''}`),
    },
    /** AI — brand memory, proactive suggestions */
    ai: {
      brandMemoryRebuild: () => post<{ fields: Record<string, string> }>('/api/ai/brand-memory/rebuild', {}),
      suggestions:        () => get<{ suggestions: any[] }>('/api/ai/suggestions'),
      nextActions:        () => get<{ suggestions: any[] }>('/api/ai/suggestions'),
      /** One-off assistant call — e.g. "rewrite this copy". */
      chat: (body: { messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>; maxTokens?: number }) =>
        post<{ content: string; actionCard?: Record<string, unknown>; tokensUsed?: number }>('/api/ai/chat', body),
    },
    /** Security — login sessions */
    security: {
      /** @deprecated Use auth.sessions(), which includes device details and the current session. */
      sessions: () => freshGet<{ sessions: AccountSession[] }>('/api/auth/sessions'),
    },
    /** Pre-order demand signals (product reservation). */
    preorder: {
      reserve:          (productId: string) =>
        post<{ reserved: boolean; demandCount: number }>(`/api/buyer/products/${encodeURIComponent(productId)}/reserve`, {}),
      unreserve:        (productId: string) =>
        del<{ reserved: boolean }>(`/api/buyer/products/${encodeURIComponent(productId)}/reserve`),
      checkReservation: (productId: string) =>
        get<{ reserved: boolean; demandCount: number }>(`/api/buyer/products/${encodeURIComponent(productId)}/reservation`),
    },
    /** Freelancer marketplace (Community tab). */
    freelancers: {
      list: (filters?: { serviceType?: string; minRate?: number; maxRate?: number; available?: boolean }) => {
        const params = new URLSearchParams();
        if (filters?.serviceType)     params.set('serviceType', filters.serviceType);
        if (filters?.minRate != null) params.set('minRate', String(filters.minRate));
        if (filters?.maxRate != null) params.set('maxRate', String(filters.maxRate));
        if (filters?.available)       params.set('available', 'true');
        const qs = params.toString();
        return get<{ freelancers: Freelancer[] }>(`/api/freelancers${qs ? `?${qs}` : ''}`);
      },
      get:        (id: string) => get<{ freelancer: Freelancer }>(`/api/freelancers/${encodeURIComponent(id)}`),
      me:         () => get<{ freelancer: Freelancer | null }>('/api/freelancers/me'),
      apply:      (body: { serviceType: string; hourlyRateCents: number; bio?: string; skillTags?: string[]; portfolioUrls?: string[] }) =>
        post<{ freelancer: Freelancer }>('/api/freelancers/apply', body),
      deactivate: () => del<{ ok: boolean }>('/api/freelancers/me'),
    },
    /** Paid promotion boosts — boost a post or product for increased reach. */
    boosts: {
      targets: () =>
        get<Array<{
          id: string;
          mediaUrl: string | null;
          mediaType: string | null;
          mediaUrls: string[] | null;
          mediaPaths: string[] | null;
          caption: string | null;
          createdAt: string;
          /** 'video' | 'slideshow' */
          mediaKind: 'video' | 'slideshow';
          /** Number of slides (null for video) */
          imageCount: number | null;
        }>>('/api/boosts/targets'),
      list: (targetId?: string) =>
        get<any[]>(`/api/boosts${targetId ? `?targetId=${encodeURIComponent(targetId)}` : ''}`),
      /**
       * Create a pending_payment boost.
       * Does NOT charge — use boosts.pay() after creation to open Stripe Checkout.
       */
      create: (body: {
        targetType: string;
        targetId: string;
        objective?: 'views' | 'likes' | 'followers' | 'profile_visits';
        budgetCents: number;
        durationDays: number;
      }) =>
        post<any>('/api/boosts', body),
      /**
       * Create (or reuse) a Stripe Checkout Session for a pending_payment boost.
       * Returns { sessionId, url, paymentStatus, status }.
       * Open `url` with WebBrowser.openAuthSessionAsync; call verify() after return.
       */
      pay: (id: string, returnUrl: string) =>
        post<{
          sessionId: string;
          url: string | null;
          paymentStatus: 'paid' | 'unpaid' | 'no_payment_required';
          status: string;
        }>(`/api/boosts/${encodeURIComponent(id)}/pay`, { returnUrl }),
      /**
       * Verify payment after the browser returns from Stripe Checkout.
       * Server validates payment_status=paid and activates the boost idempotently.
       * Returns the updated boost.
       */
      verify: (id: string) =>
        post<any>(`/api/boosts/${encodeURIComponent(id)}/pay/verify`, {}),
      update: (id: string, body: { status: 'paused' | 'cancelled' }) =>
        patch<any>(`/api/boosts/${encodeURIComponent(id)}`, body),
      summary: () =>
        get<{ totalImpressions: number; spentCentsThisMonth: number; activeCount: number }>('/api/boosts/summary'),
    },
    /** Ad Campaigns — end-to-end Create Ad flow with media upload, payment, and lifecycle. */
    adCampaigns: {
      create: () =>
        post<{ campaign: AdCampaign }>('/api/ad-campaigns', {}),
      list: () =>
        get<{ campaigns: AdCampaign[] }>('/api/ad-campaigns'),
      get: (id: string) =>
        get<{ campaign: AdCampaign }>(`/api/ad-campaigns/${encodeURIComponent(id)}`),
      update: (id: string, body: Partial<{
        headline: string;
        description: string;
        ctaKind: AdCtaKind;
        ctaDestinationKind: AdCtaDestinationKind;
        ctaDestinationId: string;
        formats: AdFormatKind[];
        budgetCents: number;
        durationDays: number;
      }>) =>
        patch<{ campaign: AdCampaign }>(`/api/ad-campaigns/${encodeURIComponent(id)}`, body),
      cancel: (id: string) =>
        del<{ ok: boolean }>(`/api/ad-campaigns/${encodeURIComponent(id)}`),
      uploadMedia: (
        id: string,
        blob: Blob,
        mimeType: string,
        opts?: { mediaKind?: 'photos' | 'video'; durationSeconds?: number; insertAt?: number },
      ) => {
        return request<{ objectPath: string; downloadUrl: string; mimeType: string; insertedAt: number }>(
          `/api/ad-campaigns/${encodeURIComponent(id)}/media`,
          {
            method: 'POST',
            body: blob,
            headers: {
              'Content-Type': mimeType,
              'X-Media-Kind':  opts?.mediaKind ?? 'photos',
              ...(opts?.durationSeconds !== undefined ? { 'X-Duration-Seconds': String(opts.durationSeconds) } : {}),
              ...(opts?.insertAt !== undefined ? { 'X-Media-Index': String(opts.insertAt) } : {}),
            } as any,
          },
          getToken,
          false,
          getCacheScope,
        );
      },
      removeMedia: (id: string, index: number) =>
        del<{ ok: boolean; mediaCount: number }>(`/api/ad-campaigns/${encodeURIComponent(id)}/media/${index}`),
      reorderMedia: (id: string, order: number[]) =>
        post<{ ok: boolean }>(`/api/ad-campaigns/${encodeURIComponent(id)}/reorder-media`, { order }),
      /**
       * Create (or reuse a still-open) Stripe Checkout Session for the campaign.
       * The returned `url` must be opened with WebBrowser.openAuthSessionAsync.
       * Campaign stays pending_payment until /pay/verify confirms payment_status=paid.
       */
      pay: (id: string, returnUrl: string) =>
        post<AdCampaignCheckoutSession>(
          `/api/ad-campaigns/${encodeURIComponent(id)}/pay`,
          { returnUrl },
        ),
      /**
       * Call after the browser returns from Stripe Checkout.
       * Server retrieves the Checkout Session, validates ownership + metadata,
       * and activates the campaign idempotently only if payment_status=paid.
       * Never activates on client redirect alone.
       */
      verify: (id: string) =>
        post<{ campaign: AdCampaign }>(
          `/api/ad-campaigns/${encodeURIComponent(id)}/pay/verify`,
          {},
        ),
    },
    /** Buyer loyalty / rewards points. */
    loyalty: {
      get:    () =>
        get<{ balance: number; valueCents: number; history: any[] }>('/api/loyalty'),
      earn:   (body: { points: number; source: string; referenceId?: string; note?: string }) =>
        post<any>('/api/loyalty/earn', body),
      redeem: (body: { points: number }) =>
        post<{ ok: boolean; pointsUsed: number; discountCents: number; token: string }>('/api/loyalty/redeem', body),
    },
    /** Public trending feed — no auth required. */
    publicTrending: {
      get: (limit = 20) =>
        get<{ trending: Array<{
          rank: number; id: string; brand: string; brandId: string;
          caption: string | null; mediaType: string | null;
          verified: boolean;
          organicScore: number; finalScore: number;
          likesCount: number; commentsCount: number; repostsCount: number; shopClicks: number;
          boosted: boolean; category: string; hype: string;
        }> }>(`/api/public/trending?limit=${limit}`),
    },
    /** Stripe Connect Express onboarding for freelancer payouts. */
    freelancerConnect: {
      onboard: () => post<{ url: string; stripeAccountId: string }>('/api/freelancers/connect/onboard', {}),
      status:  () => get<{
        connected: boolean;
        chargesEnabled: boolean;
        payoutsEnabled: boolean;
        detailsSubmitted: boolean;
        status: string;
      }>('/api/freelancers/connect/status'),
    },
    /** Freelancer job lifecycle (escrow payments). */
    freelancerJobs: {
      create: (body: { freelancerId: string; title: string; description?: string; agreedPriceCents: number }) =>
        post<{ job: FreelancerJob; checkoutUrl: string | null; sessionId: string }>('/api/freelancer-jobs', {
          ...body,
          successUrl: 'mobile://checkout/return?session_id={CHECKOUT_SESSION_ID}',
          cancelUrl:  'mobile://checkout/cancel',
        }),
      list:        () => get<{ isFreelancer: boolean; asHirer: FreelancerJob[]; asFreelancer: FreelancerJob[] }>('/api/freelancer-jobs'),
      get:         (id: string) => get<{ job: FreelancerJob }>(`/api/freelancer-jobs/${encodeURIComponent(id)}`),
      accept:      (id: string) => patch<{ job: FreelancerJob }>(`/api/freelancer-jobs/${encodeURIComponent(id)}/accept`, {}),
      start:       (id: string) => patch<{ job: FreelancerJob }>(`/api/freelancer-jobs/${encodeURIComponent(id)}/start`, {}),
      complete:    (id: string) => patch<{ job: FreelancerJob; payout: { amountCents: number; transferId: string | null } }>(`/api/freelancer-jobs/${encodeURIComponent(id)}/complete`, {}),
      cancel:      (id: string) => patch<{ job: FreelancerJob }>(`/api/freelancer-jobs/${encodeURIComponent(id)}/cancel`, {}),
      syncPayment: (id: string) => post<{ job: FreelancerJob; paymentStatus: string }>(`/api/freelancer-jobs/${encodeURIComponent(id)}/sync-payment`, {}),
    },
  };
}

export type BrandthreadApi = ReturnType<typeof createApi>;

// ─── React hook ──────────────────────────────────────────────────────────────
/**
 * useApi() — hook for React components.
 * Returns a fully-authed BrandthreadApi instance tied to the current Clerk session.
 * Memoised per user. Clerk may return a new getToken function between renders,
 * so the client reads it through a ref instead of rebuilding on function identity.
 */
export function useApi(): BrandthreadApi {
  const { getToken, userId } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  return useMemo(
    () => createApi(async () => getTokenRef.current(), () => userId ?? 'anonymous'),
    [userId],
  );
}

// ─── Module-level singleton ───────────────────────────────────────────────────
/**
 * Module-level `api` singleton.
 * Hydrate once at app boot via configureApi(getToken) — e.g. inside the
 * ServiceConfigurer component in _layout.tsx.  Falls back to unauthenticated
 * for public endpoints if never configured.
 */
let _globalGetter: GetToken = async () => null;
let _globalCacheScope: GetCacheScope = () => 'anonymous';
export function configureApi(getter: GetToken, getCacheScope: GetCacheScope = () => 'anonymous'): void {
  _globalGetter = getter;
  _globalCacheScope = getCacheScope;
}
export const api = createApi(() => _globalGetter(), () => _globalCacheScope());
