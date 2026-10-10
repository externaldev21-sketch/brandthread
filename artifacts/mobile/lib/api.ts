/**
 * Brandthread API client.
 * Base URL is resolved from EXPO_PUBLIC_API_BASE_URL (set in the dev script).
 * Every request attaches the Clerk Bearer token supplied by getToken().
 */
import type { SizeChartData, SizeChartPreset, SizeChartTemplateSummary, SizeChartTemplateDetail } from '@/lib/sizeChartTypes';
import { prepareImageForUpload } from '@/lib/imageUploadPrep';
import { useAuth } from '@clerk/expo';
import type { LaunchChecklistResponse } from '@/lib/launchChecklist';
import type {
  AccountDeletionCheck, AccountSession, BlockedAccount, CommentThread, CreatedComment,
  ModerationAction, ModerationQueue, MutedWord, ReportReasonId, ReportTargetType,
} from './safetyTypes';
import { useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { uploadChunked, type ChunkedTransport, type ResumeStore } from '@/lib/createPost/chunkedUpload';
import {
  ApiError,
  dismissNetworkNotice,
  reportNetworkError,
} from '@/lib/networkNotice';
import { reportServerError } from '@/lib/monitoringHooks';
import { trackAfter } from '@/lib/analytics/trackAfter';
import { isSignedInOnlyPath } from '@/lib/guestApiPolicy';
import { isSellerDevPreview } from '@/lib/devPreview';
import type { FinanceSummary } from '@/lib/financeSummary';
import type { StatementDetail, StatementFormat, StatementList } from '@/lib/statements';
import type { PayoutDetail, PayoutScheduleInfo, WeeklyAnchor } from '@/lib/payoutScheduleView';
import type { DisputeEvidenceFile, DisputeFileType, DisputeTimeline } from '@/lib/disputeTypes';
import type { ReorderResolution } from '@/lib/reorderSummary';
import type {
  CartQuote, CreatePaymentIntentBody, PaymentIntentStart, PaymentIntentStatus, QuoteBody,
} from '@/lib/checkoutPayment';
import { classifyAiCreditsError, surfaceAiCreditsError } from '@/lib/aiCreditsError';
import type { AiCreditHistoryPage, AiCreditsOverview } from '@/lib/aiCredits';
import type { ThreadCashCheckInResult, ThreadCashEntry, ThreadCashLedger, ThreadCashLedgerKind, ThreadCashStatus } from '@/lib/threadCashTypes';
import type { ImportCommitResult, ImportPreview, ImportProviders, ImportRun } from '@/lib/productImportTypes';
import type { GiftCard, GiftCardHistoryEntry, GiftCardSettings, GiftCardStoreInfo } from '@/lib/giftCards';
import type { MentionPerson, Story, StoryMentionItem, StoryStickerState } from '@/services/socialTypes';
import type { LiveModerationState, LiveCohostCandidate, LiveCohostInvite, LiveCohostPerson } from '@/lib/live/moderationTypes';

/** Server story highlight (GET /api/social/highlights/*). */
export interface ServerHighlight {
  id: string; userId: string; title: string;
  coverUrl: string | null; coverEmoji: string | null; coverColor: string | null;
  position: number; itemCount: number;
  items: Array<{ id: string; storyId: string | null; media: any[]; visibility: string; thumbnailUrl: string | null; storyCreatedAt: number | null; position: number }>;
  createdAt: number; updatedAt: number;
}
/** A story of mine that can be added to a highlight (live or archived). */
export interface HighlightPickerStory {
  storyId: string; thumbnailUrl: string | null; slides: number;
  visibility: 'public' | 'friends' | 'close_friends'; createdAt: number; live: boolean;
}
import type { BulkPriceRequest, BulkPriceResult, BulkProductList, ProductSeoDetail, ProductSeoInput } from '@/lib/productBulk';

import type {
  Community, CommunityAttachment, CommunityInvitePreview, CommunityJoinRequest, CommunityMember,
  CommunityMessage, CommunityMessagesPage, CommunityReaction, CreateCommunityInput, UpdateCommunityInput,
} from '@/lib/communities/types';

function communityQuery(params: { q?: string; offset?: number }): string {
  const q = new URLSearchParams();
  if (params.q?.trim()) q.set('q', params.q.trim());
  if (params.offset) q.set('offset', String(params.offset));
  const qs = q.toString();
  return qs ? `?${qs}` : '';
}

const BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

/** The api-server's own base URL — exported so callers that need a raw
 * WebSocket connection (see lib/live/useLiveSocket.ts) can derive a
 * ws(s):// URL from the same host this client already talks to over HTTP. */
export const API_BASE_URL = BASE;

/**
 * Every request gets a hard ceiling so a hung connection (dead server, black
 * hole route, a device that fell asleep mid-request) always resolves into an
 * error a screen can show instead of leaving loading state stuck forever.
 */
const REQUEST_TIMEOUT_MS = 15_000;

function rejectSellerPreviewApiRequest(): void {
  if (!isSellerDevPreview()) return;
  throw new ApiError(403, JSON.stringify({
    error: { message: 'This action is unavailable in the signed-out seller preview.', code: 'dev_preview_offline' },
  }));
}

/**
 * AI generation endpoints (mockup/photography/logo/background-removal) can
 * legitimately take much longer than an ordinary read/write — the server's
 * own "expensive" rate-limit policy (see api-server/src/middlewares/
 * rateLimit.ts) exists specifically for this class of request. Using the
 * default 15s timeout here was cutting off in-progress generations that
 * would have succeeded, surfacing a false "Request timed out" failure
 * instead of the real result.
 */
const EXPENSIVE_REQUEST_TIMEOUT_MS = 90_000;

/**
 * fetch() with a hard timeout. Expo/RN's fetch never rejects or resolves on
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

/**
 * Global 429 backoff gate. When the server rate-limits us, every request
 * (not just the one that got the 429) waits out the server's Retry-After
 * window before hitting the network again, instead of each screen's own
 * retry/focus-refetch logic immediately re-triggering another 429. This is
 * what actually stops the client from hammering the server during a rate
 * limit — the previous behavior just surfaced the 429 as an error and let
 * the next focus/retry fire right away.
 */
let rateLimitedUntil = 0;

function noteRateLimited(retryAfterSeconds: number): void {
  rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + retryAfterSeconds * 1000);
}

async function waitOutRateLimit(): Promise<void> {
  const remaining = rateLimitedUntil - Date.now();
  if (remaining <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, remaining));
}

function retryAfterSecondsFrom(res: Response): number {
  const header = Number(res.headers.get('Retry-After'));
  return Number.isFinite(header) && header > 0 ? header : 5;
}

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

// A screen that fires several parallel requests (common on mount) would
// otherwise call Clerk's getToken() once per request. Clerk already caches
// the JWT itself, but each call still costs a promise hop and, right after
// a token refresh, a brief window where concurrent callers would all kick
// off their own refresh. Share one in-flight/short-TTL result per getToken
// function instance so concurrent requests await a single resolution.
const AUTH_TOKEN_CACHE_TTL_MS = 4_000;
const authTokenCache = new WeakMap<
  GetToken,
  { token: string | null; expiresAt: number; inFlight: Promise<string | null> | null }
>();

/**
 * Ceiling on how long a single request will wait for Clerk's getToken() to
 * settle. getToken() is expected to resolve almost instantly (it reads a
 * cached JWT or does a fast refresh), but a hung session-bootstrap/network
 * path on cold start can leave it pending far longer than that — with
 * nothing racing it, every request made through createApi() would hang
 * indefinitely along with it, including the very first paint's data fetch.
 * On timeout we proceed with no token, same as the existing "signed out"
 * path (request() already sends no Authorization header when token is
 * null) — an authenticated call still fails normally downstream (401) if a
 * token was actually required, instead of the whole app hanging.
 */
const AUTH_TOKEN_WAIT_TIMEOUT_MS = 1_800;

async function getCachedToken(getToken: GetToken): Promise<string | null> {
  const now = Date.now();
  const entry = authTokenCache.get(getToken);
  if (entry) {
    if (entry.inFlight) return raceAuthTokenTimeout(entry.inFlight);
    if (entry.expiresAt > now) return entry.token;
  }
  const inFlight = getToken().then(
    (token) => {
      authTokenCache.set(getToken, { token, expiresAt: Date.now() + AUTH_TOKEN_CACHE_TTL_MS, inFlight: null });
      return token;
    },
    (error) => {
      authTokenCache.delete(getToken);
      throw error;
    },
  );
  authTokenCache.set(getToken, { token: entry?.token ?? null, expiresAt: 0, inFlight });
  // Every caller (including later ones that arrive while this is still
  // in-flight, via the entry.inFlight branch above) races the SAME
  // in-flight promise against its own timeout — the getToken() call itself
  // is still shared/de-duped exactly as before; only the wait is bounded.
  return raceAuthTokenTimeout(inFlight);
}

function raceAuthTokenTimeout(inFlight: Promise<string | null>): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, AUTH_TOKEN_WAIT_TIMEOUT_MS);
    inFlight.then(
      (token) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(token);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

// Two screens (or a screen re-rendering mid-fetch) that ask for the same GET
// at the same moment would otherwise fire two identical network requests.
// Share the in-flight promise so the second caller just awaits the first.
const inFlightGetRequests = new Map<string, Promise<any>>();

export interface LiveReplay {
  streamId: string;
  sellerId: string;
  postId: string | null;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  replayUrl: string;
  peakViewerCount: number;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  isOwner: boolean;
  /** Owner only. */
  visibility?: 'public' | 'hidden';
}

function request<T = any>(
  path: string,
  options: RequestInit,
  getToken: GetToken,
  asText = false,
  getCacheScope: GetCacheScope = () => 'anonymous',
  reportErrors = true,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const isRead = (options.method ?? 'GET').toUpperCase() === 'GET';
  if (!isRead || options.cache === 'no-store') {
    return doRequest<T>(path, options, getToken, asText, getCacheScope, reportErrors, timeoutMs);
  }
  const dedupeKey = `${versionApiPath(path)}::${asText ? 'text' : 'json'}::${JSON.stringify(storeContextHeaders())}`;
  const existing = inFlightGetRequests.get(dedupeKey);
  if (existing) return existing;
  const promise = doRequest<T>(path, options, getToken, asText, getCacheScope, reportErrors, timeoutMs).finally(() => {
    if (inFlightGetRequests.get(dedupeKey) === promise) inFlightGetRequests.delete(dedupeKey);
  });
  inFlightGetRequests.set(dedupeKey, promise);
  return promise;
}

async function doRequest<T = any>(
  path: string,
  options: RequestInit,
  getToken: GetToken,
  asText = false,
  getCacheScope: GetCacheScope = () => 'anonymous',
  reportErrors = true,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  rejectSellerPreviewApiRequest();
  await waitOutRateLimit();
  const resolvedPath = versionApiPath(path);
  const isRead = (options.method ?? 'GET').toUpperCase() === 'GET';
  const cacheKey = isRead && options.cache !== 'no-store' && !asText
    ? await apiCacheKey(resolvedPath, getCacheScope)
    : null;
  const token = await getCachedToken(getToken);
  // Guest guard (App Store 5.1.1(v)): a signed-out session never sends
  // account-scoped or paid requests; it fails locally like the server's 401.
  if (!token && isSignedInOnlyPath(resolvedPath)) {
    throw new ApiError(401, JSON.stringify({ error: { message: 'Sign in required', code: 'auth_required' } }));
  }
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
    res = await fetchWithTimeout(`${BASE}${resolvedPath}`, { ...options, headers }, timeoutMs);
  } catch (error) {
    const retry = isRead
      ? () => request<T>(path, options, getToken, asText, getCacheScope, reportErrors, timeoutMs)
      : undefined;
    const cached = cacheKey ? await readApiCache<T>(cacheKey) : null;
    if (reportErrors) reportNetworkError(error, retry, cached !== null);
    if (cached !== null) return cached;
    throw error;
  }
  if (!res.ok) {
    const body = await res.text();
    // AI credit gate refusals (402/429/503 with a credits code) are not generic rate limiting.
    const aiCreditsKind = classifyAiCreditsError(res.status, body);
    if (res.status === 429 && !aiCreditsKind) noteRateLimited(retryAfterSecondsFrom(res));
    if (aiCreditsKind) surfaceAiCreditsError(aiCreditsKind);
    const error = new ApiError(res.status, body);
    const retry = isRead
      ? () => request<T>(path, options, getToken, asText, getCacheScope, reportErrors, timeoutMs)
      : undefined;
    const cached = cacheKey && (res.status >= 500 || res.status === 429) ? await readApiCache<T>(cacheKey) : null;
    if (res.status >= 500) reportServerError(res.status, options.method ?? 'GET', resolvedPath);
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

export interface ProductQuestion {
  id: string;
  productId: string;
  body: string;
  askerName: string;
  createdAt: string;
  mine: boolean;
  answer: { id: string; body: string; createdAt: string; updatedAt?: string } | null;
}
export interface SellerProductQuestion {
  id: string;
  productId: string;
  productName: string;
  body: string;
  askerName: string;
  createdAt: string;
  answer: { id: string; body: string; createdAt: string } | null;
}

async function uploadImage<T = any>(
  path: string,
  image: { uri: string; mimeType?: string | null },
  getToken: GetToken,
  getCacheScope: GetCacheScope = () => 'anonymous',
): Promise<T> {
  image = await prepareImageForUpload(image);
  const source = await fetch(image.uri);
  if (!source.ok) {
    throw new Error("Could not read the selected image.");
  }
  const imageBlob = await source.blob();
  rejectSellerPreviewApiRequest();
  const contentType = image.mimeType || imageBlob.type || "image/jpeg";
  const token = await getCachedToken(getToken);
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
  rejectSellerPreviewApiRequest();
  const contentType = video.mimeType || videoBlob.type || "video/mp4";
  const token = await getCachedToken(getToken);
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
export interface ProductPairing { id: string; name: string; image: string | null; active: boolean; position: number }
export interface PublicPairedProduct {
  id: string;
  sellerId: string;
  sellerName: string | null;
  name: string;
  image: string | null;
  images: string[];
  priceCents: number;
  isPreOrder: boolean;
  available: boolean;
  variants: Array<{ id: string; size: string | null; color: string | null; priceCents: number; stock: number }>;
}
export interface ProductVideoInfo { videoUrl: string; posterUrl: string | null; durationMs: number | null }

/** Like uploadVideo, but reports upload progress (0–1) via XHR. */
async function uploadVideoWithProgress<T = any>(
  path: string,
  video: { uri: string; mimeType?: string | null },
  getToken: GetToken,
  getCacheScope: GetCacheScope = () => 'anonymous',
  onProgress?: (fraction: number) => void,
): Promise<T> {
  const source = await fetch(video.uri);
  if (!source.ok) throw new Error("Could not read the selected video.");
  const videoBlob = await source.blob();
  rejectSellerPreviewApiRequest();
  const contentType = video.mimeType || videoBlob.type || "video/mp4";
  const token = await getCachedToken(getToken);
  const result = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}${versionApiPath(path)}`);
    xhr.setRequestHeader("Content-Type", contentType);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    for (const [key, value] of Object.entries(storeContextHeaders())) xhr.setRequestHeader(key, String(value));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new Error("Network error while uploading the video."));
    xhr.send(videoBlob);
  }).catch((error) => { reportNetworkError(error); throw error; });
  if (result.status < 200 || result.status >= 300) {
    const error = new ApiError(result.status, result.text);
    reportNetworkError(error);
    throw error;
  }
  dismissNetworkNotice();
  onProgress?.(1);
  await clearApiCache(await getCacheScope());
  return JSON.parse(result.text) as T;
}
/** Remembers in-flight chunked upload sessions so a retry/restart resumes instead of restarting. */
const chunkedResumeStore: ResumeStore = {
  get: async (key) => { try { return await AsyncStorage.getItem(`bt_chunked_upload:${key}`); } catch { return null; } },
  set: async (key, id) => {
    try {
      if (id) await AsyncStorage.setItem(`bt_chunked_upload:${key}`, id);
      else await AsyncStorage.removeItem(`bt_chunked_upload:${key}`);
    } catch { /* resume is best-effort */ }
  },
};

/** Chunked, resumable video upload (see lib/createPost/chunkedUpload.ts). */
async function uploadVideoChunked(
  video: { uri: string; mimeType?: string | null },
  getToken: GetToken,
  opts: { onProgress?: (fraction: number) => void; signal?: { aborted: boolean } } = {},
): Promise<{ objectPath: string; contentType: string; size: number }> {
  const source = await fetch(video.uri);
  if (!source.ok) throw new Error("Could not read the selected video.");
  const blob = await source.blob();
  rejectSellerPreviewApiRequest();
  const contentType = (video.mimeType || blob.type || "video/mp4").split(";")[0];
  const authHeaders = async () => {
    const token = await getCachedToken(getToken);
    return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...storeContextHeaders() };
  };
  const json = async <T,>(path: string, init: RequestInit): Promise<T> => {
    const res = await fetch(`${BASE}${versionApiPath(path)}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(await authHeaders()), ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return (res.status === 204 ? undefined : await res.json()) as T;
  };
  const transport: ChunkedTransport = {
    start: (meta) => json("/api/posts/uploads", { method: "POST", body: JSON.stringify(meta) }),
    status: (id) => json(`/api/posts/uploads/${id}`, { method: "GET" }),
    complete: (id) => json(`/api/posts/uploads/${id}/complete`, { method: "POST", body: "{}" }),
    putChunk: async (id, index, chunk, onBytes) => {
      const headers = await authHeaders();
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", `${BASE}${versionApiPath(`/api/posts/uploads/${id}/chunks/${index}`)}`);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, String(v));
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) onBytes(e.loaded); };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, xhr.responseText)));
        xhr.onerror = () => reject(new Error("Network error while uploading"));
        xhr.send(chunk);
      });
    },
  };
  return uploadChunked({
    transport, blob, contentType,
    resumeKey: `${video.uri}|${blob.size}`,
    resumeStore: chunkedResumeStore,
    onProgress: opts.onProgress,
    signal: opts.signal,
  });
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

// ─── Meta (Facebook & Instagram) Ads ──────────────────────────────────────────

export type MetaAdsConnectionStatus = 'pending_selection' | 'connected' | 'needs_reauth' | 'disconnected';

export interface MetaAdsConnection {
  connected: boolean;
  status?: MetaAdsConnectionStatus;
  businessName?: string;
  adAccountName?: string;
  adAccountCurrency?: string;
  pageName?: string;
  instagramUsername?: string;
  tokenExpiresAt?: string;
}

export interface MetaBusiness { id: string; name: string; }
export interface MetaAdAccount { id: string; name: string; currency: string; accountStatus: string; }
export interface MetaPage {
  id: string;
  name: string;
  instagramBusinessAccount?: { id: string; username: string };
}

export interface MetaTargetingResult {
  id: string;
  name: string;
  audienceSizeLower?: number;
  audienceSizeUpper?: number;
}

export type MetaAdObjective = 'sales' | 'traffic' | 'awareness';
export type MetaAdCtaType = 'SHOP_NOW' | 'LEARN_MORE' | 'SIGN_UP' | string;
export type MetaAdPromoteKind = 'product' | 'store' | 'video';
export type MetaCampaignStatus =
  | 'draft' | 'launching' | 'in_review' | 'active' | 'paused'
  | 'rejected' | 'completed' | 'failed' | 'archived';

export interface MetaTargetingSpec {
  countries?: string[];
  ageMin?: number;
  ageMax?: number;
  genders?: string[];
  interests?: { id: string; name: string }[];
}

export interface MetaCampaign {
  id: string;
  sellerId: string;
  promoteKind: MetaAdPromoteKind;
  promoteRefId: string | null;
  objective: MetaAdObjective;
  primaryText: string | null;
  headline: string | null;
  ctaType: MetaAdCtaType | null;
  destinationUrl: string;
  mediaKind: 'video' | 'photos';
  mediaObjectPaths: string[];
  budgetType: 'daily' | 'lifetime';
  budgetCents: number;
  startTime: string | null;
  endTime: string | null;
  advantagePlus: boolean;
  placements: Record<string, unknown> | null;
  targetingSpec: MetaTargetingSpec | null;
  status: MetaCampaignStatus;
  rejectionReason: string | null;
  metaAdId: string | null;
  launchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MetaCampaignInsights {
  spendCents: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpcCents: number;
  purchases: number;
  purchaseValueCents: number;
  roas: number;
  fetchedAt: string;
}

export interface MetaCampaignDraftInput {
  promoteKind: MetaAdPromoteKind;
  promoteRefId?: string;
  objective: MetaAdObjective;
  primaryText?: string;
  headline?: string;
  ctaType?: MetaAdCtaType;
  destinationUrl: string;
  mediaKind: 'video' | 'photos';
  mediaObjectPaths: string[];
  budgetType: 'daily' | 'lifetime';
  budgetCents: number;
  startTime?: string;
  endTime?: string;
  advantagePlus?: boolean;
  placements?: Record<string, unknown>;
  targetingSpec?: MetaTargetingSpec;
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
  /** True when this sync cancelled a pending deletion (signing back in cancels it). */
  deletionCancelled?: boolean;
  /** Derived age band (the date of birth is never stored). null = not asked yet. */
  ageBand?: 'under_13' | '13_17' | '18_plus' | null;
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
export interface WatchedVideo {
  postId: string;
  authorId: string;
  authorName: string;
  authorAccountType: 'buyer' | 'seller';
  caption: string;
  thumbnailUrl: string | null;
  watchedAt: string;
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
// ── Seller messaging tools types ─────────────────────────────────────────────
export interface SellerQuickReply { id: string; title: string; body: string; shortcut: string | null; updatedAt: string }
export interface SellerAwaySettings {
  enabled: boolean;
  message: string;
  mode: 'always' | 'outside_hours';
  timezone: string;
  /** 7-bit mask, bit 0 = Sunday. */
  openDays: number;
  /** Minutes from local midnight. */
  openMinute: number;
  closeMinute: number;
}

// ─── Email marketing (seller) ────────────────────────────────────────────────
export type EmailAudience = 'subscribers' | 'customers' | 'followers';
export interface EmailMarketingStatus {
  enabled: boolean;
  provider: string | null;
  message: string | null;
  dailyCap: number;
  sentToday: number;
  remainingToday: number;
  tracking: { delivered: boolean; opened: boolean; clicked: boolean };
  missing: string[];
}
export interface EmailSubscriberRow { id: string; email: string; status: string; source: string; createdAt: string }
export interface EmailAudienceResponse {
  counts: Record<EmailAudience, number>;
  byStatus: Record<string, number>;
  subscribers: EmailSubscriberRow[];
  hasMore: boolean;
}
export interface EmailCampaignBody {
  headline: string;
  text: string;
  imageUrl: string | null;
  productIds: string[];
  cta: { label: string; url: string } | null;
}
export interface EmailCampaignStats {
  sent: number; failed: number; skipped: number; queued: number;
  delivered: number; opened: number; clicked: number; bounced: number;
}
export interface EmailCampaign {
  id: string;
  subject: string;
  preheader: string;
  audience: EmailAudience;
  body: EmailCampaignBody;
  status: 'draft' | 'scheduled' | 'sending' | 'sent';
  scheduledAt: string | null;
  sentAt: string | null;
  recipientCount: number;
  createdAt: string;
  updatedAt: string;
  stats?: EmailCampaignStats | null;
  tracking?: boolean;
}
export interface EmailSettings {
  fromName: string; replyTo: string; postalAddress: string; doubleOptIn: boolean; defaultFromName: string;
}
export type EmailCampaignInput = Pick<EmailCampaign, 'subject' | 'preheader' | 'audience' | 'body'>;

export interface AccessStatus { inviteOnly: boolean; redeemed: boolean; required: boolean }
export interface AccessInviteCode {
  id: string; code: string; label: string | null; maxUses: number | null; uses: number;
  expiresAt: string | null; disabled: boolean; status: 'active' | 'disabled' | 'expired' | 'used up'; createdAt: string;
}
export interface AccessWaitlist {
  items: { id: string; email: string; createdAt: string; invitedAt: string | null; code: string | null }[];
  counts: { total: number; invited: number; pending: number };
}
export function createApi(getToken: GetToken, getCacheScope: GetCacheScope = () => 'anonymous') {
  const get     = <T>(path: string) => request<T>(path, { method: 'GET' }, getToken, false, getCacheScope);
  const freshGet = <T>(path: string) => request<T>(path, { method: 'GET', cache: 'no-store' }, getToken, false, getCacheScope);
  const quietGet = <T>(path: string) => request<T>(path, { method: 'GET' }, getToken, false, getCacheScope, false);
  const getText  = (path: string)   => request<string>(path, { method: 'GET' }, getToken, true, getCacheScope);
  const post  = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST',  body: JSON.stringify(body) }, getToken, false, getCacheScope);
  const postExpensive = <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }, getToken, false, getCacheScope, true, EXPENSIVE_REQUEST_TIMEOUT_MS);
  const put   = <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT',   body: JSON.stringify(body) }, getToken, false, getCacheScope);
  const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }, getToken, false, getCacheScope);
  const del   = <T>(path: string) => request<T>(path, { method: 'DELETE' }, getToken, false, getCacheScope);

  return {
    config: {
      featureFlags: () =>
        get<{ flags: Record<string, boolean>; updatedAt: string | null }>('/api/config/features'),
      /** Public: whether live video (Agora) is configured; Go Live is hidden when false. */
      live: () => get<{ liveAvailable: boolean }>('/api/config/live'),
    },
    /** AI data-sharing consent (Guideline 5.1.2(i)); see components/AiConsentSheet.tsx. */
    aiConsent: {
      get: () => freshGet<{ consented: boolean; consentedAt: string | null; provider: string }>('/api/ai-consent'),
      accept: () => post<{ consented: boolean; consentedAt: string | null; provider: string }>('/api/ai-consent', { accept: true }),
    },
    // ── Live replays + Live tips (PR: live-replays-profile-tips) ──────────────
    liveReplays: {
      bySeller: (sellerId: string, opts: { limit?: number; offset?: number } = {}) =>
        get<{ replays: LiveReplay[]; hasMore: boolean }>(
          `/api/live-replays/by-seller/${encodeURIComponent(sellerId)}?limit=${opts.limit ?? 30}&offset=${opts.offset ?? 0}`,
        ),
      get: (streamId: string) => get<{ replay: LiveReplay }>(`/api/live-replays/${encodeURIComponent(streamId)}`),
      setVisibility: (streamId: string, visibility: 'public' | 'hidden') =>
        patch<{ ok: boolean; visibility: 'public' | 'hidden' }>(`/api/live-replays/${encodeURIComponent(streamId)}`, { visibility }),
      remove: (streamId: string) => del<{ ok: boolean }>(`/api/live-replays/${encodeURIComponent(streamId)}`),
    },
    liveTips: {
      /** Host only. `enabled: false` when the live_tips flag is OFF. */
      total: (streamId: string) =>
        get<{ enabled: boolean; totalCents: number; giftCount: number }>(`/api/live-tips/${encodeURIComponent(streamId)}/total`),
    },
    // ── end live replays + tips ───────────────────────────────────────────────
    /** Invite-only launch mode (feature flag `inviteOnlySignup`). */
    access: {
      status: () => freshGet<AccessStatus>('/api/access/status'),
      validate: (code: string) => post<{ valid: boolean }>('/api/access/validate', { code }),
      redeem: (code: string) => post<{ ok: true }>('/api/access/redeem', { code }),
      joinWaitlist: (email: string) => post<{ ok: true }>('/api/access/waitlist', { email }),
      /** Moderators only. */
      admin: {
        invites: () => freshGet<{ items: AccessInviteCode[] }>('/api/admin/invites'),
        createInvites: (body: { count: number; maxUses?: number; label?: string; expiresAt?: string }) =>
          post<{ codes: string[] }>('/api/admin/invites', body),
        revokeInvite: (id: string) => post<{ ok: true }>(`/api/admin/invites/${encodeURIComponent(id)}/disable`, {}),
        waitlist: (status: 'all' | 'pending' | 'invited' = 'all') =>
          freshGet<AccessWaitlist>(`/api/admin/access/waitlist?status=${status}`),
        inviteFromWaitlist: (id: string) =>
          post<{ code: string; invitedAt: string; reused: boolean }>(`/api/admin/access/waitlist/${encodeURIComponent(id)}/invite`, {}),
        setInviteOnly: (enabled: boolean) =>
          put<{ key: string; enabled: boolean }>('/api/config/features/inviteOnlySignup', { enabled }),
      },
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
        trackAfter(post<LocalUserProfile>('/api/auth/onboarding/complete', {
          accountType,
          ...(expectedClerkId ? { expectedClerkId } : {}),
        }), [['onboarding_completed', { account_type: accountType }], ...(accountType === 'seller' ? [['seller_onboarding_completed'] as const] : [])]),
      saveBuyerPreferences: (styleInterests: string[], expectedClerkId: string) =>
        patch<{ ok: boolean }>('/api/auth/onboarding/buyer-preferences', {
          styleInterests,
          expectedClerkId,
        }),
      /** Check whether a username handle is available for the current user.
       *  Returns { available: true } if free (or already owned by this user),
       *  { available: false, error: string } if taken or invalid format. */
      checkUsername: (username: string) =>
        get<{ available: boolean; error?: string; code?: 'USERNAME_COOLDOWN'; nextChangeAt?: string }>(
          `/api/auth/username/check?username=${encodeURIComponent(username)}`
        ),
      /** Same check, usable before sign-up completes (no session yet) —
       *  the onboarding auth step picks a username before a Clerk account
       *  exists, so it can't call the authenticated variant above. */
      checkUsernamePublic: (username: string) =>
        get<{ available: boolean; error?: string }>(
          `/api/public/username-check?username=${encodeURIComponent(username)}`
        ),
      /** Case-insensitive email-availability check, usable before sign-up
       *  completes (no session yet) — same "Add account" scenario as
       *  checkUsernamePublic above. */
      checkEmailPublic: (email: string) =>
        get<{ available: boolean; error?: string; code?: string }>(
          `/api/public/email-check?email=${encodeURIComponent(email)}`
        ),
      /** Authenticated case-insensitive email-availability check. */
      checkEmail: (email: string) =>
        get<{ available: boolean; error?: string; code?: string }>(
          `/api/auth/email/check?email=${encodeURIComponent(email)}`
        ),
      /** Bulk accountType (+ username/avatar/displayName) lookup by Clerk user
       *  id, for the account switcher — Clerk's own session object carries no
       *  buyer/seller signal for accounts other than the active one. */
      accountTypes: (clerkIds: string[]) =>
        get<{ accountTypes: Record<string, {
          accountType: 'buyer' | 'seller' | null;
          username: string | null;
          avatarUrl: string | null;
          displayName: string | null;
          name: string;
        }> }>(`/api/auth/account-types?clerkIds=${encodeURIComponent(clerkIds.join(','))}`),
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
        category?:     string;
        location?:     string;
        contactEmail?: string;
        tags?:         string[];
        socialLinks?:  Record<string, string>;
      }) => patch<any>('/api/auth/profile', body),
      /** Upload the current account's profile photo (buyer or seller). Cropped to a
       *  square client-side and displayed as a circle. Shared with the seller avatar
       *  endpoint — any authenticated user owns exactly one `profileImageUrl`. */
      uploadAvatar: (image: { uri: string; mimeType?: string | null }) =>
        uploadImage<{ profileImageUrl: string }>('/api/seller/profile/avatar/upload', image, getToken, getCacheScope),
      /** Schedule deletion (30-day grace) after the typed DELETE confirmation plus
       *  fresh proof: `password`, or `code` for accounts without a password. */
      deleteAccount: (reauth: { password?: string; code?: string } = {}) => request<{ ok: true; scheduledFor: string | null; graceDays: number }>(
        '/api/auth/account',
        { method: 'DELETE', body: JSON.stringify({ confirmation: 'DELETE', ...reauth }) },
        getToken,
        false,
        getCacheScope,
      ),
      /** Email a 6-digit re-auth code to an account that has no password. */
      requestDeletionCode: () => post<{ ok: true }>('/api/auth/account/deletion-code', {}),
      /** Everything deletion removes/retains, plus anything that must be settled first. */
      deletionCheck: () => freshGet<AccountDeletionCheck>('/api/auth/account/deletion-check'),
      /** Send a branded, server-issued (Resend) 6-digit password reset code.
       *  Always resolves — the response is a generic "if an account exists…"
       *  shape so it never reveals whether the email is registered — except
       *  when mail isn't configured at all, which throws ApiError with
       *  code "MAIL_NOT_CONFIGURED". No auth token is required or sent. */
      requestPasswordReset: (email: string) =>
        post<{ ok: true; message: string }>('/api/auth/password-reset/request', { email }),
      /** Verifies the code server-side (hashed, single-use, 15-minute expiry)
       *  then sets the new password through Clerk. No auth token required. */
      confirmPasswordReset: (body: { email: string; code: string; newPassword: string }) =>
        post<{ ok: true }>('/api/auth/password-reset/confirm', body),
      /** Record agreement to the Terms, Community Guidelines and Privacy Policy version shown. */
      acceptLegal: (version: string, source?: 'signup' | 'update_prompt') =>
        post<{ termsVersion: string; termsAcceptedAt: string }>('/api/auth/legal-acceptance', source ? { version, source } : { version }),
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
    aiHelpers: {
      caption: (body: { draft?: string; description?: string; imagePath?: string; tone?: string }) =>
        postExpensive<{ captions: string[]; hashtags: string[] }>('/api/ai-helpers/caption', body),
      productDescription: (body: { productId?: string; imagePaths?: string[]; name?: string; details?: string; tone?: string }) =>
        postExpensive<{ title: string; description: string; bullets: string[] }>('/api/ai-helpers/product-description', body),
      sizeChart: (body: unknown) =>
        postExpensive<{ unit: 'cm' | 'in'; note: string; rows: Record<string, string | number>[]; sizeChart: { columns: string[]; rows: { size: string; values: string[] }[]; unit: 'inches' | 'cm'; notes?: string } }>('/api/ai-helpers/size-chart', body),
      save: (body: unknown) => post<{ saved: true }>('/api/ai-helpers/save', body),
    },
    products: {
      list:           ()                       => get('/api/products'),
      publicList:     (ownerId?: string)       =>
        get<any[]>(`/api/public/products${ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : ''}`),
      get:            (id: string)             => get(`/api/products/${id}`),
      create:         (body: unknown)          => trackAfter(post('/api/products', body), [['product_published']]),
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
    /** Bulk product actions ("Select products") and per-product search listing (SEO). */
    productBulk: {
      list: (params: { q?: string; status?: string } = {}) => {
        const qs = new URLSearchParams();
        if (params.q) qs.set('q', params.q);
        if (params.status && params.status !== 'all') qs.set('status', params.status);
        const s = qs.toString();
        return get<BulkProductList>(`/api/product-bulk/products${s ? `?${s}` : ''}`);
      },
      price: (body: BulkPriceRequest) => post<BulkPriceResult>('/api/product-bulk/price', body),
      status: (body: { productIds: string[]; status: 'active' | 'draft' | 'archived' }) =>
        post<{ status: string; updated: string[]; unchanged: string[] }>('/api/product-bulk/status', body),
      duplicate: (body: { productIds: string[]; copyInventory?: boolean }) =>
        post<{ created: Array<{ sourceId: string; id: string; name: string }> }>('/api/product-bulk/duplicate', body),
    },
    productSeo: {
      get: (productId: string) => get<ProductSeoDetail>(`/api/product-seo/${encodeURIComponent(productId)}`),
      save: (productId: string, body: ProductSeoInput) =>
        put<ProductSeoDetail>(`/api/product-seo/${encodeURIComponent(productId)}`, body),
    },
    ipCases: {
      create: (body: { listingProductId: string; claimantName: string; claimantEmail: string; rightsType: string; description: string; evidenceReferences: string[] }) =>
        post<{ caseReference: string; statusToken: string; status: string }>('/api/ip-cases', body),
      status: (caseReference: string, token: string) =>
        get<{ caseReference: string; status: string }>(`/api/ip-cases/${encodeURIComponent(caseReference)}/status?token=${encodeURIComponent(token)}`),
    },
    orders: {
      list:           ()                       => quietGet('/api/orders'),
      /** Item 144 (seller chat buyer context panel): this buyer's order
       * history with the current seller — server scopes it to the caller's
       * own orders (see api-server's GET /api/orders `buyerId` filter), so
       * this can never return another seller's orders for that buyer. */
      listForBuyer:   (buyerId: string)        => quietGet(`/api/orders?buyerId=${encodeURIComponent(buyerId)}`),
      get:            (id: string)             => get(`/api/orders/${id}`),
      create:         (body: unknown)          => post('/api/orders', body),
      updateStatus:   (id: string, status: string, opts?: { reason?: string; notes?: string }) =>
        patch(`/api/orders/${id}/status`, { status, ...opts }),
      addTracking:    (id: string, body: unknown)  => patch(`/api/orders/${id}/tracking`, body),
      /** Ship only the selected order items with their own tracking number. */
      addItemsTracking: (id: string, body: { itemIds: string[]; trackingNumber: string; carrier?: string }) =>
        patch(`/api/orders/${id}/items-tracking`, body),
      updateTracking: (id: string, body: {
        trackingStatus: 'label_created' | 'accepted' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | 'returned_to_sender';
        estimatedDelivery?: string | null;
      }) => patch(`/api/orders/${id}/tracking`, body),
      /** Persist the seller's pick/pack checklist state for the fulfillment wizard. */
      updateFulfillmentChecklist: (id: string, body: { isPicked?: boolean; isPacked?: boolean }) =>
        patch(`/api/orders/${id}/fulfillment-checklist`, body),
    },
    packagePresets: {
      list:   () => get<{ presets: any[] }>('/api/package-presets'),
      create: (body: { name: string; weightOz: number; lengthIn: number; widthIn: number; heightIn: number }) =>
        post<{ preset: any }>('/api/package-presets', body),
      update: (id: string, body: Partial<{ name: string; weightOz: number; lengthIn: number; widthIn: number; heightIn: number }>) =>
        patch<{ preset: any }>(`/api/package-presets/${encodeURIComponent(id)}`, body),
      remove: (id: string) => del<{ ok: boolean }>(`/api/package-presets/${encodeURIComponent(id)}`),
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
      /** Cancel a drop before/after launch. Pre-order drops with held funds require { confirm: true }. */
      cancel: (dropId: string, confirm?: boolean) =>
        post<any>(`/api/drops/${encodeURIComponent(dropId)}/cancel`, confirm ? { confirm } : {}),
    },
    analytics: {
      dashboard:  () => get('/api/analytics/dashboard'),
      home: (range: 'live' | 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'all') =>
        get<{
          range: string;
          totalCents: number;
          // Net of anything actually refunded/cancelled back out — real money
          // the seller keeps. Always <= totalCents.
          netCents: number;
          orderCount: number;
          visitorCount: number;
          // Server-computed, from the exact same counts as the fields above —
          // kept for parity with the client's own identical derivation.
          conversionRate: number;
          averageOrderCents: number;
          // Thread Cash received via Live gifting in this range (cashable).
          threadCashReceivedCents: number;
          toFulfill: number;
          toCapture: number;
          // The immediately preceding period of the same length (e.g. yesterday
          // for "today"). No equivalent exists for balances — those are a
          // point-in-time snapshot, not a period sum.
          previous: { totalCents: number; netCents: number; orderCount: number; visitorCount: number };
          // Real per-source breakdown (Discover feed / Search / Your profile /
          // External links), for the same range as everything else above.
          trafficSources: Array<{ source: 'feed' | 'search' | 'profile' | 'external'; count: number; sharePercent: number }>;
          buckets: Array<{ bucket: string; totalCents: number; netCents: number; orderCount: number; visitorCount: number }>;
          // `tz` is minutes east of UTC (-Date#getTimezoneOffset()) so day/hour
          // buckets land on the seller's local calendar day, not the server's.
        }>(`/api/analytics/home?range=${range}&tz=${-new Date().getTimezoneOffset()}`),
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
      /** Brandthread Pro: cohorts, lifetime value and order value by month. 403 PLAN_REQUIRED below Pro. */
      advanced:   () => get<{
        months: string[];
        cohorts: Array<{ month: string; customers: number; repeatCustomers: number; repeatRate: number; revenueCents: number }>;
        orderValue: Array<{ month: string; orders: number; revenueCents: number; averageOrderCents: number }>;
        lifetime: { customers: number; revenueCents: number; averageLifetimeValueCents: number };
      }>('/api/analytics/advanced'),
    },
    inventory: {
      list:   () => get<any[]>('/api/inventory'),
      adjust: (variantId: string, body: { delta?: number; newStock?: number }) =>
        patch<any>(`/api/inventory/${variantId}/adjust`, body),
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
          promotionalPush?: boolean;
          quietHours: { start: string | null; end: string | null; timezone: string };
          categories: Record<string, boolean>;
          channels: Record<'push' | 'inApp' | 'email', Record<string, boolean>>;
        }>('/api/notification-prefs'),
      update: (body: {
        digest?: 'realtime' | 'daily';
        categories?: Record<string, boolean>;
        channels?: { inApp?: Record<string, boolean>; email?: Record<string, boolean> };
        pushEnabled?: boolean;
        promotionalPush?: boolean;
        quietHours?: { start: string; end: string; timezone?: string } | null;
      }) =>
        put<{
          digest: 'realtime' | 'daily';
          role: 'buyer' | 'seller';
          pushEnabled: boolean;
          promotionalPush?: boolean;
          quietHours: { start: string | null; end: string | null; timezone: string };
          categories: Record<string, boolean>;
          channels: Record<'push' | 'inApp' | 'email', Record<string, boolean>>;
        }>('/api/notification-prefs', body),
    },
    logo: {
      generate: (brandName: string, style: string) => postExpensive<any>('/api/logo/generate', { brandName, style }),
      onboardingSample: (brandName: string, style: string) =>
        postExpensive<{ b64_json: string }>('/api/onboarding-sample/logo', { brandName, style }),
    },
    mockup: {
      generate: (
        prompt: string,
        referenceImage?: string,
        mode: 'text_to_design' | 'sketch_to_design' | 'prompt_edit' = referenceImage ? 'prompt_edit' : 'text_to_design',
      ) =>
        postExpensive<any>('/api/mockup/generate', { prompt, mode, ...(referenceImage ? { referenceImage } : {}) }),
    },
    photography: {
      generate: (
        images: string[],
        prompt: string,
        mode: 'photoshoot' | 'mockup_to_model' = 'photoshoot',
      ) => postExpensive<any>('/api/photography/generate', { images, prompt, mode }),
      generateOutfitSwap: (
        heroImage: string,
        garmentImages: string[],
        prompt: string,
      ) => postExpensive<{
        results: { garmentIndex: number; b64_json: string }[];
        errors?: { garmentIndex: number }[];
      }>('/api/photography/outfit-swap', { heroImage, garmentImages, prompt }),
      retryOutfitSwap: (
        heroImage: string,
        garmentImage: string,
        garmentIndex: number,
        prompt: string,
      ) => postExpensive<{
        garmentIndex: number;
        b64_json: string;
      }>('/api/photography/outfit-swap/retry', { heroImage, garmentImage, garmentIndex, prompt }),
    },
    bgRemoval: {
      /**
       * Remove the background from a base64 data-URL image.
       * Returns: { b64_json, storageKey, size, mime, createdAt, id }
       */
      remove: (image: string) => postExpensive<{
        b64_json: string;
        storageKey: string | null;
        size: number;
        mime: string;
        createdAt: string;
        id: string;
      }>('/api/bg-removal/remove', { image }),
      replace: (body: {
        image: string; backgroundImage?: string; prompt?: string; color?: string; bgType?: string;
      }) => postExpensive<{ b64_json: string }>('/api/bg-removal/replace', body),
    },
    lifestyle: {
      generate: (referenceImages: string[], productImages: string[], prompt: string) =>
        postExpensive<any>('/api/lifestyle/generate', { referenceImages, productImages, prompt }),
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
      }) => postExpensive<any>('/api/techpack/generate', payload),
    },
    integrations: {
      klaviyoStatus:      () => get<any>('/api/integrations/klaviyo'),
      klaviyoConnect:     (apiKey: string) => post<any>('/api/integrations/klaviyo/connect', { apiKey }),
      klaviyoSync:        () => post<any>('/api/integrations/klaviyo/sync', {}),
      klaviyoDisconnect:  () => del<any>('/api/integrations/klaviyo'),
    },
    shopify: {
      status:        () => get<any>('/api/shopify/status'),
      connectStart:  (shopDomain: string, purpose: 'import' | 'fulfillment') =>
        post<{ authorizeUrl: string }>('/api/shopify/connect/start', { shopDomain, purpose }),
      connectCustomApp: (shopDomain: string, accessToken: string, purpose: 'import' | 'fulfillment') =>
        post<any>('/api/shopify/connect/custom-app', { shopDomain, accessToken, purpose }),
      disconnect:    () => post<any>('/api/shopify/disconnect', {}),
      fulfillmentEnable:  () => post<any>('/api/shopify/fulfillment/enable', {}),
      fulfillmentDisable: () => post<any>('/api/shopify/fulfillment/disable', {}),
      products:      (pageInfo?: string) =>
        get<{ products: Array<{ shopifyProductId: string; title: string; image: string | null; variantCount: number; alreadyImported: boolean }>; nextPageInfo: string | null }>(
          `/api/shopify/products${pageInfo ? `?pageInfo=${encodeURIComponent(pageInfo)}` : ''}`,
        ),
      importProducts: (shopifyProductIds: string[], publishStatus: 'draft' | 'active') =>
        post<{ imported: number; updated: number; skipped: Array<{ shopifyProductId: string; reason: string }> }>(
          '/api/shopify/products/import', { shopifyProductIds, publishStatus },
        ),
    },
    buyer: {
      /** Saved sizes / preferences. GET returns defaults when nothing is saved; update is a partial merge (null clears a size). */
      preferences: {
        get: () => get<BuyerPreferences>('/api/buyer/preferences'),
        update: (body: BuyerPreferencesPatch) => patch<BuyerPreferences>('/api/buyer/preferences', body),
      },
      /** "Brands you might like" — ranked by style interests + liked brands + popularity; excludes followed/blocked. */
      recommendedBrands: (limit = 12) =>
        get<{ brands: RecommendedBrand[]; followedBrandCount: number }>(`/api/buyer/recommended-brands?limit=${limit}`),
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
            /** One-time token from /api/thread-cash/redeem. Discounts the card
             *  charge only (never a full payment method) — see
             *  docs/payments/thread-cash-checkout-todo.md. In-stock (destination
             *  charge) checkouts only; the server rejects it for preorders. */
            threadCashToken?: string;
            /** Seller discount code, validated fresh server-side and applied to this charge. */
            discountCode?: string;
            /** Live the buyer is shopping from (required for live-only codes). */
            liveStreamId?: string;
          },
        ) =>
          trackAfter(post<{ sessionId: string; url: string }>('/api/buyer/checkout/session', {
            items,
            successUrl: 'mobile://checkout/return?session_id={CHECKOUT_SESSION_ID}',
            cancelUrl:  'mobile://checkout/cancel',
            ...(opts.contactEmail          ? { contactEmail:          opts.contactEmail          } : {}),
            ...(opts.contactPhone          ? { contactPhone:          opts.contactPhone          } : {}),
            ...(opts.shippingAddress       ? { shippingAddress:       opts.shippingAddress       } : {}),
            ...(opts.clientIdempotencyKey  ? { clientIdempotencyKey:  opts.clientIdempotencyKey  } : {}),
            ...(opts.loyaltyToken          ? { loyaltyToken:          opts.loyaltyToken          } : {}),
            ...(opts.threadCashToken       ? { threadCashToken:       opts.threadCashToken       } : {}),
            ...(opts.discountCode          ? { discountCode:          opts.discountCode          } : {}),
            ...(opts.liveStreamId          ? { liveStreamId:          opts.liveStreamId          } : {}),
          }), [['checkout_started', { flow: 'hosted', item_count: items.length }]]),
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
        /**
         * One-page checkout: ONE PaymentIntent for the whole cart, confirmed
         * in the app with Stripe's own fields (routes/checkout-intent.ts).
         * Bodies come only from lib/checkoutPayment.ts's whitelisted builders,
         * so no card data can ever be sent here.
         */
        paymentIntent: {
          quote: (body: QuoteBody) => post<CartQuote>('/api/buyer/checkout/payment-intent/quote', body),
          create: (body: CreatePaymentIntentBody) => trackAfter(post<PaymentIntentStart>('/api/buyer/checkout/payment-intent', body), [['checkout_started', { flow: 'one_page' }]]),
          get: (paymentIntentId: string) =>
            get<PaymentIntentStatus>(`/api/buyer/checkout/payment-intent/${encodeURIComponent(paymentIntentId)}`),
          cancel: (paymentIntentId: string) =>
            post<{ ok: boolean }>(`/api/buyer/checkout/payment-intent/${encodeURIComponent(paymentIntentId)}/cancel`, {}),
        },
      },
      orders: {
        list:   () => get<any[]>('/api/buyer/orders'),
        get:    (id: string) => get<any>(`/api/buyer/orders/${encodeURIComponent(id)}`),
        /** Buyer confirms receipt of a shipped order; delivery state is recorded server-side. */
        confirmReceipt: (id: string) =>
          post<{ delivery?: unknown }>(`/api/buyer/orders/${encodeURIComponent(id)}/confirm-receipt`, {}),
        /** Cancel a pending order within the 60-minute window. Returns { cancelled, refunded, orderNumber }. */
        cancel: (id: string) => post<{ cancelled: boolean; refunded: boolean; orderNumber: string }>(
          `/api/buyer/orders/${encodeURIComponent(id)}/cancel`, {}
        ),
        /** Re-resolves a past order against today's catalogue (price, stock, variants). Read-only; the client adds the addable lines to the cart. */
        reorder: (id: string) => post<ReorderResolution>(
          `/api/buyer/orders/${encodeURIComponent(id)}/reorder`, {}
        ),
      },
      /** Recently viewed products — recorded on product detail view, shown on Discover and in the bag. */
      recentlyViewed: {
        record: (productId: string) => post<void>('/api/buyer/recently-viewed', { productId }),
        list: (limit = 12) => get<Array<{
          productId: string;
          name: string;
          brand: string;
          image: string | null;
          priceCents: number | null;
          viewedAt: string;
        }>>(`/api/buyer/recently-viewed?limit=${limit}`),
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
      /** Chat details > Create a group chat — a minimal group create (see docs/dm-flows.md). */
      createGroup: (body: {
        participants: Array<{ userId: string; name: string; handle: string; initials: string; color: string; accountType: string }>;
        myInfo?: { name: string; handle: string; initials: string; color: string; accountType: string };
      }) => post<any>('/api/conversations', { type: 'group', ...body }),
      messages:   (id: string, limit = 50) =>
        get<any[]>(`/api/conversations/${encodeURIComponent(id)}/messages?limit=${limit}`),
      /** Search-in-chat (chat details > Search): this conversation's own
       *  message history only, never global search. */
      searchMessages: (id: string, q: string) =>
        get<any[]>(`/api/conversations/${encodeURIComponent(id)}/messages?q=${encodeURIComponent(q)}`),
      /** Chat details > Mute. durationMinutes: -1 = "Until I turn it back on", null/0 = unmute. */
      mute: (id: string, durationMinutes: number | null) =>
        patch<{ ok: boolean; mutedUntil: string | null }>(`/api/conversations/${encodeURIComponent(id)}/mute`, { durationMinutes }),
      /** Chat details > Nicknames. An empty nickname clears it. */
      setNickname: (id: string, targetUserId: string, nickname: string) =>
        patch<{ ok: boolean; nickname: string | null }>(`/api/conversations/${encodeURIComponent(id)}/nickname`, { targetUserId, nickname }),
      /** Chat details > Theme. null resets to the default monochrome look. */
      setTheme: (id: string, themeId: string | null) =>
        patch<{ ok: boolean; themeId: string | null; message: any }>(`/api/conversations/${encodeURIComponent(id)}/theme`, { themeId }),
      /** Chat details > Disappearing messages. */
      setDisappearing: (id: string, enabled: boolean) =>
        patch<{ ok: boolean; disappearingEnabled: boolean; message: any }>(`/api/conversations/${encodeURIComponent(id)}/disappearing`, { enabled }),
      send:       (id: string, body: { text: string; attachment?: any; replyToId?: string }) =>
        trackAfter(post<any>(`/api/conversations/${encodeURIComponent(id)}/messages`, body), [['message_sent', { surface: 'dm', has_attachment: Boolean(body.attachment) }]]),
      markRead:   (id: string) =>
        patch<{ ok: boolean }>(`/api/conversations/${encodeURIComponent(id)}/read`, {}),
      /** Real-time "X is typing…" (no websocket layer — the other side picks
       *  this up on its own light poll of the conversation). Fire-and-forget
       *  from the caller's side; see Conversation.otherTyping. */
      setTyping:  (id: string, typing: boolean) =>
        patch<{ ok: boolean }>(`/api/conversations/${encodeURIComponent(id)}/typing`, { typing }),
      /** Accept a message request — moves it from Requests to main inbox */
      accept:  (id: string) =>
        patch<any>(`/api/conversations/${encodeURIComponent(id)}/accept`, {}),
      /** Decline / delete a conversation (used for request rejection) */
      decline: (id: string) =>
        del<{ ok: boolean }>(`/api/conversations/${encodeURIComponent(id)}`),
      /** Upload a base64-encoded image/video/audio file and get back a public URL. */
      uploadMedia: (body: { data: string; mimeType: string; extension: string }) =>
        post<{ url: string }>('/api/conversations/upload-media', body),
      /** Set (or replace) my reaction on a message — one active reaction per user per message. */
      addReaction: (conversationId: string, messageId: string, reactionType: string) =>
        put<{ userId: string; userName: string; reactionType: string; createdAt: string }>(
          `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reactions`,
          { reactionType },
        ),
      /** Remove my reaction from a message. */
      removeReaction: (conversationId: string, messageId: string) =>
        del<{ ok: boolean }>(
          `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reactions`,
        ),
    },
    /** Topic group chats ("Graphic Design Community"). Use via lib/communities/useCommunityClient. */
    communities: {
      /** Signed-out safe: official + public groups, read-only. */
      publicList: (params: { q?: string; offset?: number } = {}) =>
        freshGet<{ communities: Community[]; nextOffset: number | null }>(
          `/api/communities/public${communityQuery(params)}`,
        ),
      list: (params: { q?: string; offset?: number } = {}) =>
        freshGet<{ communities: Community[]; nextOffset: number | null }>(`/api/communities${communityQuery(params)}`),
      mine: () => quietGet<Community[]>('/api/communities/mine'),
      get: (id: string) => freshGet<Community>(`/api/communities/${encodeURIComponent(id)}`),
      create: (body: CreateCommunityInput) => post<Community>('/api/communities', body),
      update: (id: string, body: UpdateCommunityInput) => patch<Community>(`/api/communities/${encodeURIComponent(id)}`, body),
      remove: (id: string) => del<{ ok: boolean }>(`/api/communities/${encodeURIComponent(id)}`),
      join: (id: string) => post<Community>(`/api/communities/${encodeURIComponent(id)}/join`, {}),
      joinByCode: (code: string) =>
        post<{ status: 'joined' | 'requested'; community?: Community }>('/api/communities/join-by-code', { code }),
      invitePreview: (code: string) =>
        freshGet<CommunityInvitePreview>(`/api/communities/invite/${encodeURIComponent(code)}`),
      leave: (id: string) => post<{ ok: boolean }>(`/api/communities/${encodeURIComponent(id)}/leave`, {}),
      setMuted: (id: string, muted: boolean) =>
        patch<{ muted: boolean }>(`/api/communities/${encodeURIComponent(id)}/mute`, { muted }),
      markRead: (id: string, seq?: number) =>
        patch<{ ok: boolean }>(`/api/communities/${encodeURIComponent(id)}/read`, seq === undefined ? {} : { seq }),
      invite: (id: string) => freshGet<{ code: string; url: string }>(`/api/communities/${encodeURIComponent(id)}/invite`),
      resetInvite: (id: string) => post<{ code: string; url: string }>(`/api/communities/${encodeURIComponent(id)}/invite/reset`, {}),
      members: (id: string, params: { q?: string; offset?: number } = {}) =>
        freshGet<{ memberCount: number; members: CommunityMember[]; nextOffset: number | null }>(
          `/api/communities/${encodeURIComponent(id)}/members${communityQuery(params)}`,
        ),
      removeMember: (id: string, userId: string) =>
        del<{ ok: boolean }>(`/api/communities/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`),
      banMember: (id: string, userId: string) =>
        post<{ ok: boolean }>(`/api/communities/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/ban`, {}),
      unban: (id: string, userId: string) =>
        del<{ ok: boolean }>(`/api/communities/${encodeURIComponent(id)}/bans/${encodeURIComponent(userId)}`),
      bans: (id: string) =>
        freshGet<{ userId: string; name: string; bannedAt: string }[]>(`/api/communities/${encodeURIComponent(id)}/bans`),
      setRole: (id: string, userId: string, role: 'admin' | 'member' | 'owner') =>
        patch<{ ok: boolean; role: string }>(`/api/communities/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/role`, { role }),
      requests: (id: string) => freshGet<CommunityJoinRequest[]>(`/api/communities/${encodeURIComponent(id)}/requests`),
      approveRequest: (id: string, userId: string) =>
        post<{ ok: boolean }>(`/api/communities/${encodeURIComponent(id)}/requests/${encodeURIComponent(userId)}/approve`, {}),
      denyRequest: (id: string, userId: string) =>
        post<{ ok: boolean }>(`/api/communities/${encodeURIComponent(id)}/requests/${encodeURIComponent(userId)}/deny`, {}),
      messages: (id: string, params: { before?: number; after?: number; limit?: number } = {}) => {
        const q = new URLSearchParams();
        if (params.before !== undefined) q.set('before', String(params.before));
        if (params.after !== undefined) q.set('after', String(params.after));
        if (params.limit !== undefined) q.set('limit', String(params.limit));
        const qs = q.toString();
        return freshGet<CommunityMessagesPage>(`/api/communities/${encodeURIComponent(id)}/messages${qs ? `?${qs}` : ''}`);
      },
      send: (id: string, body: { text?: string; attachments?: CommunityAttachment[]; replyToId?: string }) =>
        post<CommunityMessage>(`/api/communities/${encodeURIComponent(id)}/messages`, body),
      deleteMessage: (id: string, messageId: string) =>
        del<{ ok: boolean }>(`/api/communities/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`),
      react: (id: string, messageId: string, reactionType: string) =>
        put<{ reactions: CommunityReaction[] }>(
          `/api/communities/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/reactions`, { reactionType }),
      unreact: (id: string, messageId: string) =>
        del<{ reactions: CommunityReaction[] }>(
          `/api/communities/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/reactions`),
      /** Image moderation runs here (gore/violence/nudity) — a rejected photo throws ApiError(422, code IMAGE_REJECTED). */
      uploadPhoto: (body: { data: string; mimeType: string }) =>
        post<{ url: string }>('/api/communities/upload-photo', body),
    },
    /** Brandthread Agent — the official AI friend account's chat backend. */
    brandthreadAgent: {
      sendMessage: (body: { conversationId: string; text: string }) =>
        post<{
          userMessage: { id: string; text: string; ts: number };
          agentMessage: { id: string; text: string; attachment?: any; ts: number };
        }>('/api/brandthread-agent/message', body),
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
    /**
     * Profile cover video (buyer + seller). The server enforces ≤25s and one
     * change per 24h (setting and removing both count); a 429 ApiError's
     * message is the user-facing "You can change your cover again in X hours".
     */
    profileCover: {
      get: () => freshGet<{
        coverVideoUrl: string | null;
        coverPosterUrl: string | null;
        coverVideoUpdatedAt: string | null;
        canChange: boolean;
        retryAfterHours?: number;
        message?: string;
      }>('/api/profile/cover-video'),
      upload: (uri: string, mimeType?: string | null, trim?: { start: number; duration: number } | null) =>
        uploadVideo<{ coverVideoUrl: string; coverPosterUrl: string; coverVideoUpdatedAt: string }>(
          trim
            ? `/api/profile/cover-video?trimStart=${encodeURIComponent(trim.start.toFixed(2))}&trimDuration=${encodeURIComponent(trim.duration.toFixed(2))}`
            : '/api/profile/cover-video',
          { uri, mimeType },
          getToken,
          getCacheScope,
        ),
      remove: () => del<{ coverVideoUrl: null; coverPosterUrl: null; coverVideoUpdatedAt: string | null }>('/api/profile/cover-video'),
      coachmark: () => freshGet<{ seen: boolean; hasCover: boolean }>('/api/profile/cover-coachmark'),
      markCoachmarkSeen: () => post<{ seen: true }>('/api/profile/cover-coachmark/seen', {}),
    },
    /**
     * Avatar video (moving profile picture, any account type). The server
     * enforces <=10s with no trim endpoint — a 400 ApiError's message is the
     * user-facing "Avatar videos can be at most 10 seconds…".
     */
    avatarVideo: {
      get: () => freshGet<{
        avatarVideoUrl: string | null;
        avatarPosterUrl: string | null;
        avatarVideoUpdatedAt: string | null;
      }>('/api/profile/avatar-video'),
      upload: (uri: string, mimeType?: string | null) =>
        uploadVideo<{ avatarVideoUrl: string; avatarPosterUrl: string; avatarVideoUpdatedAt: string }>(
          '/api/profile/avatar-video',
          { uri, mimeType },
          getToken,
          getCacheScope,
        ),
      remove: () => del<{ avatarVideoUrl: null; avatarPosterUrl: null }>('/api/profile/avatar-video'),
    },
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
      /** Videos that tagged this product ("Worn in these videos"). */
      taggedVideos: (productId: string, limit?: number) =>
        get<Array<{
          postId: string;
          mediaUrl: string;
          thumbnailUrl: string | null;
          caption: string | null;
          createdAt: string;
          authorId: string;
          authorName: string;
        }>>(`/api/public/products/${encodeURIComponent(productId)}/videos${limit ? `?limit=${limit}` : ''}`),
    },
    public: {
      search: (opts: { q: string; sort?: string; minPriceCents?: number; maxPriceCents?: number; category?: string | string[]; size?: string | string[]; color?: string | string[]; brand?: string | string[]; inStock?: boolean; facets?: boolean; limit?: number; offset?: number }) => {
        const params = new URLSearchParams();
        if (opts.q) params.set('q', opts.q);
        if (opts.sort) params.set('sort', opts.sort);
        if (opts.minPriceCents !== undefined) params.set('minPriceCents', String(opts.minPriceCents));
        if (opts.maxPriceCents !== undefined) params.set('maxPriceCents', String(opts.maxPriceCents));
        // Multi-value filters are sent as repeated params (?size=M&size=L).
        for (const key of ['category', 'size', 'color', 'brand'] as const) {
          const raw = opts[key];
          for (const v of Array.isArray(raw) ? raw : raw ? [raw] : []) params.append(key, v);
        }
        if (opts.inStock) params.set('inStock', '1');
        if (opts.facets) params.set('facets', '1');
        if (opts.limit) params.set('limit', String(opts.limit));
        if (opts.offset) params.set('offset', String(opts.offset));
        return get<{
          results: any[];
          pagination: { limit: number; offset: number; returned: number; total?: number; hasMore: boolean };
          facets?: {
            sizes: Array<{ value: string; count: number }>;
            colors: Array<{ value: string; count: number }>;
            categories: Array<{ value: string; count: number }>;
            brands: Array<{ id: string; name: string; count: number }>;
            price: { minCents: number; maxCents: number } | null;
            inStockCount: number;
          };
        }>(`/api/public/search?${params.toString()}`);
      },
      /** Trending search terms (real logged queries once there's enough volume, else categories + brands) for the search empty state. */
      trending: (limit = 8) =>
        get<{ trending: Array<{ term: string; type: 'category' | 'brand' | 'query' }> }>(
          `/api/public/search/trending?limit=${encodeURIComponent(String(limit))}`
        ),
      /** This signed-in buyer's own recent searches, most recent first. */
      recent: (limit = 10) =>
        get<{ recent: Array<{ query: string; normalized: string }> }>(
          `/api/public/search/recent?limit=${encodeURIComponent(String(limit))}`
        ),
      clearRecent: () => del<{ ok: boolean }>('/api/public/search/recent'),
      /** Remove a single term from this buyer's recent searches. */
      removeRecent: (term: string) => del<{ ok: boolean }>(`/api/public/search/recent/${encodeURIComponent(term)}`),
      /** Record an explicitly-submitted search — NOT called for the
       *  live-as-you-type suggestion fetches (see the route's own comment on
       *  why: this is what keeps /search/recent free of keystroke junk). */
      log: (query: string) => post<{ ok: boolean }>('/api/public/search/log', { query }),
      /** Suggested brands + products for the search empty state. */
      suggested: (limit = 6) =>
        get<{
          brands: Array<{
            id: string; sellerId: string; name: string; handle: string;
            color: string; initials: string; followerCount: number;
          }>;
          products: Array<{
            id: string; productId: string; name: string; brand: string;
            category: string; imageUri: string | null; color: string; initials: string;
          }>;
        }>(`/api/public/search/suggested?limit=${encodeURIComponent(String(limit))}`),
      /** "Search by category" tiles for the empty state — one representative image per top category. */
      categories: (limit = 8) =>
        get<{
          categories: Array<{ category: string; productCount: number; imageUri: string | null; color: string }>;
        }>(`/api/public/search/categories?limit=${encodeURIComponent(String(limit))}`),
    },
    /** Product Q&A — public read, signed-in ask, seller answers. */
    productQa: {
      list: (productId: string, limit = 30, offset = 0) =>
        get<{ questions: ProductQuestion[]; totalCount: number }>(
          `/api/product-qa/product/${encodeURIComponent(productId)}?limit=${limit}&offset=${offset}`,
        ),
      ask: (productId: string, body: string) =>
        post<ProductQuestion>(`/api/product-qa/product/${encodeURIComponent(productId)}`, { body }),
      remove: (questionId: string) => del<{ ok: boolean }>(`/api/product-qa/questions/${encodeURIComponent(questionId)}`),
      /** Seller inbox — questions on my products, unanswered first. */
      sellerInbox: () =>
        quietGet<{ unansweredCount: number; questions: SellerProductQuestion[] }>('/api/product-qa/seller'),
      answer: (questionId: string, body: string) =>
        post<{ id: string; body: string; createdAt: string }>(`/api/product-qa/questions/${encodeURIComponent(questionId)}/answer`, { body }),
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
        /** Object paths returned by `uploadPhoto`. */
        photos?:    string[];
        fitNote?:   'Runs small' | 'True to size' | 'Runs large';
      }) => post<any>('/api/reviews', body),
      /** Upload one review photo (buyer); send the returned objectPath in `photos`. */
      uploadPhoto: (image: { uri: string; mimeType?: string | null }) =>
        uploadImage<{ objectPath: string }>('/api/reviews/photos', image, getToken, getCacheScope),
      /** Mark a review helpful (idempotent, signed-in). */
      markHelpful: (reviewId: string) =>
        put<{ helpfulCount: number; viewerHelpful: boolean }>(`/api/reviews/${encodeURIComponent(reviewId)}/helpful`, {}),
      unmarkHelpful: (reviewId: string) =>
        del<{ helpfulCount: number; viewerHelpful: boolean }>(`/api/reviews/${encodeURIComponent(reviewId)}/helpful`),
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
          logoUrl:     string | null;
          bannerUrl:   string | null;
          storeAccentColor: string | null;
          category:    string | null;
          tags:        string[];
          location:    string | null;
          socialLinks: Record<string, string>;
          contactEmail: string | null;
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
      /** Upload the storefront logo (square, shown in the header preview). */
      uploadLogo: (image: { uri: string; mimeType?: string | null }) =>
        uploadImage<{ logoUrl: string }>('/api/seller/profile/logo/upload', image, getToken, getCacheScope),
      /** Upload the storefront banner / cover image (wide aspect). */
      uploadBanner: (image: { uri: string; mimeType?: string | null }) =>
        uploadImage<{ bannerUrl: string }>('/api/seller/profile/banner/upload', image, getToken, getCacheScope),
      /** Availability + profanity/reserved screening for a store name and/or @handle. */
      checkStoreIdentity: (params: { name?: string; handle?: string }) => {
        const q = new URLSearchParams();
        if (params.name !== undefined) q.set('name', params.name);
        if (params.handle !== undefined) q.set('handle', params.handle);
        return get<{
          name?:   { available: boolean; error?: string; code?: string };
          handle?: { available: boolean; error?: string; code?: string };
        }>(`/api/seller/identity/check?${q.toString()}`);
      },
      /** Claim the store name + handle; the server re-runs every check. */
      saveStoreIdentity: (body: { brandName: string; handle: string }) =>
        put<{ brandName: string; username: string }>('/api/seller/identity', body),
      /** Set (or clear with null) the storefront accent, from the monochrome allowlist. */
      setStoreAccent: (color: string | null) =>
        put<{ storeAccentColor: string | null }>('/api/seller/profile/accent', { color }),
      /** Save Instagram / TikTok handles or links; the server returns canonical URLs. */
      saveSocialLinks: (body: { instagram?: string; tiktok?: string }) =>
        put<{ socialLinks: Record<string, string> }>('/api/seller/social-links', body),
      /** Update return / cancellation policy text. */
      updatePolicy: (body: { returnPolicy?: string; cancellationPolicy?: string }) =>
        patch<{ returnPolicy: string | null; cancellationPolicy: string | null }>(
          '/api/seller/policy', body
        ),
      /** Search products and brand sellers by keyword. Returns results in
       *  SearchResult shape (kind='brand'|'product') compatible with searchData.ts. */
      search: (q: string, limit = 20) =>
        get<{ results: any[] }>(`/api/public/search?q=${encodeURIComponent(q)}&limit=${limit}`),
      launchChecklist: {
        get: () => get<LaunchChecklistResponse>('/api/seller/launch-checklist'),
        previewSeen: () => post<void>('/api/seller/launch-checklist/preview-seen', {}),
        dismiss: () => post<void>('/api/seller/launch-checklist/dismiss', {}),
      },
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
          /** false when this environment has no Stripe key configured. */
          providerConfigured?: boolean;
          payoutSchedule?: {
            interval: string | null;
            delayDays: number | null;
            weeklyAnchor: string | null;
            monthlyAnchor: number | null;
          } | null;
          requirementsDue?: string[];
          taxInfoStatus?: 'submitted' | 'needed' | 'unknown';
          /** Setup checklist (identity / bank account / tax info). */
          setupState?: 'not_started' | 'in_progress' | 'in_review' | 'complete' | 'restricted';
          steps?: Array<{
            id: 'identity' | 'bank_account' | 'tax_info';
            label: string;
            status: 'complete' | 'needed' | 'in_review';
            detail: string;
            requirements: string[];
            pastDue: boolean;
            upcoming: string[];
          }>;
          /** ISO date Stripe needs the outstanding details by, if any. */
          deadline?: string | null;
          disabledReason?: string | null;
        }>('/api/seller/connect/status'),
        /** A fresh single-use hosted link to resume setup (or the Express dashboard once complete). */
        link: () => get<{
          url: string;
          kind: 'account_onboarding' | 'login_link';
          expiresAt: number | null;
          stripeAccountId: string;
        }>('/api/seller/connect/link'),
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
        category?:     string;
        location?:     string;
        contactEmail?: string;
        tags?:         string[];
        socialLinks?:  Record<string, string>;
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
        /** What each plan includes (price, commission, AI credits, advanced analytics) plus the caller's plan. */
        perks: () => get<import('./proPerks').PerksResponse>('/api/seller/subscription/perks'),
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
      // ── Seller messaging tools: quick replies + away auto-reply ───────────
      quickReplies: {
        list: () =>
          get<{ quickReplies: SellerQuickReply[]; limit: number }>('/api/seller/quick-replies'),
        create: (body: { title: string; body: string; shortcut?: string | null }) =>
          post<SellerQuickReply>('/api/seller/quick-replies', body),
        update: (id: string, body: { title: string; body: string; shortcut?: string | null }) =>
          put<SellerQuickReply>(`/api/seller/quick-replies/${encodeURIComponent(id)}`, body),
        remove: (id: string) =>
          del<{ ok: true }>(`/api/seller/quick-replies/${encodeURIComponent(id)}`),
      },
      awayMessage: {
        get: () => get<SellerAwaySettings>('/api/seller/away-message'),
        update: (body: SellerAwaySettings) => put<SellerAwaySettings>('/api/seller/away-message', body),
      },
      // ── end seller messaging tools ────────────────────────────────────────
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
        /** Quote repost: embeds this post; requires a caption (server: POST /api/posts). */
        quotedPostId?: string;
      }) => post<any>('/api/posts', body),
      /** Public, paginated quote reposts of a post. */
      quotes: (id: string, query?: { limit?: number; offset?: number }) =>
        get<any[]>(`/api/posts/${encodeURIComponent(id)}/quotes${query ? `?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()}` : ''}`),
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
      /** Long videos (up to 10 min): chunked + resumable, real progress. */
      uploadVideoChunked: (
        video: { uri: string; mimeType?: string | null },
        opts?: { onProgress?: (fraction: number) => void; signal?: { aborted: boolean } },
      ) => uploadVideoChunked(video, getToken, opts),
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
      /** POST carousel: crop + adjust + trim every slide (photos and videos) into the fixed 3:4 canvas. */
      composeCarousel: (body: {
        items: Array<{
          kind: 'photo' | 'video'; objectPath: string;
          crop?: { x: number; y: number; width: number; height: number };
          adjust?: Record<string, number>;
          trimStart?: number; trimEnd?: number;
        }>;
      }) => post<{
        items: Array<{
          kind: 'photo' | 'video'; mediaPath: string; mediaUrl: string;
          thumbnailPath: string; thumbnailUrl: string; duration?: number;
        }>;
      }>('/api/posts/compose-carousel', body),
      /** Re-extract the cover frame from an already-composed video at a chosen offset, without re-encoding. */
      composeVideoThumbnail: (mediaPath: string, offset: number) => post<{
        thumbnailUrl: string;
        thumbnailPath: string;
        offset: number;
      }>('/api/posts/compose-video/thumbnail', { mediaPath, offset }),
      /** Compose ordered photo slides with per-slide text overlays into portrait rendered images */
      composeSlideshow: (body: {
        aspectRatio?: '1:1' | '3:4' | '9:16';
        surface?: 'thread' | 'profile';
        coverIndex?: number;
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
      watchedVideos: (cursor?: string) =>
        freshGet<{ items: WatchedVideo[]; nextCursor: string | null }>(
          `/api/posts/watched-videos${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        ),
      /** Caption tracks of a video post (503 CAPTIONS_UNAVAILABLE while the flag/AI keys are off). */
      captions: (id: string) =>
        get<{ postId: string; tracks: Array<{ language: string; status: 'pending' | 'ready' | 'failed'; source: 'whisper' | 'manual'; vttUrl: string | null; segments: Array<{ start: number; end: number; text: string }> }> }>(
          `/api/posts/${encodeURIComponent(id)}/captions`,
        ),
      /** Owner-only: start caption generation (idempotent unless force). */
      generateCaptions: (id: string, force = false) =>
        post<{ status: 'pending' | 'ready' }>(`/api/posts/${encodeURIComponent(id)}/captions/generate`, { force }),
      /** Owner-only: replace the text of every segment, in order (timing is kept server-side). */
      updateCaptions: (id: string, language: string, texts: string[]) =>
        patch<any>(`/api/posts/${encodeURIComponent(id)}/captions/${encodeURIComponent(language)}`, {
          segments: texts.map((text) => ({ text })),
        }),
      recordWatchedVideo: (id: string) =>
        trackAfter(post<{ action: string }>(`/api/posts/${encodeURIComponent(id)}/watched`, {}), [['video_watched', { surface: 'feed' }]]),
      /** Owner-only verified performance. Untracked metrics return tracked=false and null values. */
      analytics: (id: string) =>
        get<PostAnalyticsResponse>(`/api/posts/${encodeURIComponent(id)}/analytics`),
      interact: (id: string, body: { type: 'like' | 'repost' | 'view' | 'watch_time' | 'shop_click' | 'share' | 'not_interested'; value?: string }) =>
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
      /** Post owner only: pin a top-level comment (replaces any other pin). */
      pin: (postId: string, commentId: string) =>
        post<{ pinned: boolean; commentId: string }>(
          `/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/pin`, {},
        ),
      unpin: (postId: string, commentId: string) =>
        del<{ pinned: boolean; commentId: string }>(
          `/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/pin`,
        ),
    },
    /** Hashtag pages, trending and follows (public reads; follow needs auth). */
    hashtags: {
      trending: (limit = 10) =>
        get<{ tags: HashtagTrendingTag[] }>(`/api/hashtags/trending?limit=${limit}`),
      search: (q: string, limit = 12) =>
        get<{ tags: Array<{ tag: string; postCount: number }> }>(
          `/api/hashtags/search?q=${encodeURIComponent(q)}&limit=${limit}`),
      page: (tag: string, sort: 'top' | 'recent' = 'top') =>
        get<HashtagPage>(`/api/hashtags/${encodeURIComponent(tag)}?sort=${sort}`),
      posts: (tag: string, sort: 'top' | 'recent', cursor?: string | null) =>
        get<HashtagPostsPage>(
          `/api/hashtags/${encodeURIComponent(tag)}/posts?sort=${sort}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
      follow: (tag: string) =>
        post<{ tag: string; isFollowing: boolean }>(`/api/hashtags/${encodeURIComponent(tag)}/follow`, {}),
      unfollow: (tag: string) =>
        del<{ tag: string; isFollowing: boolean }>(`/api/hashtags/${encodeURIComponent(tag)}/follow`),
      following: () =>
        get<{ tags: Array<{ tag: string; postCount: number; followedAt: string }> }>('/api/hashtags/following'),
    },
    /** Locations: search/autocomplete, place pages, find-or-create (post location tags). */
    places: {
      search: (q: string, coords?: { lat: number; lng: number }) =>
        get<{ places: PlaceSearchResult[]; providerEnabled: boolean }>(
          `/api/places/search?q=${encodeURIComponent(q)}${coords ? `&lat=${coords.lat}&lng=${coords.lng}` : ''}`),
      page: (placeId: string, sort: 'top' | 'recent' = 'top') =>
        get<PlacePage>(`/api/places/${encodeURIComponent(placeId)}?sort=${sort}`),
      posts: (placeId: string, sort: 'top' | 'recent', cursor?: string | null) =>
        get<PlacePostsPage>(
          `/api/places/${encodeURIComponent(placeId)}/posts?sort=${sort}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
      /** Find-or-create from a name (+ optional coordinates / provider id). */
      save: (body: { name: string; lat?: number; lng?: number; city?: string; region?: string; country?: string; providerPlaceId?: string }) =>
        post<{ place: PlaceInfo; created: boolean }>('/api/places', body),
    },
    /** Buyer-to-buyer social graph: follows, profiles, search */
    social: {
      /** Contact sync (privacy-preserving: only SHA-256 hashes leave the device; feature-flagged server-side). */
      contacts: {
        status: () => get<{ enabled: boolean; optedIn: boolean }>('/api/social/contacts/status'),
        match: (hashes: string[]) =>
          post<{ matches: ContactMatch[] }>('/api/social/contacts/match', { hashes }),
        /** "Let friends find me": server hashes my account email; phoneHash is optional (hashed on device). */
        optIn: (phoneHash?: string) =>
          post<{ optedIn: boolean; kinds: string[] }>('/api/social/contacts/opt-in', phoneHash ? { phoneHash } : {}),
        revoke: () => del<{ ok: boolean }>('/api/social/contacts'),
      },
      /** Follow another buyer */
      follow: (userId: string) =>
        trackAfter(post<{ ok: boolean; isFollowing: boolean; followersCount: number; status?: 'requested' }>('/api/social/follow', { userId }), [['follow', { surface: 'profile' }]]),
      /** Unfollow a buyer */
      unfollow: (userId: string) =>
        del<{ ok: boolean; isFollowing: boolean; followersCount: number }>(`/api/social/follow/${encodeURIComponent(userId)}`),
      /** Check follow status between me and another user */
      status: (userId: string) =>
        get<{
          isFollowing: boolean; isFollowedBy: boolean; isMutual: boolean; followersCount: number;
          /** 'requested' while a follow request to a private account is pending. */
          status?: 'following' | 'requested' | 'none'; isPrivate?: boolean;
        }>(
          `/api/social/status/${encodeURIComponent(userId)}`
        ),
      /** Get a buyer's public profile + follow counts */
      profile: (userId: string) =>
        get<{
          userId: string; name: string; username: string | null;
          displayName: string | null; bio: string | null; avatarUrl: string | null;
          accountType: string; initials: string; color: string; handle: string;
          followersCount: number; followingCount: number; postsCount: number; likesCount?: number;
          isFollowing: boolean; isFollowedBy: boolean; isMutual: boolean;
          iBlockedThem: boolean;
          isPrivate?: boolean; followRequested?: boolean; contentHidden?: boolean;
        }>(`/api/social/profile/${encodeURIComponent(userId)}`),
      /** Posts where someone tagged this profile (the profile "Tagged" tab). */
      tagged: (userId: string, limit = 30, offset = 0) =>
        get<any[]>(`/api/social/profile/${encodeURIComponent(userId)}/tagged?limit=${limit}&offset=${offset}`),
      profilePosts: (userId: string, limit = 30, offset = 0) =>
        get<any[]>(`/api/social/profile/${encodeURIComponent(userId)}/posts?limit=${limit}&offset=${offset}`),
      friendActivity: (limit = 30, offset = 0) =>
        get<any[]>(`/api/social/friends/activity?limit=${limit}&offset=${offset}`),
      /** List buyers I follow. `sort`: 'default' (recent first) | 'latest' | 'earliest'. */
      following: (userId?: string, sort?: 'default' | 'latest' | 'earliest') => {
        const params = new URLSearchParams();
        if (userId) params.set('userId', userId);
        if (sort && sort !== 'default') params.set('sort', sort);
        const qs = params.toString();
        return quietGet<Array<{
          userId: string; name: string; username: string | null; handle: string;
          initials: string; color: string; followedAt: string; isFollowing: boolean; followsMe: boolean;
        }>>(`/api/social/following${qs ? `?${qs}` : ''}`);
      },
      /** List buyers who follow me (with isFollowingBack flag) */
      followers: (userId?: string) =>
        quietGet<Array<{
          userId: string; name: string; username: string | null; handle: string;
          initials: string; color: string; followedAt: string; isFollowingBack: boolean;
        }>>(`/api/social/followers${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`),
      /**
       * Search real user profiles by name / username — both buyer and
       * seller accounts (not just brands/storefronts). `roleTag` is "Buyer"
       * for a buyer, or the seller's storefront name (falling back to
       * "Seller") for a seller/both account.
       */
      search: (q: string, limit = 20) =>
        get<Array<{
          userId: string; name: string; username: string | null; handle: string;
          initials: string; color: string; bio: string | null; isFollowing: boolean;
          accountType: string; verified: boolean; roleTag: string; avatarUrl: string | null;
        }>>(`/api/social/search?q=${encodeURIComponent(q)}&limit=${limit}`),

      // ── Stories ─────────────────────────────────────────────────────────────
      /** Create a story (any authenticated user) */
      createStory: (body: {
        authorName: string; authorHandle?: string; authorInitials?: string;
        authorColor?: string; authorAccountType?: string;
        media: any[]; repliesDisabled?: boolean;
        privacy?: { visibility?: string; replyPermission?: string; closeFriendsOnly?: boolean };
        /** Reshare of a story that tagged me ("Add to your story"). */
        originalStoryId?: string;
      }) => post<any>('/api/social/stories', body),
      /** People picker for the @mention sticker: people I follow first, then everyone. */
      mentionSearch: (q: string, limit = 20) =>
        get<MentionPerson[]>(`/api/social/mention-search?q=${encodeURIComponent(q)}&limit=${limit}`),
      /** Activity "Story mentions" rail: active (<24h) stories that tagged me, newest first. */
      storyMentions: () =>
        freshGet<{ items: StoryMentionItem[]; unseenCount: number }>('/api/social/stories/mentions'),
      /** One story, if I'm the author, tagged, or a follower. 404 { code: 'STORY_UNAVAILABLE' } otherwise. */
      storyById: (storyId: string) =>
        get<Story>(`/api/social/stories/${encodeURIComponent(storyId)}`),
      /** "Not now" on a story that tagged me. */
      dismissStoryMention: (storyId: string) =>
        post<{ ok: boolean }>(`/api/social/stories/${encodeURIComponent(storyId)}/mention-dismiss`, {}),
      /**
       * Find/create the conversation for replying to a mention story. The
       * server routes it to the main inbox or Requests; send the message into
       * `conversationId` with the normal messages endpoint.
       */
      storyMentionReplyConversation: (storyId: string) =>
        post<{ conversationId: string; route: 'inbox' | 'requests'; isRequest: boolean; requestedBy: string | null }>(
          `/api/social/stories/${encodeURIComponent(storyId)}/mention-reply`, {}),
      /** My active stories */
      myStories: () => get<any[]>('/api/social/stories/me'),
      /** Another user's active stories — visible to that author's followers only */
      storiesForUser: (userId: string) =>
        get<any[]>(`/api/social/stories/user/${encodeURIComponent(userId)}`),
      /** Stories tray: one entry per followed author (+ me), grouped, with a seen flag */
      storiesFollowing: () =>
        get<Array<{
          authorId: string; authorName: string; authorHandle: string;
          authorInitials: string; authorColor: string; authorAccountType: string;
          avatarUrl: string | null;
          isMe: boolean; storyIds: string[]; seen: boolean; closeFriendsOnly: boolean; latestCreatedAt: number;
        }>>('/api/social/stories/following'),
      // ── Notes (bubble above story-tray avatars) ────────────────────────────
      /** Post (or replace) my own active note — 60 chars max, 24h TTL. */
      postNote: (text: string) =>
        post<{
          authorId: string; authorName: string; authorHandle: string;
          authorInitials: string; authorColor: string;
          text: string; createdAt: number; expiresAt: number;
        }>('/api/social/notes', { text }),
      /** Active notes from people I follow (+ my own), for the stories tray. */
      notesFollowing: () =>
        get<Array<{
          authorId: string; authorName: string; authorHandle: string;
          authorInitials: string; authorColor: string;
          text: string; createdAt: number; expiresAt: number;
        }>>('/api/social/notes/following'),
      /** Who has viewed my story (author only) */
      storyViewers: (storyId: string) =>
        get<Array<{ userId: string; name: string; handle: string; initials: string; avatarUrl: string | null; viewedAt: string }>>(
          `/api/social/stories/${encodeURIComponent(storyId)}/viewers`,
        ),
      /** Delete my own story before it expires */
      deleteStory: (storyId: string) =>
        del<{ id: string; deleted: boolean }>(`/api/social/stories/${encodeURIComponent(storyId)}`),
      /** Toggle like on a story */
      likeStory: (storyId: string) =>
        post<{ liked: boolean; likesCount: number }>(`/api/social/stories/${encodeURIComponent(storyId)}/like`, {}),
      /** Record a story view */
      viewStory: (storyId: string) =>
        post<{ ok: boolean }>(`/api/social/stories/${encodeURIComponent(storyId)}/view`, {}),
      // ── Close Friends (server-backed audience list) ────────────────────────
      closeFriends: () =>
        get<{ friends: Array<{ userId: string; name: string; handle: string; initials: string; avatarUrl: string | null }>; userIds: string[]; cap: number }>(
          '/api/social/close-friends'),
      saveCloseFriends: (userIds: string[]) =>
        put<{ userIds: string[]; rejected: string[] }>('/api/social/close-friends', { userIds }),
      // ── Story highlights (server-backed) ───────────────────────────────────
      myHighlights: () => get<ServerHighlight[]>('/api/social/highlights/me'),
      userHighlights: (userId: string) =>
        get<ServerHighlight[]>(`/api/social/highlights/user/${encodeURIComponent(userId)}`),
      highlight: (id: string) =>
        get<ServerHighlight & { stories: any[] }>(`/api/social/highlights/${encodeURIComponent(id)}`),
      highlightStories: () => get<HighlightPickerStory[]>('/api/social/highlights/stories'),
      createHighlight: (body: { title: string; coverEmoji?: string | null; coverColor?: string | null; coverUrl?: string | null; storyIds?: string[] }) =>
        post<ServerHighlight>('/api/social/highlights', body),
      updateHighlight: (id: string, body: { title?: string; coverEmoji?: string | null; coverColor?: string | null; coverUrl?: string | null; position?: number }) =>
        patch<ServerHighlight>(`/api/social/highlights/${encodeURIComponent(id)}`, body),
      deleteHighlight: (id: string) =>
        del<{ id: string; deleted: boolean }>(`/api/social/highlights/${encodeURIComponent(id)}`),
      addHighlightItem: (id: string, storyId: string) =>
        post<ServerHighlight>(`/api/social/highlights/${encodeURIComponent(id)}/items`, { storyId }),
      removeHighlightItem: (id: string, itemId: string) =>
        del<{ id: string; deleted: boolean }>(`/api/social/highlights/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`),
      // ── Interactive story stickers ─────────────────────────────────────────
      /** Vote on a poll sticker. 409 ALREADY_VOTED carries the current stickerState. */
      pollVote: (storyId: string, overlayId: string, optionIndex: number) =>
        post<{ ok: boolean; stickerState: StoryStickerState | null }>(
          `/api/social/stories/${encodeURIComponent(storyId)}/poll-vote`, { overlayId, optionIndex }),
      /** Answer a question sticker (one answer per person). */
      questionAnswer: (storyId: string, overlayId: string, answer: string) =>
        post<{ ok: boolean; stickerState: StoryStickerState | null }>(
          `/api/social/stories/${encodeURIComponent(storyId)}/question-answer`, { overlayId, answer }),
      /** Author only: every answer to the story's question stickers. */
      questionAnswers: (storyId: string) =>
        get<{ storyId: string; questions: Array<{ overlayId: string; prompt: string; answers: Array<{
          userId: string; name: string; handle: string; initials: string; avatarUrl: string | null; answer: string; createdAt: number;
        }> }> }>(`/api/social/stories/${encodeURIComponent(storyId)}/question-answers`),
      /** Author only: the DM to reply to someone's answer in (send the message with the normal messages endpoint). */
      questionReplyConversation: (storyId: string, userId: string) =>
        post<{ conversationId: string; route: 'inbox' | 'requests'; isRequest: boolean }>(
          `/api/social/stories/${encodeURIComponent(storyId)}/question-reply-conversation`, { userId }),
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
      /** My invitees (with reward status), pending vs earned Thread Cash, link clicks */
      stats: () =>
        get<{
          total: number;
          pointsEarned: number;
          clicks?: number;
          earnedCents?: number;
          pendingCents?: number;
          referrals: Array<{
            inviteeId: string;
            name: string | null;
            joinedAt: string;
            status?: 'pending' | 'qualified' | 'rewarded' | 'capped';
            rewardCents?: number;
          }>;
        }>('/api/referrals/stats'),
      /** Attribute a referral to the current user — call once after signup with the code they entered */
      apply: (code: string, expectedClerkId?: string) =>
        post<{ ok: boolean; inviterId: string; inviteeRewardCents?: number }>('/api/referrals/apply', {
          code,
          ...(expectedClerkId ? { expectedClerkId } : {}),
        }),
    },
    /** Affiliate / creator program — creator side (/api/affiliate) and seller side (/api/seller/affiliate) */
    affiliate: {
      overview: () => get<import('./affiliateTypes').CreatorOverview>('/api/affiliate/overview'),
      brand: (ref: string) => get<import('./affiliateTypes').BrandProgramInfo>(`/api/affiliate/brands/${encodeURIComponent(ref)}`),
      apply: (sellerId: string) =>
        post<{ id: string; status: string; code: string }>(`/api/affiliate/brands/${encodeURIComponent(sellerId)}/apply`, {}),
      respondToInvite: (id: string, accept: boolean) =>
        post<{ id: string; status: string }>(`/api/affiliate/invites/${encodeURIComponent(id)}/${accept ? 'accept' : 'decline'}`, {}),
      payouts: () =>
        get<{ payouts: import('./affiliateTypes').CreatorPayout[]; payout: import('./affiliateTypes').CreatorPayoutStatus }>('/api/affiliate/payouts'),
      onboardPayouts: () => post<{ url: string }>('/api/affiliate/payout-account/onboard', {}),
      /** Public, unauthenticated: records a click on a creator link. */
      click: (code: string, visitorId?: string) =>
        post<{ valid: boolean; code: string; sellerId: string }>('/api/public/affiliate/click', { code, visitorId }),
      attach: (code: string) =>
        post<{ attributed: boolean; reason?: string }>('/api/affiliate/attach', { code }),
      seller: {
        overview: () => get<import('./affiliateTypes').SellerAffiliateOverview>('/api/seller/affiliate'),
        saveProgram: (body: Partial<{
          enabled: boolean; commissionPercent: number; buyerDiscountPercent: number; windowDays: number;
          holdDays: number; minPayoutCents: number; autoApprove: boolean;
        }>) => put<{ program: import('./affiliateTypes').SellerProgram }>('/api/seller/affiliate/program', body),
        invite: (username: string, commissionPercent?: number) =>
          post<{ id: string; status: string }>('/api/seller/affiliate/creators/invite', { username, ...(commissionPercent != null ? { commissionPercent } : {}) }),
        approve: (id: string) => post<{ id: string; status: string }>(`/api/seller/affiliate/creators/${encodeURIComponent(id)}/approve`, {}),
        update: (id: string, body: { status?: 'active' | 'paused'; commissionPercent?: number | null }) =>
          patch<{ id: string; status: string }>(`/api/seller/affiliate/creators/${encodeURIComponent(id)}`, body),
        remove: (id: string) => del<{ id: string; status: string }>(`/api/seller/affiliate/creators/${encodeURIComponent(id)}`),
        payouts: () => get<{ payouts: Array<{ id: string; creatorName: string; amountCents: number; state: string; paidAt: string | null; createdAt: string }>; payoutsAvailable: boolean }>('/api/seller/affiliate/payouts'),
      },
    },
    /** Server-side privacy settings */
    privacy: {
      /** Get current server-side privacy preferences */
      get: () =>
        get<{ dmPrivacy: 'requests' | 'followers_only'; isPrivate?: boolean; canBePrivate?: boolean }>('/api/auth/privacy'),
      /** Update server-side privacy preferences */
      update: (settings: { dmPrivacy?: 'requests' | 'followers_only'; isPrivate?: boolean }) =>
        patch<{ dmPrivacy: 'requests' | 'followers_only'; isPrivate?: boolean }>('/api/auth/privacy', settings),
    },
    /** Private-account follow requests (incoming) and the Close Friends list. */
    followRequests: {
      list: (limit = 50, offset = 0) =>
        get<Array<{ userId: string; name: string; username: string | null; handle: string; avatarUrl: string | null; requestedAt: string }>>(
          `/api/social/follow-requests?limit=${limit}&offset=${offset}`,
        ),
      approve: (userId: string) =>
        post<{ ok: boolean; status: 'approved' }>(`/api/social/follow-requests/${encodeURIComponent(userId)}/approve`, {}),
      decline: (userId: string) =>
        post<{ ok: boolean; status: 'declined' }>(`/api/social/follow-requests/${encodeURIComponent(userId)}/decline`, {}),
    },
    closeFriends: {
      get: () =>
        get<{ friendIds: string[]; friends: Array<{ userId: string; name: string; username: string | null; handle: string; avatarUrl: string | null }> }>(
          '/api/social/close-friends',
        ),
      replace: (friendIds: string[]) =>
        put<{ ok: boolean; friendIds: string[]; skipped: string[] }>('/api/social/close-friends', { friendIds }),
    },
    /**
     * Server-side "seen" state for the buyer "Watching Threads" gesture coach
     * mark — source of truth across reinstalls/devices. See
     * lib/feedGestureGuideStorage.ts for the local cache + fallback logic.
     */
    feedGesturesTip: {
      get: () => get<{ seenVersion: number }>('/api/auth/feed-gestures-tip'),
      markSeen: (version: number) =>
        patch<{ seenVersion: number }>('/api/auth/feed-gestures-tip', { version }),
    },
    /**
     * Server-side "seen" state for the reusable <FirstRunTip> system (every
     * screen's first-run gesture hint / spotlight / anchored card /
     * full-screen guide) — source of truth across reinstalls/devices. See
     * lib/firstRunTips/storage.ts for the local cache + reconcile logic.
     */
    firstRunTips: {
      get: () => get<{ seenTipIds: string[]; skipAll: boolean }>('/api/first-run-tips/seen'),
      markSeen: (tipId: string) => post<void>(`/api/first-run-tips/${encodeURIComponent(tipId)}/seen`, {}),
      skipAll: () => post<void>('/api/first-run-tips/skip-all', {}),
      reset: () => post<void>('/api/first-run-tips/reset', {}),
    },
    /** Public seller storefront — profile + products + posts */
    publicSellers: {
      get: (sellerId: string) =>
        get<{ profile: any; products: any[]; posts: any[] }>(
          `/api/public/sellers/${encodeURIComponent(sellerId)}`
        ),
      recordVisit: (sellerId: string) =>
        post<void>(`/api/public/sellers/${encodeURIComponent(sellerId)}/visit`, {}),
      /**
       * Real, per-source traffic tracking for the seller Dashboard's Traffic
       * sources panel. Works for signed-out shoppers too (no auth required) —
       * this is analytics, not a user action. Fire-and-forget by design: never
       * await this from a screen's own render/loading path.
       */
      recordStoreVisit: (sellerId: string, opts: { source: 'feed' | 'search' | 'profile' | 'external'; productId?: string | null }) =>
        post<void>(`/api/public/sellers/${encodeURIComponent(sellerId)}/store-visits`, {
          source: opts.source,
          productId: opts.productId ?? undefined,
        }),
    },
    /** Buyer-facing drops listing (active, with countdown releaseAt) */
    publicDrops: {
      list: (section?: 'upcoming' | 'live' | 'recent') =>
        get<any[]>(`/api/public/drops${section ? `?section=${section}` : ''}`),
      get:  (id: string) => get<any>(`/api/public/drops/${encodeURIComponent(id)}`),
      notificationStatus: (id: string) =>
        get<{ subscribed: boolean }>(`/api/public/drops/${encodeURIComponent(id)}/notify`),
      subscribe: (id: string) =>
        post<{ subscribed: boolean }>(`/api/public/drops/${encodeURIComponent(id)}/notify`, {}),
      unsubscribe: (id: string) =>
        del<{ subscribed: boolean }>(`/api/public/drops/${encodeURIComponent(id)}/notify`),
    },
    /** Seller email marketing (list, campaigns, sending) */
    emailMarketing: {
      status:   () => get<EmailMarketingStatus>('/api/marketing/email/status'),
      settings: () => get<EmailSettings>('/api/marketing/email/settings'),
      saveSettings: (data: Omit<EmailSettings, 'defaultFromName'>) => put<{ ok: boolean }>('/api/marketing/email/settings', data),
      audience: (offset = 0) => freshGet<EmailAudienceResponse>(`/api/marketing/email/audience?limit=50&offset=${offset}`),
      exportCsv: () => getText('/api/marketing/email/audience/export'),
      removeSubscriber: (id: string) => del<{ ok: boolean }>(`/api/marketing/email/subscribers/${encodeURIComponent(id)}`),
      campaigns: () => freshGet<{ campaigns: EmailCampaign[] }>('/api/marketing/email/campaigns'),
      campaign: (id: string) => freshGet<EmailCampaign>(`/api/marketing/email/campaigns/${encodeURIComponent(id)}`),
      createCampaign: (data: EmailCampaignInput) => post<EmailCampaign>('/api/marketing/email/campaigns', data),
      updateCampaign: (id: string, data: EmailCampaignInput) => put<EmailCampaign>(`/api/marketing/email/campaigns/${encodeURIComponent(id)}`, data),
      deleteCampaign: (id: string) => del<{ ok: boolean }>(`/api/marketing/email/campaigns/${encodeURIComponent(id)}`),
      preview: (id: string) => post<{ html: string; text: string }>(`/api/marketing/email/campaigns/${encodeURIComponent(id)}/preview`, {}),
      sendTest: (id: string) => post<{ ok: boolean; sentTo: string }>(`/api/marketing/email/campaigns/${encodeURIComponent(id)}/test`, {}),
      send: (id: string, scheduleAt?: string) => post<EmailCampaign>(`/api/marketing/email/campaigns/${encodeURIComponent(id)}/send`, scheduleAt ? { scheduleAt } : {}),
      unschedule: (id: string) => post<EmailCampaign>(`/api/marketing/email/campaigns/${encodeURIComponent(id)}/unschedule`, {}),
    },
    /** Buyer discovery: normalized categories and real-signal trending (public). */
    publicDiscovery: {
      categories: () =>
        get<{ categories: Array<{ slug: string; label: string; productCount: number; coverImageUrl: string | null }> }>(
          '/api/public/categories',
        ),
      categoryProducts: (slug: string, opts: { limit?: number; offset?: number } = {}) => {
        const params = new URLSearchParams();
        if (opts.limit) params.set('limit', String(opts.limit));
        if (opts.offset) params.set('offset', String(opts.offset));
        const q = params.toString();
        return get<{ slug: string; label: string | null; total: number; products: any[] }>(
          `/api/public/categories/${encodeURIComponent(slug)}/products${q ? `?${q}` : ''}`,
        );
      },
      trendingProducts: (limit = 12) =>
        get<{ windowDays: number; products: any[] }>(`/api/public/trending/products?limit=${encodeURIComponent(String(limit))}`),
      trendingBrands: (limit = 12) =>
        get<{ windowDays: number; brands: Array<{
          id: string; sellerId: string; name: string; brandType: string | null; logoUrl: string | null;
          coverImageUrl: string | null; followerCount: number; verified: boolean;
        }> }>(`/api/public/trending/brands?limit=${encodeURIComponent(String(limit))}`),
    },
    /** Discount codes — seller-managed promo codes */
    discountCodes: {
      list:   () => get<any[]>('/api/discount-codes'),
      collections: () => get<Array<{ id: string; title: string }>>('/api/discount-codes/collections'),
      create: (data: {
        code?: string;
        type: 'percentage' | 'fixed' | 'free_shipping' | 'free_item';
        value?: number;
        minOrderCents?: number;
        appliesTo?: 'entire_store' | 'specific_products' | 'collections';
        productIds?: string[];
        collectionIds?: string[];
        firstOrderOnly?: boolean;
        minQuantity?: number;
        maxUses?: number | null;
        singleUse?: boolean;
        oneUsePerCustomer?: boolean;
        startsAt?: string | null;
        expiresAt?: string | null;
        /** Live-only code: valid only for this stream, while it is live. */
        liveStreamId?: string;
      }) => post<any>('/api/discount-codes', data),
      update: (id: string, data: {
        active?: boolean;
        startsAt?: string | null;
        expiresAt?: string | null;
        minOrderCents?: number;
        maxUses?: number | null;
        oneUsePerCustomer?: boolean;
        appliesTo?: 'entire_store' | 'specific_products' | 'collections';
        productIds?: string[];
        collectionIds?: string[];
        firstOrderOnly?: boolean;
        minQuantity?: number;
        value?: number;
      }) => patch<any>(`/api/discount-codes/${id}`, data),
      delete: (id: string) => del<any>(`/api/discount-codes/${id}`),
      uses:   (id: string) => get<any[]>(`/api/discount-codes/${id}/uses`),
      validate: (code: string, sellerId: string, subtotalCents: number, items?: { productId: string; priceCents: number; quantity: number }[], liveStreamId?: string) =>
        get<any>(`/api/discount-codes/validate?code=${encodeURIComponent(code)}&sellerId=${encodeURIComponent(sellerId)}&subtotalCents=${subtotalCents}${items ? `&items=${encodeURIComponent(JSON.stringify(items))}` : ''}${liveStreamId ? `&liveStreamId=${encodeURIComponent(liveStreamId)}` : ''}`),
    },
    /** Automatic sales — seller-managed price reductions (no code needed) */
    sales: {
      list:        () => get<any[]>('/api/sales'),
      collections: () => get<string[]>('/api/sales/collections'),
      create: (data: {
        name: string; discountType: 'percent' | 'fixed'; value: number;
        scope: 'store' | 'products' | 'collection'; productIds?: string[]; collection?: string | null;
        startsAt?: string | null; endsAt?: string | null; active?: boolean;
      }) => post<any>('/api/sales', data),
      update: (id: string, data: Partial<{
        name: string; discountType: 'percent' | 'fixed'; value: number;
        scope: 'store' | 'products' | 'collection'; productIds: string[]; collection: string | null;
        startsAt: string | null; endsAt: string | null; active: boolean;
      }>) => patch<any>(`/api/sales/${id}`, data),
      delete: (id: string) => del<any>(`/api/sales/${id}`),
    },
    /** Seller follower push broadcasts (1 per rolling 24h, enforced server-side). */
    sellerPush: {
      status: () => get<any>('/api/seller/push-broadcasts'),
      preview: (body: { title: string; body: string; deeplinkType?: string | null; deeplinkId?: string | null }) =>
        post<any>('/api/seller/push-broadcasts/preview', body),
      send: (body: { title: string; body: string; deeplinkType?: string | null; deeplinkId?: string | null }) =>
        post<any>('/api/seller/push-broadcasts', body),
      results: (id: string) => get<any>(`/api/seller/push-broadcasts/${encodeURIComponent(id)}`),
    },
    /** Seller giveaway tool. */
    sellerGiveaways: {
      list: () => get<{ giveaways: any[] }>('/api/seller/giveaways'),
      get: (id: string) => get<any>(`/api/seller/giveaways/${encodeURIComponent(id)}`),
      create: (body: unknown) => post<any>('/api/seller/giveaways', body),
      rulesTemplate: (query: string) => get<{ rulesText: string }>(`/api/seller/giveaways/rules-template?${query}`),
      end: (id: string) => post<any>(`/api/seller/giveaways/${encodeURIComponent(id)}/end`, {}),
      cancel: (id: string) => post<any>(`/api/seller/giveaways/${encodeURIComponent(id)}/cancel`, {}),
      draw: (id: string) => post<any>(`/api/seller/giveaways/${encodeURIComponent(id)}/draw`, {}),
      redraw: (id: string, winnerId: string, reason: string) =>
        post<any>(`/api/seller/giveaways/${encodeURIComponent(id)}/winners/${encodeURIComponent(winnerId)}/redraw`, { reason }),
      markShipped: (id: string, winnerId: string, shipped: boolean) =>
        post<any>(`/api/seller/giveaways/${encodeURIComponent(id)}/winners/${encodeURIComponent(winnerId)}/shipped`, { shipped }),
      myPosts: () => get<any[]>('/api/posts/mine?limit=30'),
    },
    /** Buyer-facing giveaway reads (card on a brand's profile + the entry page). */
    giveaways: {
      liveForSeller: (sellerId: string) => get<{ giveaway: any | null }>(`/api/giveaways/seller/${encodeURIComponent(sellerId)}/live`),
      get: (code: string) => get<any>(`/api/giveaways/${encodeURIComponent(code)}`),
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
      /** Upload one return photo (buyer); send the returned objectPath in `evidenceUrls`. */
      uploadEvidence: (image: { uri: string; mimeType?: string | null }) =>
        uploadImage<{ objectPath: string }>('/api/returns/evidence', image, getToken, getCacheScope),
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
    /** Shipping zones — worldwide zone-based rates (domestic / country / rest-of-world), replacing the single flat rate above. */
    shippingZones: {
      list: () => get<any[]>('/api/shipping-zones'),
      create: (data: {
        name: string;
        zoneType: 'domestic' | 'country' | 'rest_of_world';
        countries?: string[];
        pricingModel?: 'flat' | 'weight_tiered';
        flatRateCents?: number;
        freeAboveCents?: number | null;
        processingDays?: number;
        carrierLabel?: string | null;
        shipsInternationally?: boolean;
        dutiesHandling?: 'ddp' | 'dap';
        sortOrder?: number;
      }) => post<any>('/api/shipping-zones', data),
      update: (id: string, data: Record<string, unknown>) =>
        patch<any>(`/api/shipping-zones/${encodeURIComponent(id)}`, data),
      delete: (id: string) => del<any>(`/api/shipping-zones/${encodeURIComponent(id)}`),
      setWeightTiers: (id: string, tiers: Array<{ minWeightGrams: number; maxWeightGrams: number | null; rateCents: number }>) =>
        put<any>(`/api/shipping-zones/${encodeURIComponent(id)}/weight-tiers`, { tiers }),
      getSettings: () => get<{ shipFromCountry: string }>('/api/shipping-zones/settings'),
      updateSettings: (shipFromCountry: string) =>
        patch<{ shipFromCountry: string }>('/api/shipping-zones/settings', { shipFromCountry }),
      resolve: (sellerId: string, country: string, subtotalCents: number, weightGrams = 0) =>
        get<any>(`/api/shipping-zones/resolve?sellerId=${encodeURIComponent(sellerId)}&country=${encodeURIComponent(country)}&subtotalCents=${subtotalCents}&weightGrams=${weightGrams}`),
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
    /** Scheduled product launches + "Notify me". */
    productLaunches: {
      /** Public: is this product waiting on a launch time? */
      state:       (productId: string) =>
        get<{ launching: boolean; launchAt: string | null; serverNow: string }>(`/api/product-launches/${encodeURIComponent(productId)}`),
      alertStatus: (productId: string) =>
        get<{ subscribed: boolean }>(`/api/product-launches/${encodeURIComponent(productId)}/alert`),
      alertOn:     (productId: string) =>
        post<{ subscribed: boolean }>(`/api/product-launches/${encodeURIComponent(productId)}/alert`, {}),
      alertOff:    (productId: string) =>
        del<{ subscribed: boolean }>(`/api/product-launches/${encodeURIComponent(productId)}/alert`),
      /** Seller. */
      list:        () => get<Array<{
        productId: string; name: string; imageUrl: string | null; status: string;
        launchAt: string; launchedAt: string | null; notifyFollowers: boolean; alertCount: number;
      }>>('/api/product-launches'),
      schedule:    (productId: string, data: { launchAt: string; notifyFollowers?: boolean }) =>
        put<any>(`/api/product-launches/${encodeURIComponent(productId)}`, data),
      cancel:      (productId: string) =>
        del<{ cancelled: boolean }>(`/api/product-launches/${encodeURIComponent(productId)}`),
    },
    /** Pre-order ship-by terms (60-day refund window). */
    preorderTerms: {
      get: (productId: string) =>
        get<{ shipBy: string; daysLeft: number; closingDate: string | null; refundWindowDays: number; refundCopy: string; note: string | null }>(
          `/api/preorder-terms/${encodeURIComponent(productId)}`),
      set: (productId: string, data: { shipBy: string; note?: string | null }) =>
        put<any>(`/api/preorder-terms/${encodeURIComponent(productId)}`, data),
    },
    /** Reusable size chart templates — seller CRUD, apply to products. */
    sizeChartTemplates: {
      list:   () => get<{ templates: SizeChartTemplateSummary[]; presets: SizeChartPreset[] }>('/api/size-chart-templates'),
      get:    (id: string) => get<SizeChartTemplateDetail>(`/api/size-chart-templates/${encodeURIComponent(id)}`),
      create: (data: { name: string; chart?: SizeChartData; fromProductId?: string }) =>
        post<SizeChartTemplateSummary>('/api/size-chart-templates', data),
      update: (id: string, data: { name?: string; chart?: SizeChartData }) =>
        put<SizeChartTemplateSummary>(`/api/size-chart-templates/${encodeURIComponent(id)}`, data),
      delete: (id: string) => del<{ success: boolean }>(`/api/size-chart-templates/${encodeURIComponent(id)}`),
      apply:  (id: string, productIds: string[]) =>
        post<{ applied: number }>(`/api/size-chart-templates/${encodeURIComponent(id)}/apply`, { productIds }),
      sync:   (id: string) => post<{ synced: number }>(`/api/size-chart-templates/${encodeURIComponent(id)}/sync`, {}),
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
    /** "Complete the fit" — seller-curated related products for a product page. */
    productPairings: {
      get:  (productId: string) =>
        freshGet<{ pairings: ProductPairing[] }>(`/api/product-pairings/${encodeURIComponent(productId)}`),
      save: (productId: string, pairedProductIds: string[]) =>
        put<{ pairings: ProductPairing[] }>(`/api/product-pairings/${encodeURIComponent(productId)}`, { pairedProductIds }),
      /** Public (works signed out): active products only. */
      publicList: (productId: string) =>
        get<PublicPairedProduct[]>(`/api/product-pairings/public/${encodeURIComponent(productId)}`),
    },
    /** Product video — one short silent video per product. */
    productVideos: {
      get:    (productId: string) =>
        freshGet<{ video: ProductVideoInfo | null }>(`/api/product-videos/${encodeURIComponent(productId)}`),
      upload: (productId: string, uri: string, mimeType?: string | null, onProgress?: (fraction: number) => void) =>
        uploadVideoWithProgress<{ video: ProductVideoInfo }>(
          `/api/product-videos/${encodeURIComponent(productId)}`, { uri, mimeType }, getToken, getCacheScope, onProgress,
        ),
      remove: (productId: string) =>
        del<{ video: null }>(`/api/product-videos/${encodeURIComponent(productId)}`),
      /** Public (works signed out). */
      publicGet: (productId: string) =>
        get<{ video: ProductVideoInfo | null }>(`/api/product-videos/public/${encodeURIComponent(productId)}`),
    },
    /** Variant option axes, matrix generation, bulk variant edits and stock rules. */
    productVariants: {
      get:      (productId: string) => get<any>(`/api/product-variants/${encodeURIComponent(productId)}`),
      putAxes:  (productId: string, axes: Array<{ name: string; values: string[] }>) =>
        put<any>(`/api/product-variants/${encodeURIComponent(productId)}/axes`, { axes }),
      generate: (productId: string, data: { priceCents?: number; stock?: number; lowStockThreshold?: number; baseSku?: string }) =>
        post<any>(`/api/product-variants/${encodeURIComponent(productId)}/generate`, data),
      bulkUpdate: (productId: string, updates: Array<{ variantId: string; priceCents?: number; stock?: number; sku?: string; lowStockThreshold?: number }>) =>
        patch<any>(`/api/product-variants/${encodeURIComponent(productId)}/variants/bulk`, { updates }),
      getStockRules: (productId: string) => get<any>(`/api/product-variants/${encodeURIComponent(productId)}/stock-rules`),
      putStockRules: (productId: string, data: Record<string, unknown>) =>
        put<any>(`/api/product-variants/${encodeURIComponent(productId)}/stock-rules`, data),
    },
    // (buyer key defined earlier in this object — no duplicate)
    /** Team members — invite flow, roles, and activity log */
    team: {
      members:   () => get<any[]>('/api/team/members'),
      member:    (id: string) => get<any>(`/api/team/members/${encodeURIComponent(id)}`),
      invite:    (data: { email?: string; username?: string; name?: string; role?: string }) => post<any>('/api/team/invite', data),
      /** Public: resolve invite details for the accept screen (works signed-out) */
      resolveInvite: (token: string) => get<any>(`/api/team/invite/accept/${encodeURIComponent(token)}`),
      accept:    (token: string) => post<any>(`/api/team/invite/accept/${encodeURIComponent(token)}`, {}),
      regenerateInvite: (memberId: string) => post<any>(`/api/team/invite/${encodeURIComponent(memberId)}/regenerate`, {}),
      changeRole: (memberId: string, role: string) => patch<any>(`/api/team/members/${encodeURIComponent(memberId)}/role`, { role }),
      remove:    (memberId: string) => del<any>(`/api/team/members/${encodeURIComponent(memberId)}`),
      roles:     () => get<any[]>('/api/team/roles'),
      roleMembers: (role: string) => get<any[]>(`/api/team/roles/${encodeURIComponent(role)}/members`),
      /** Resolves the caller's permission tier for the active store context. */
      context: () => get<{ role: 'owner' | 'admin' | 'manager' | 'finance' | 'orders' | 'marketing' | 'staff' | 'viewer' }>('/api/team/context'),
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
    /** CSV (Shopify / Etsy / Brandthread layouts) and Etsy product import. */
    productImport: {
      providers: () => get<ImportProviders>('/api/product-import/providers'),
      runs: () => get<{ runs: ImportRun[] }>('/api/product-import/runs'),
      previewCsv: (csv: string) => request<ImportPreview>(
        '/api/product-import/csv/preview', { method: 'POST', body: csv, headers: { 'Content-Type': 'text/csv' } },
        getToken, false, getCacheScope, false, EXPENSIVE_REQUEST_TIMEOUT_MS),
      commitCsv: (csv: string, filename?: string) => request<ImportCommitResult>(
        `/api/product-import/csv/commit${filename ? `?filename=${encodeURIComponent(filename)}` : ''}`,
        { method: 'POST', body: csv, headers: { 'Content-Type': 'text/csv' } },
        getToken, false, getCacheScope, false, EXPENSIVE_REQUEST_TIMEOUT_MS),
      etsyConnect: () => post<{ authorizeUrl: string }>('/api/product-import/etsy/connect/start', {}),
      etsyDisconnect: () => post<{ ok: boolean }>('/api/product-import/etsy/disconnect', {}),
      etsyPreview: () => request<ImportPreview>('/api/product-import/etsy/preview', { method: 'POST', body: '{}' },
        getToken, false, getCacheScope, false, EXPENSIVE_REQUEST_TIMEOUT_MS),
      etsyCommit: () => request<ImportCommitResult>('/api/product-import/etsy/commit', { method: 'POST', body: '{}' },
        getToken, false, getCacheScope, false, EXPENSIVE_REQUEST_TIMEOUT_MS),
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
      /** Stored status events merged with Stripe's live state. */
      timeline: (id: string) =>
        freshGet<DisputeTimeline>(`/api/disputes/${encodeURIComponent(id)}/timeline`),
      /** JPEG / PNG / PDF, 5 MB max. `type` is the Stripe evidence field. */
      uploadEvidenceFile: (
        id: string,
        file: { uri: string; mimeType: string; name?: string },
        type: DisputeFileType,
      ) => uploadImage<{ file: DisputeEvidenceFile }>(
        `/api/disputes/${encodeURIComponent(id)}/evidence/upload?type=${encodeURIComponent(type)}${file.name ? `&filename=${encodeURIComponent(file.name)}` : ''}`,
        { uri: file.uri, mimeType: file.mimeType },
        getToken,
        getCacheScope,
      ),
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
      /** Fee schedule (no auth). Derived server-side from lib/money/fees.ts. */
      feeSchedule: () => get<any>('/api/public/fee-schedule'),
      payout: (data: { idempotencyKey: string; amount: number; currency: string; method?: 'standard' | 'instant' }) =>
        post<any>('/api/finance/payout', data),
      /** Current schedule, Instant eligibility and fee quote (optionally for an amount in cents), next payout estimate. */
      payoutSchedule: (amountCents?: number) =>
        freshGet<PayoutScheduleInfo>(`/api/finance/payout-schedule${amountCents ? `?amount=${amountCents}` : ''}`),
      setPayoutSchedule: (data: { interval: 'daily' | 'weekly' | 'manual'; weeklyAnchor?: WeeklyAnchor }) =>
        patch<{ changed: boolean; schedule: PayoutScheduleInfo['schedule'] }>('/api/finance/payout-schedule', data),
      /** One payout with its Sales / fees / refunds / holds breakdown. */
      payoutDetail: (id: string) =>
        freshGet<PayoutDetail>(`/api/finance/payouts/${encodeURIComponent(id)}`),
    },
    /** Seller payment settings (Buy now, pay later opt-in). */
    sellerPaymentSettings: {
      get: () => get<{ bnplEnabled: boolean; bnplAvailable: boolean }>('/api/seller/payment-settings'),
      setBnpl: (bnplEnabled: boolean) =>
        patch<{ bnplEnabled: boolean; bnplAvailable: boolean }>('/api/seller/payment-settings', { bnplEnabled }),
    },
    /** Monthly seller statements (list, JSON summary, authenticated PDF/CSV bytes). */
    statements: {
      list: (limit?: number) => freshGet<StatementList>(`/api/finance/statements${limit ? `?limit=${limit}` : ''}`),
      get:  (month: string) => freshGet<StatementDetail>(`/api/finance/statements/${encodeURIComponent(month)}`),
      /** Bearer-authenticated file download; returns the raw bytes. */
      download: async (month: string, format: StatementFormat): Promise<ArrayBuffer> => {
        const token = await getCachedToken(getToken);
        const res = await fetchWithTimeout(
          `${BASE}${versionApiPath(`/api/finance/statements/${encodeURIComponent(month)}.${format}`)}`,
          { method: 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...storeContextHeaders() } },
          EXPENSIVE_REQUEST_TIMEOUT_MS,
        );
        if (!res.ok) throw new ApiError(res.status, await res.text());
        return res.arrayBuffer();
      },
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
      config:    (data: { stripeTaxEnabled?: boolean; collectDuties?: boolean; chargeShippingTax?: boolean; chargeVat?: boolean; taxCalculationMode?: string }) =>
        patch<any>('/api/taxes/config', data),
      forms1099: (year?: number) => get<any>(`/api/taxes/1099${year ? `?year=${year}` : ''}`),
      calculate: (data: { lineItems: any[]; shippingAddress: any; currency?: string; shippingCents?: number }) =>
        post<any>('/api/taxes/calculate', data),
    },
    /** Live Shopping — Agora-powered live streams */
    live: {
      start:          (data: { title: string; description?: string; productTags?: any[]; thumbnailUrl?: string; scheduledLiveId?: string }) =>
        post<any>('/api/live/start', data),
      active:         () => get<{ streams: any[] }>('/api/live/active'),
      get:            (id: string) => get<{ stream: any }>(`/api/live/${encodeURIComponent(id)}`),
      join:           (id: string) => trackAfter(post<any>(`/api/live/${encodeURIComponent(id)}/join`, {}), [['live_joined']]),
      leave:          (id: string) => post<any>(`/api/live/${encodeURIComponent(id)}/leave`, {}),
      /** HTTP presence fallback — only used when the WebSocket can't connect (see lib/live/useLiveSocket.ts). */
      heartbeat:      (id: string) => post<any>(`/api/live/${encodeURIComponent(id)}/heartbeat`, {}),
      end:            (id: string) => post<any>(`/api/live/${encodeURIComponent(id)}/end`, {}),
      updateProducts: (id: string, productTags: any[]) =>
        patch<any>(`/api/live/${encodeURIComponent(id)}/products`, { productTags }),
      comment:        (id: string, data: { message: string; displayName?: string; avatarUrl?: string }) =>
        post<any>(`/api/live/${encodeURIComponent(id)}/comment`, data),
      // ── Live commerce (pin) ── routes/live-commerce.ts
      /** Pin a tagged product (productId) or unpin (null); broadcast to viewers over the live socket. */
      pin:            (id: string, productId: string | null) =>
        post<{ pinnedProductId: string | null; productTags: any[] }>(`/api/live/${encodeURIComponent(id)}/pin`, { productId }),
      // ── end live commerce ──
      comments:       (id: string, since?: string) =>
        get<{ comments: any[] }>(`/api/live/${encodeURIComponent(id)}/comments${since ? `?since=${encodeURIComponent(since)}` : ''}`),
    },
    // ── BEGIN live moderation + co-host (routes/live-moderation.ts, routes/live-cohost.ts) ──
    liveMod: {
      get:         (id: string) => get<LiveModerationState>(`/api/live/${encodeURIComponent(id)}/moderation`),
      saveSettings: (id: string, data: { bannedWords?: string[]; slowModeSeconds?: number; saveAsDefault?: boolean }) =>
        put<{ bannedWords: string[]; slowModeSeconds: number }>(`/api/live/${encodeURIComponent(id)}/moderation/settings`, data),
      pin:         (id: string, commentId: string | null) =>
        post<{ pinnedComment: any }>(`/api/live/${encodeURIComponent(id)}/moderation/pin`, { commentId }),
      mute:        (id: string, userId: string) => post<any>(`/api/live/${encodeURIComponent(id)}/moderation/mute`, { userId }),
      unmute:      (id: string, userId: string) => del<any>(`/api/live/${encodeURIComponent(id)}/moderation/mute/${encodeURIComponent(userId)}`),
      ban:         (id: string, userId: string) => post<any>(`/api/live/${encodeURIComponent(id)}/moderation/ban`, { userId }),
      unban:       (id: string, userId: string) => del<any>(`/api/live/${encodeURIComponent(id)}/moderation/ban/${encodeURIComponent(userId)}`),
      removeComment: (id: string, commentId: string) =>
        del<any>(`/api/live/${encodeURIComponent(id)}/moderation/comments/${encodeURIComponent(commentId)}`),
      /** Anyone: the pinned comment + slow-mode seconds for the viewer chat header. */
      pinned:      (id: string) => get<{ pinnedComment: any | null; slowModeSeconds: number }>(`/api/live/${encodeURIComponent(id)}/pinned`),
      defaults:    () => get<{ bannedWords: string[]; slowModeSeconds: number }>('/api/live/moderation-defaults'),
      saveDefaults: (data: { bannedWords: string[]; slowModeSeconds: number }) =>
        put<{ bannedWords: string[]; slowModeSeconds: number }>('/api/live/moderation-defaults', data),
    },
    liveCohost: {
      candidates:  (q: string) => get<{ sellers: LiveCohostCandidate[] }>(`/api/live/cohost-candidates?q=${encodeURIComponent(q)}`),
      invites:     () => get<{ invites: LiveCohostInvite[] }>('/api/live/cohost-invites'),
      list:        (id: string) => get<{ cohosts: LiveCohostPerson[] }>(`/api/live/${encodeURIComponent(id)}/cohosts`),
      invite:      (id: string, userId: string) => post<any>(`/api/live/${encodeURIComponent(id)}/cohost/invite`, { userId }),
      cancel:      (id: string, userId: string) => post<any>(`/api/live/${encodeURIComponent(id)}/cohost/cancel`, { userId }),
      respond:     (id: string, accept: boolean) =>
        post<{ ok: boolean; status: string; channelName?: string; agoraUid?: number; agoraAppId?: string; token?: string }>(
          `/api/live/${encodeURIComponent(id)}/cohost/respond`, { accept }),
      token:       (id: string) =>
        post<{ channelName: string; agoraUid: number; agoraAppId: string; token: string }>(`/api/live/${encodeURIComponent(id)}/cohost/token`, {}),
      remove:      (id: string, userId: string) => post<any>(`/api/live/${encodeURIComponent(id)}/cohost/remove`, { userId }),
      leave:       (id: string) => post<any>(`/api/live/${encodeURIComponent(id)}/cohost/leave`, {}),
    },
    // ── END live moderation + co-host ──
    /** AI — brand memory, proactive suggestions */
    ai: {
      brandMemoryRebuild: () => postExpensive<{ fields: Record<string, string> }>('/api/ai/brand-memory/rebuild', {}),
      suggestions:        () => get<{ suggestions: any[] }>('/api/ai/suggestions'),
      nextActions:        () => get<{ suggestions: any[] }>('/api/ai/suggestions'),
      /** One-off assistant call — e.g. "rewrite this copy". */
      chat: (body: { messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>; maxTokens?: number }) =>
        postExpensive<{ content: string; actionCard?: Record<string, unknown>; tokensUsed?: number }>('/api/ai/chat', body),
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
      /** Native store purchase (RevenueCat consumable): server re-reads it and grants the boost. */
      iapVerify: (id: string, transactionId: string) =>
        post<{ status: string }>(`/api/iap-promotions/boost/${encodeURIComponent(id)}/verify`, { transactionId }),
      update: (id: string, body: { status: 'paused' | 'cancelled' }) =>
        patch<any>(`/api/boosts/${encodeURIComponent(id)}`, body),
      summary: () =>
        get<{ totalImpressions: number; spentCentsThisMonth: number; activeCount: number }>('/api/boosts/summary'),
    },
    /** Featured brand slots on Discover (seller purchase flow; /active is public). */
    featuredSlots: {
      active: () => get<{ label: 'Featured'; brands: FeaturedBrand[] }>('/api/featured-slots/active'),
      availability: () => freshGet<FeaturedAvailability>('/api/featured-slots/availability'),
      mine: () => freshGet<FeaturedSlot[]>('/api/featured-slots/mine'),
      reserve: (durationDays: number) => post<FeaturedSlot>('/api/featured-slots', { durationDays }),
      pay: (id: string, returnUrl: string) =>
        post<{ sessionId: string; url: string | null; paymentStatus: string; status: string }>(
          `/api/featured-slots/${encodeURIComponent(id)}/pay`, { returnUrl }),
      verify: (id: string) => post<FeaturedSlot>(`/api/featured-slots/${encodeURIComponent(id)}/pay/verify`, {}),
      cancel: (id: string) => post<FeaturedSlot>(`/api/featured-slots/${encodeURIComponent(id)}/cancel`, {}),
    },
    /** Sponsored placement in For You: slots to splice in + impression confirmation. */
    promotions: {
      sponsored: (p: { sessionId: string; organicOffset: number; organicCount: number }) =>
        freshGet<{ slots: Array<{ afterIndex: number; boostId: string; label: 'Sponsored'; post: any }> }>(
          `/api/promotions/sponsored?sessionId=${encodeURIComponent(p.sessionId)}&organicOffset=${p.organicOffset}&organicCount=${p.organicCount}`),
      impression: (boostId: string, sessionId: string) =>
        post<{ counted: boolean }>('/api/promotions/sponsored/impression', { boostId, sessionId }),
    },
    /** Admin approval queue for boosts + featured slots (users.role = 'admin'). */
    adminPromotions: {
      queue: (params: { status?: 'in_review' | 'approved' | 'rejected' | 'all'; kind?: 'all' | 'boost' | 'featured_slot' } = {}) => {
        const q = new URLSearchParams();
        if (params.status) q.set('status', params.status);
        if (params.kind) q.set('kind', params.kind);
        const suffix = q.toString();
        return freshGet<AdminPromotionQueue>(`/api/admin/promotions${suffix ? `?${suffix}` : ''}`);
      },
      approve: (kind: 'boost' | 'featured_slot', id: string) =>
        post<{ state: string }>(`/api/admin/promotions/${kind === 'boost' ? 'boosts' : 'featured'}/${encodeURIComponent(id)}/approve`, {}),
      reject: (kind: 'boost' | 'featured_slot', id: string, reason: string) =>
        post<{ state: string; refundStatus: string }>(`/api/admin/promotions/${kind === 'boost' ? 'boosts' : 'featured'}/${encodeURIComponent(id)}/reject`, { reason }),
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
      /** Native store purchase (RevenueCat consumable): server re-reads it and grants the campaign. */
      iapVerify: (id: string, transactionId: string) =>
        post<{ status: string }>(`/api/iap-promotions/campaign/${encodeURIComponent(id)}/verify`, { transactionId }),
    },
    /**
     * Meta (Facebook & Instagram) Ads — OAuth connection, campaign builder,
     * and lifecycle. Meta bills the seller's ad account directly; Brandthread
     * never touches ad spend here (unlike adCampaigns' Stripe-funded boosts).
     */
    metaAds: {
      /** Current connection state — call before showing any Meta Ads screen. */
      connection: () =>
        get<MetaAdsConnection>('/api/meta-ads/connection'),
      /** Returns the Meta OAuth URL to open with WebBrowser.openAuthSessionAsync. */
      oauthStart: () =>
        get<{ authUrl: string }>('/api/meta-ads/oauth/start'),
      /** Meta Business Manager businesses available to the connected user. */
      businesses: () =>
        get<{ businesses: MetaBusiness[] }>('/api/meta-ads/businesses'),
      /** Ad accounts under a given business. */
      adAccounts: (businessId: string) =>
        get<{ adAccounts: MetaAdAccount[] }>(`/api/meta-ads/businesses/${encodeURIComponent(businessId)}/ad-accounts`),
      /** Facebook Pages (with linked Instagram account, when present) under a business. */
      pages: (businessId: string) =>
        get<{ pages: MetaPage[] }>(`/api/meta-ads/businesses/${encodeURIComponent(businessId)}/pages`),
      /** Finalize the connection by selecting business / ad account / page. */
      selectConnection: (body: {
        businessId: string; businessName: string;
        adAccountId: string; adAccountName: string; adAccountCurrency: string;
        pageId: string; pageName: string;
        instagramActorId?: string; instagramUsername?: string;
      }) =>
        post<MetaAdsConnection>('/api/meta-ads/connection/select', body),
      /** Disconnect Meta entirely — the seller must re-run OAuth to reconnect. */
      disconnect: () =>
        del<{ ok: boolean }>('/api/meta-ads/connection'),
      /** Interest/audience search for targeting (e.g. type='adinterest'). */
      targetingSearch: (q: string, type: string = 'adinterest') =>
        get<{ results: MetaTargetingResult[] }>(`/api/meta-ads/targeting-search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}`),
      /** Create a campaign draft. Returns the draft plus an estimated reach range. */
      createCampaign: (body: MetaCampaignDraftInput) =>
        post<{ campaign: MetaCampaign; estimatedReach: { low: number; high: number } }>('/api/meta-ads/campaigns', body),
      /** Update the editable subset of a draft (or a rejected campaign being fixed). */
      updateCampaign: (id: string, body: Partial<MetaCampaignDraftInput>) =>
        patch<{ campaign: MetaCampaign }>(`/api/meta-ads/campaigns/${encodeURIComponent(id)}`, body),
      /** Rendered ad preview HTML (one per placement) for a WebView. */
      preview: (id: string) =>
        get<{ previews: { html: string }[] }>(`/api/meta-ads/campaigns/${encodeURIComponent(id)}/preview`),
      /** Submits the campaign to Meta. On failure the server returns a plain-English `error`. */
      launch: (id: string) =>
        post<{ status: 'in_review'; metaAdId: string }>(`/api/meta-ads/campaigns/${encodeURIComponent(id)}/launch`, {}),
      list: () =>
        get<{ campaigns: (MetaCampaign & { insights?: MetaCampaignInsights })[] }>('/api/meta-ads/campaigns'),
      get: (id: string) =>
        get<{ campaign: MetaCampaign; insights?: MetaCampaignInsights }>(`/api/meta-ads/campaigns/${encodeURIComponent(id)}`),
      refreshInsights: (id: string) =>
        post<{ insights: MetaCampaignInsights }>(`/api/meta-ads/campaigns/${encodeURIComponent(id)}/refresh-insights`, {}),
      pause: (id: string) =>
        post<{ campaign: MetaCampaign }>(`/api/meta-ads/campaigns/${encodeURIComponent(id)}/pause`, {}),
      resume: (id: string) =>
        post<{ campaign: MetaCampaign }>(`/api/meta-ads/campaigns/${encodeURIComponent(id)}/resume`, {}),
      duplicate: (id: string) =>
        post<{ campaign: MetaCampaign }>(`/api/meta-ads/campaigns/${encodeURIComponent(id)}/duplicate`, {}),
      /**
       * Fire-and-forget server-side Conversions API relay, paired with the
       * client-side pixel event using the same eventId for Meta's dedup.
       * Called via services/metaAdsService.ts / lib/marketingPixels.ts — not
       * meant to block any UI.
       */
      conversionEvent: (body: {
        eventId: string;
        eventName: 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'Purchase';
        occurredAt: string;
        productId?: string;
        valueCents?: number;
        currency?: string;
      }) =>
        post<{ ok: boolean }>('/api/meta-ads/conversion-events', body),
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
    /** Store gift cards: buy, send, wallet, and the store's own settings and list. */
    giftCards: {
      store: (sellerId: string) => get<GiftCardStoreInfo>(`/api/gift-cards/store/${encodeURIComponent(sellerId)}`),
      purchase: (body: {
        sellerId: string; amountCents: number; recipientEmail: string; recipientName?: string; message?: string;
        forSelf?: boolean; clientIdempotencyKey: string;
      }) => post<{ giftCardId: string; paymentIntentId: string; clientSecret: string | null; amountCents: number }>('/api/gift-cards/purchase', body),
      confirmPurchase: (giftCardId: string) =>
        post<{ status: 'paid' | 'processing' | 'unpaid'; card: GiftCard; code: string | null }>(
          `/api/gift-cards/purchase/${encodeURIComponent(giftCardId)}/confirm`, {}),
      claim: (code: string) => post<{ card: GiftCard; storeName: string }>('/api/gift-cards/claim', { code }),
      mine: () => freshGet<{ cards: GiftCard[]; totalCents: number }>('/api/gift-cards/mine'),
      get: (id: string) =>
        get<{ card: GiftCard; history: GiftCardHistoryEntry[] }>(`/api/gift-cards/mine/${encodeURIComponent(id)}`),
      seller: {
        settings: () => freshGet<GiftCardSettings>('/api/gift-cards/seller/settings'),
        saveSettings: (body: { enabled?: boolean; denominations?: number[]; allowCustom?: boolean; expiryMonths?: number | null }) =>
          put<GiftCardSettings>('/api/gift-cards/seller/settings', body),
        cards: () => freshGet<{ cards: GiftCard[]; outstandingCents: number }>('/api/gift-cards/seller/cards'),
        issue: (body: { amountCents: number; recipientEmail: string; recipientName?: string; message?: string }) =>
          post<{ card: GiftCard; code: string; emailed: boolean }>('/api/gift-cards/seller/issue', body),
        void: (id: string) => post<{ card: GiftCard }>(`/api/gift-cards/seller/cards/${encodeURIComponent(id)}/void`, {}),
      },
    },
    /** Thread Cash — platform-funded reward credit (daily check-in, streaks, wallet). */
    /** AI credits: balance, history and pack purchases (web checkout; native uses store billing). */
    aiCredits: {
      get: () => get<AiCreditsOverview>('/api/ai/credits'),
      history: (limit = 30, before?: string) =>
        get<AiCreditHistoryPage>(`/api/ai/credits/history?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`),
      checkout: (packId: string, returnUrl: string) =>
        post<{ sessionId: string; url: string | null }>(`/api/ai/credits/packs/${encodeURIComponent(packId)}/checkout`, { returnUrl }),
      verify: (sessionId: string) =>
        post<{ credited: boolean; newlyGranted: boolean; credits: number; balance: number }>('/api/ai/credits/purchases/verify', { sessionId }),
    },
    threadCash: {
      get: () =>
        get<ThreadCashStatus>('/api/thread-cash'),
      dailyHeartbeat: (body: { timezone: string; activeSeconds: number }) =>
        post<{ ok: boolean; heartbeatCount: number }>('/api/thread-cash/daily/heartbeat', body),
      dailyClaim: (body: { timezone: string; deviceId?: string; activeSeconds: number }) =>
        post<ThreadCashCheckInResult>('/api/thread-cash/daily/claim', body),
      history: (limit = 50) =>
        get<{ history: ThreadCashEntry[] }>(`/api/thread-cash/history?limit=${limit}`),
      ledger: (opts: { kind?: ThreadCashLedgerKind; offset?: number; limit?: number } = {}) =>
        get<ThreadCashLedger>(`/api/thread-cash/ledger?limit=${opts.limit ?? 50}&offset=${opts.offset ?? 0}${opts.kind ? `&kind=${opts.kind}` : ''}`),
      redeem: (body: { amountCents: number; idempotencyKey: string }) =>
        post<{ ok: boolean; discountCents: number; token: string }>('/api/thread-cash/redeem', body),
      /** Return an unused, unattached redemption's amount to the balance (idempotent). */
      cancelRedemption: (token: string) =>
        post<{ ok: boolean; returnedCents: number; balanceCents: number }>(`/api/thread-cash/redeem/${encodeURIComponent(token)}/cancel`, {}),
      send: (body: { recipientId: string; conversationId?: string; note?: string; amountCents: number; idempotencyKey: string }) =>
        post<{ ok: boolean; transferId: string }>('/api/thread-cash/send', body),
      claim: (body: { transferId: string }) =>
        post<{ ok: boolean; amountCents: number }>('/api/thread-cash/claim', body),
      cancel: (body: { transferId: string }) =>
        post<{ ok: boolean }>('/api/thread-cash/cancel', body),
      /**
       * Gift a live stream's host. Unlike `send`, this is never gated on
       * mutual follow and lands on the seller's balance instantly — no
       * pending/claim step, matching how a viewer actually relates to a
       * host they're watching.
       */
      liveGift: (body: { streamId: string; amountCents: number; idempotencyKey: string }) =>
        post<{ ok: boolean; giftId: string }>('/api/thread-cash/live-gift', body),
      /** Preview the payout (after any fee) for cashing out a Thread Cash amount, at the live rate. */
      cashOutQuote: (threadCashCents: number) =>
        get<{ threadCashCents: number; payoutCents: number; feeCents: number }>(`/api/thread-cash/quote?threadCashCents=${threadCashCents}`),
      /** Seller-only: converts earned Thread Cash into a real Stripe transfer to the payout balance. */
      cashOut: (body: { threadCashCents: number; idempotencyKey: string }) =>
        post<{ ok: boolean; threadCashCents: number; payoutCents: number; feeCents: number; transferId: string }>('/api/thread-cash/cash-out', body),
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
    /**
     * For You ranking pipeline: batched behavioral-event ingestion + the
     * buyer's personalized ranked Thread feed. Auth required for both.
     */
    feed: {
      /** Batched, idempotent event ingestion (up to 50 events/request). Each
       *  event needs a stable client-generated `clientEventId` so a retried
       *  batch never double-counts a signal. */
      events: (events: Array<{
        postId: string;
        type: 'view' | 'watch_time' | 'rewatch' | 'shop_click' | 'add_to_bag' | 'skip' | 'not_interested';
        value?: string;
        clientEventId: string;
      }>) => post<{ accepted: number; deduped: number }>('/api/feed/events', { events }),
      /** Cursor-paginated (`nextOffset`) personalized ranking. */
      forYou: (opts: { limit?: number; offset?: number } = {}) => {
        const params = new URLSearchParams();
        params.set('limit', String(opts.limit ?? 20));
        params.set('offset', String(opts.offset ?? 0));
        return get<{ items: any[]; nextOffset: number | null }>(`/api/feed/for-you?${params.toString()}`);
      },
    },
    /**
     * Public "For You" ranked Discover feed — no auth required (an Authorization
     * header is sent when available but the server does not require it).
     * Contract (matched exactly against the backend ranking endpoint):
     *   GET /api/public/discover/feed?limit=&offset=
     *   -> { items: DiscoverFeedItem[]; computedAt: string; source: 'cache'|'computed'|'empty'; nextOffset: number | null }
     */
    discover: {
      feed: (opts: { limit?: number; offset?: number } = {}) => {
        const params = new URLSearchParams();
        params.set('limit', String(opts.limit ?? 20));
        params.set('offset', String(opts.offset ?? 0));
        return get<{
          items: Array<{
            rank: number;
            productId: string;
            brandId: string;
            brandName: string;
            brandVerified: boolean;
            productName: string;
            priceCents: number;
            compareAtPriceCents: number | null;
            images: string[];
            category: string;
            sellerScore: number;
          }>;
          computedAt: string;
          source: 'cache' | 'computed' | 'empty';
          nextOffset: number | null;
        }>(`/api/public/discover/feed?${params.toString()}`);
      },
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
    /** Age gate: the DOB is sent once, reduced to a band server-side, and never stored. */
    ageGate: {
      submit: (dateOfBirth: string) => post<{ ageBand: 'under_13' | '13_17' | '18_plus' }>('/api/auth/age', { dateOfBirth }),
    },
    /** Account security — emailed "Download my data" jobs. */
    dataExportJobs: {
      list: () => freshGet<DataExportJobsResponse>('/api/auth/data-export/jobs'),
      create: (include: string[]) =>
        post<{ job: DataExportJob }>('/api/auth/data-export/jobs', { include }),
      link: (id: string) =>
        post<{ url: string; expiresAt: string }>(`/api/auth/data-export/jobs/${encodeURIComponent(id)}/link`, {}),
    },
    /** Report + block helpers shared by ReportSheet and the privacy screens. */
    trust: {
      /** Whether I blocked this person / they blocked me. */
      blockStatus: (userId: string) =>
        freshGet<{ blockedByMe: boolean; blockedMe: boolean }>(`/api/social/block-status/${encodeURIComponent(userId)}`),
    },
  };
}

export interface BuyerMeasurementsDto { heightCm?: number; weightKg?: number; chestCm?: number; waistCm?: number; hipsCm?: number }
export interface BuyerSizesDto {
  tops?: string; bottoms?: string; outerwear?: string; shoes?: string;
  measurements?: BuyerMeasurementsDto;
}
export interface BuyerPreferences {
  sizes: BuyerSizesDto;
  likedBrandIds: string[];
  styleInterests: string[];
  surveyCompletedAt: string | null;
  updatedAt: string | null;
}
/** Partial update: omitted = unchanged, null = clear, arrays replace, surveyCompleted stamps/clears surveyCompletedAt. */
export interface BuyerPreferencesPatch {
  sizes?: {
    tops?: string | null; bottoms?: string | null; outerwear?: string | null; shoes?: string | null;
    measurements?: { [K in keyof BuyerMeasurementsDto]?: number | null };
  };
  likedBrandIds?: string[];
  styleInterests?: string[];
  surveyCompleted?: boolean;
}

export type DataExportJob = {
  id: string;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'expired';
  categories: string[];
  requestedAt: string;
  readyAt: string | null;
  expiresAt: string | null;
  emailed: boolean;
  downloadable: boolean;
};
export type DataExportJobsResponse = { jobs: DataExportJob[]; nextRequestAt: string | null; emailEnabled: boolean };
export interface RecommendedBrand {
  id: string; sellerId: string; name: string; brandType: string | null;
  logoUrl: string | null; verified: boolean; followerCount: number; reason: string;
}
export interface ContactMatch {
  userId: string; name: string; username: string | null; avatarUrl: string | null;
  initials: string; color: string; handle: string; isFollowing: boolean;
}

export type BrandthreadApi = ReturnType<typeof createApi>;

// ─── React hook ──────────────────────────────────────────────────────────────
/**
 * useApi() — hook for React components.
 * Returns a fully-authed BrandthreadApi instance tied to the current Clerk session.
 * Memoised per user. Clerk may return a new getToken function between renders,
 * so the client reads it through a ref instead of rebuilding on function identity.
 */
export interface HashtagTrendingTag { tag: string; rank: number; postCount: number; recentPostCount: number; score: number }
export interface HashtagPostItem {
  id: string; mediaType: string; mediaUrl: string; mediaUrls: string[]; thumbnailUrl: string | null;
  aspectRatio: string; caption: string | null; hashtags: string[]; createdAt: string;
  likesCount: number | null; commentsCount: number;
  author: { userId: string; name: string; handle: string; avatarUrl: string | null; accountType: string | null };
}
export interface HashtagPostsPage { items: HashtagPostItem[]; nextCursor: string | null }
export interface HashtagPage {
  tag: string; postCount: number; followerCount: number; isFollowing: boolean;
  sort: 'top' | 'recent'; posts: HashtagPostsPage;
}
export interface PlaceInfo {
  id: string; name: string; city: string | null; region: string | null; country: string | null;
  lat: number | null; lng: number | null;
}
export interface PlaceSearchResult {
  /** Absent for provider suggestions that have not been saved yet; call api.places.save with providerPlaceId. */
  id?: string; name: string; source: 'local' | 'google'; postCount: number;
  city?: string | null; region?: string | null; country?: string | null; lat?: number | null; lng?: number | null;
  providerPlaceId?: string; secondary?: string | null;
}
export interface PlacePostsPage {
  items: Array<{
    id: string; mediaType: string; mediaUrl: string; mediaUrls: string[]; thumbnailUrl: string | null;
    aspectRatio: string; caption: string | null; hashtags: string[]; createdAt: string;
    likesCount: number | null; commentsCount: number;
    author: { userId: string; name: string; handle: string; avatarUrl: string | null; accountType: string | null };
  }>;
  nextCursor: string | null;
}
export interface PlacePage { place: PlaceInfo; postCount: number; sort: 'top' | 'recent'; posts: PlacePostsPage }

// ─── Promotions (featured slots + admin approval) ─────────────────────────────
export type FeaturedBrand = { slotId: string; sellerId: string; name: string; imageUrl: string | null; verified: boolean };
export type FeaturedSlot = {
  id: string; placement: string; durationDays: number; priceCents: number;
  startsAt: string; endsAt: string; status: string;
  displayState: 'awaiting_payment' | 'in_review' | 'scheduled' | 'live' | 'rejected' | 'ended' | 'cancelled';
  paid: boolean; rejectionReason: string | null; refundStatus: string; createdAt: string;
};
export type FeaturedAvailability = {
  placement: string; capacity: number;
  options: Array<{ durationDays: number; priceCents: number; startsAt: string; endsAt: string; availableNow: boolean }>;
  openSlot: FeaturedSlot | null;
};
export type AdminPromotionItem = {
  kind: 'boost' | 'featured_slot'; id: string;
  seller: { userId: string; name: string; avatarUrl: string | null } | null;
  state: 'in_review' | 'approved' | 'rejected';
  amountCents: number; durationDays: number;
  submittedAt: string | null; reviewedAt: string | null; rejectionReason: string | null; refundStatus: string;
  post: { id: string; caption: string | null; mediaUrl: string | null; thumbnailUrl: string | null; mediaType: string | null } | null;
  window: { startsAt: string; endsAt: string } | null;
};
export type AdminPromotionQueue = { items: AdminPromotionItem[]; summary: { pendingBoosts: number; pendingFeatured: number } };

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
