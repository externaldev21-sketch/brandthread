/**
 * Brandthread API client.
 * Base URL is resolved from EXPO_PUBLIC_API_BASE_URL (set in the dev script).
 * Every request attaches the Clerk Bearer token supplied by getToken().
 */
import { useAuth } from '@clerk/expo';
import { useMemo } from 'react';

const BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type GetToken = () => Promise<string | null>;

// ─── Store context switcher ───────────────────────────────────────────────────
// When a team member wants to act on their own store instead of the joined store,
// the client sends X-Store-Context: own. The backend teamContext() middleware
// skips the clerkUserId rewrite, so all queries run against the user's own data.
// 'joined' (or null) restores the default behaviour (backend decides based on
// active team membership).
export type StoreContext = 'own' | 'joined';
let _storeContext: StoreContext | null = null;

/** Set the active store context. Call this from the switcher UI and persist
 *  the value to AsyncStorage for the next app launch. */
export function setStoreContext(ctx: StoreContext | null): void {
  _storeContext = ctx;
}

/** Read the current store context. */
export function getStoreContext(): StoreContext | null {
  return _storeContext;
}

async function request<T = any>(
  path: string,
  options: RequestInit,
  getToken: GetToken,
  asText = false,
): Promise<T> {
  const token = await getToken();
  // Build a plain Record so TypeScript is happy with every HeadersInit variant.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(_storeContext === 'own' ? { 'X-Store-Context': 'own' } : {}),
    // Normalize any HeadersInit shape (Headers instance, string[][], or plain object).
    ...(options.headers
      ? options.headers instanceof Headers
        ? Object.fromEntries((options.headers as Headers).entries())
        : Array.isArray(options.headers)
          ? Object.fromEntries(options.headers as string[][])
          : (options.headers as Record<string, string>)
      : {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  if (asText) return res.text() as Promise<T>;
  return res.json() as Promise<T>;
}

// ─── Freelancer marketplace types ────────────────────────────────────────────
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

export function createApi(getToken: GetToken) {
  const get     = <T>(path: string) => request<T>(path, { method: 'GET' }, getToken);
  const getText  = (path: string)   => request<string>(path, { method: 'GET' }, getToken, true);
  const post  = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST',  body: JSON.stringify(body) }, getToken);
  const put   = <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT',   body: JSON.stringify(body) }, getToken);
  const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }, getToken);
  const del   = <T>(path: string) => request<T>(path, { method: 'DELETE' }, getToken);

  return {
    auth: {
      sync:        ()             => post('/api/auth/sync', {}),
      me:          ()             => get('/api/auth/me'),
      onboarding:  (body: unknown) => patch('/api/auth/onboarding', body),
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
        bio?:         string;
        website?:     string;
        name?:        string;
        username?:    string;
      }) => patch<any>('/api/auth/profile', body),
    },
    products: {
      list:           ()                       => get('/api/products'),
      get:            (id: string)             => get(`/api/products/${id}`),
      create:         (body: unknown)          => post('/api/products', body),
      update:         (id: string, body: unknown) => put(`/api/products/${id}`, body),
      archive:        (id: string)             => del(`/api/products/${id}`),
      addVariant:     (id: string, body: unknown) => post(`/api/products/${id}/variants`, body),
      updateVariant:  (id: string, vId: string, body: unknown) => patch(`/api/products/${id}/variants/${vId}`, body),
      /** Bulk-import products from a rows array. Returns { successCount, failCount, errors }. */
      import: (rows: Array<{ name: string; description?: string; category?: string; price?: string }>) =>
        post<{ successCount: number; failCount: number; errors?: string[] }>('/api/products/import', { rows }),
    },
    orders: {
      list:           ()                       => get('/api/orders'),
      get:            (id: string)             => get(`/api/orders/${id}`),
      create:         (body: unknown)          => post('/api/orders', body),
      updateStatus:   (id: string, status: string, opts?: { reason?: string; notes?: string }) =>
        patch(`/api/orders/${id}/status`, { status, ...opts }),
      addTracking:    (id: string, body: unknown)  => patch(`/api/orders/${id}/tracking`, body),
    },
    customers: {
      list:    (search?: string) => get(`/api/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
      get:     (id: string)      => get(`/api/customers/${id}`),
      create:  (body: unknown)   => post('/api/customers', body),
      update:  (id: string, body: unknown) => put(`/api/customers/${id}`, body),
      /** Overwrite customer tags array */
      addTag:  (id: string, tags: string[]) => put<any>(`/api/customers/${id}`, { tags }),
      /** Full order history for one customer */
      orders:  (id: string) => get<any[]>(`/api/customers/${id}/orders`),
    },
    drops: {
      list:    ()                       => get('/api/drops'),
      get:     (id: string)             => get(`/api/drops/${id}`),
      create:  (body: unknown)          => post('/api/drops', body),
      update:  (id: string, body: unknown) => patch(`/api/drops/${id}`, body),
    },
    analytics: {
      dashboard:  () => get('/api/analytics/dashboard'),
      revenue:    (period: string) => get(`/api/analytics/revenue?period=${period}`),
      products:   () => get<any[]>('/api/analytics/products'),
      /** Top customers by spend + repeat-buyer stats — derived from real orders */
      customers:  (limit = 10) => get<{
        topCustomers: Array<{
          buyerId: string; name: string; email: string;
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
      threads: {
        list:   () => get<any[]>('/api/manufacturers/threads'),
        create: (body: { manufacturerId: string; subject?: string }) =>
          post<any>('/api/manufacturers/threads', body),
        messages: {
          list: (threadId: string) => get<any[]>(`/api/manufacturers/threads/${encodeURIComponent(threadId)}/messages`),
          send: (threadId: string, body: { content: string; messageType?: string; mediaUrls?: string[]; cardData?: any; senderRole?: string }) =>
            post<any>(`/api/manufacturers/threads/${encodeURIComponent(threadId)}/messages`, body),
        },
      },
      connect: {
        onboard: (body?: { refreshUrl?: string; returnUrl?: string }) =>
          post<any>('/api/manufacturers/connect/onboard', body ?? {}),
        status: () => get<any>('/api/manufacturers/connect/status'),
      },
      sampleOrders: {
        list:       () => get<any[]>('/api/sample-orders'),
        create:     (body: any) => post<any>('/api/sample-orders', body),
        get:        (id: string) => get<any>(`/api/sample-orders/${encodeURIComponent(id)}`),
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
        update: (id: string, body: { status?: string; notes?: string }) =>
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
    logo: {
      generate: (brandName: string, style: string) => post<any>('/api/logo/generate', { brandName, style }),
    },
    mockup: {
      generate: (prompt: string) => post<any>('/api/mockup/generate', { prompt }),
    },
    photography: {
      generate: (images: string[], prompt: string) => post<any>('/api/photography/generate', { images, prompt }),
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
      checkout: {
        /** Create a Stripe Checkout Session. Returns { sessionId, url }. */
        createSession: (
          items: { variantId: string; productId: string; quantity: number }[],
          opts: {
            contactEmail?: string;
            shippingAddress?: {
              name?: string; street: string; city: string;
              state: string; zip: string; country?: string;
            };
            /** Per-seller idempotency key (format: {checkoutSessionId}_{sellerId}).
             *  The server uses this to detect and reuse an identical in-flight session
             *  (e.g. after a component remount) without creating a duplicate Stripe charge.
             *  A UNIQUE DB index makes this race-condition-safe server-side. */
            clientIdempotencyKey?: string;
          } = {},
        ) =>
          post<{ sessionId: string; url: string }>('/api/buyer/checkout/session', {
            items,
            successUrl: 'mobile://checkout/return?session_id={CHECKOUT_SESSION_ID}',
            cancelUrl:  'mobile://checkout/cancel',
            ...(opts.contactEmail          ? { contactEmail:          opts.contactEmail          } : {}),
            ...(opts.shippingAddress       ? { shippingAddress:       opts.shippingAddress       } : {}),
            ...(opts.clientIdempotencyKey  ? { clientIdempotencyKey:  opts.clientIdempotencyKey  } : {}),
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
        get<{ ready: boolean; reason?: string }>(
          `/api/buyer/seller-payment-status/${encodeURIComponent(sellerId)}`
        ),
    },
    /** DM conversations between buyers and sellers. */
    conversations: {
      list:    () => get<any[]>('/api/conversations'),
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
      mine:  () => get<any[]>('/api/reviews/mine'),
      /** Seller — post a public reply to a received review. */
      reply: (reviewId: string, replyText: string) =>
        post<any>(`/api/reviews/${encodeURIComponent(reviewId)}/reply`, { replyText }),
      /** Buyer Payment Methods — Stripe-backed saved cards */
      paymentMethods:      () => get<{ paymentMethods: any[] }>('/api/buyer/payment-methods'),
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
          verified:    boolean;
          returnPolicy:       string | null;
          cancellationPolicy: string | null;
          subscriptionStatus: string | null;
          subscriptionPlanId: string | null;
        }>('/api/seller/profile'),
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
          status: string;
        }>('/api/seller/connect/status'),
      },
      /** Update the current user's public profile. username must be letters/numbers/underscores, 3-30 chars. */
      updateProfile: (body: { displayName?: string; bio?: string; website?: string; name?: string; username?: string }) =>
        patch<any>('/api/auth/profile', body),
      /** Platform subscription — billed to the seller's own payment method (sellers only).
       *  Completely separate from Stripe Connect (buyer payouts). */
      subscription: {
        /** Returns the seller's current plan, subscription status, renewal date,
         *  and payment-method label. */
        status: () => get<{
          plan: string;               // 'starter' | 'growth' | 'scale'
          status: string;             // 'active' | 'trialing' | 'past_due' | 'canceled' | 'none'
          trialEnd: string | null;    // formatted date when in trial, null otherwise
          renewsOn: string | null;    // e.g. "Aug 14, 2026"
          amountCents: number;        // monthly charge in cents (0 for starter)
          paymentMethodLabel: string | null; // e.g. "Visa ···4242"
        }>('/api/seller/subscription/status'),
        /** Create a Stripe Checkout Session in subscription mode.
         *  Returns { url } for the mobile client to open in the system browser. */
        checkout: (planId: 'starter' | 'growth' | 'scale') =>
          post<{ url: string }>('/api/seller/subscription/checkout', { planId }),
        /** Create a Stripe Billing Portal session so the seller can manage their
         *  payment method, view invoices, or cancel. Returns { url }. */
        portal: () =>
          post<{ url: string }>('/api/seller/subscription/portal', {}),
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
          get<{ digest: 'realtime' | 'daily' }>('/api/seller/notification-prefs'),
        update: (body: { digest: 'realtime' | 'daily' }) =>
          put<{ digest: 'realtime' | 'daily' }>('/api/seller/notification-prefs', body),
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
        mediaUrl?: string; mediaType?: string; caption?: string;
        styleTags?: string[]; taggedProductIds?: string[];
      }) => post<any>('/api/posts', body),
      get: (id: string) => get<any>(`/api/posts/${encodeURIComponent(id)}`),
      interact: (id: string, body: { type: 'like' | 'repost' | 'watch_time' | 'shop_click'; value?: string }) =>
        post<{ action: string; count?: number }>(`/api/posts/${encodeURIComponent(id)}/interact`, body),
    },
    /** Content reporting (buyers and sellers can submit reports) */
    reports: {
      submit: (body: {
        targetType: string; targetId: string; targetLabel?: string;
        reason: string; description?: string;
      }) => post<any>('/api/reports', body),
      /** Admin/moderation list — optionally filtered by status */
      list: (status?: string) =>
        get<any[]>(`/api/reports${status ? `?status=${encodeURIComponent(status)}` : ''}`),
      /** Update a report's review status (reviewed | actioned | dismissed | pending) */
      updateStatus: (id: string, status: string) =>
        patch<any>(`/api/reports/${encodeURIComponent(id)}/status`, { status }),
    },
    /** Buyer-to-buyer social graph: follows, profiles, search */
    social: {
      /** Follow another buyer */
      follow: (userId: string) =>
        post<{ ok: boolean }>('/api/social/follow', { userId }),
      /** Unfollow a buyer */
      unfollow: (userId: string) =>
        del<{ ok: boolean }>(`/api/social/follow/${encodeURIComponent(userId)}`),
      /** Check follow status between me and another user */
      status: (userId: string) =>
        get<{ isFollowing: boolean; isFollowedBy: boolean; isMutual: boolean }>(
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
      /** List buyers I follow */
      following: () =>
        get<Array<{
          userId: string; name: string; username: string | null; handle: string;
          initials: string; color: string; followedAt: string;
        }>>('/api/social/following'),
      /** List buyers who follow me (with isFollowingBack flag) */
      followers: () =>
        get<Array<{
          userId: string; name: string; username: string | null; handle: string;
          initials: string; color: string; followedAt: string; isFollowingBack: boolean;
        }>>('/api/social/followers'),
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
      /** List users I have blocked */
      blocks: () =>
        get<Array<{
          userId: string; name: string; handle: string;
          initials: string; color: string; blockedAt: string;
        }>>('/api/social/blocks'),
    },
    /** Referral / invite-code system */
    referrals: {
      /** Get (or lazily generate) my invite code + shareable link */
      code: () =>
        get<{ code: string; link: string; shareText: string }>('/api/referrals/code'),
      /** How many people signed up using my code */
      stats: () =>
        get<{ total: number; referrals: Array<{ inviteeId: string; name: string | null; joinedAt: string }> }>(
          '/api/referrals/stats'
        ),
      /** Attribute a referral to the current user — call once after signup with the code they entered */
      apply: (code: string) =>
        post<{ ok: boolean; inviterId: string }>('/api/referrals/apply', { code }),
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
    },
    /** Buyer-facing drops listing (active, with countdown releaseAt) */
    publicDrops: {
      list: () => get<any[]>('/api/public/drops'),
      get:  (id: string) => get<any>(`/api/public/drops/${encodeURIComponent(id)}`),
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
      create: (data: { orderId: string; reason: string; notes?: string; resolutionRequested?: string }) =>
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
      /** Returns the caller's active membership in another seller's store (null if none).
       *  Used by the store switcher: if non-null the user can toggle between their own
       *  store and the store they joined. */
      myMembership: () =>
        get<{
          membership: {
            id: string;
            ownerId: string;
            role: string;
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
      balance:      () => get<any>('/api/finance/balance'),
      payouts:      (limit?: number) => get<any>(`/api/finance/payouts${limit ? `?limit=${limit}` : ''}`),
      transactions: (limit?: number, type?: string) => {
        const q = new URLSearchParams();
        if (limit) q.set('limit', String(limit));
        if (type)  q.set('type', type);
        return get<any>(`/api/finance/transactions${q.toString() ? `?${q}` : ''}`);
      },
      statementCsvUrl: () => '/api/finance/statement.csv',
      payout: (data?: { amount?: number; currency?: string }) =>
        post<any>('/api/finance/payout', data ?? {}),
    },
    /** Taxes & Duties — Stripe Tax integration */
    taxes: {
      status:    () => get<any>('/api/taxes/status'),
      enable:    () => post<any>('/api/taxes/enable', {}),
      config:    (data: { collectDuties?: boolean; chargeShippingTax?: boolean; chargeVat?: boolean }) =>
        patch<any>('/api/taxes/config', data),
      forms1099: () => get<any>('/api/taxes/1099'),
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
    },
    /** Security — login sessions */
    security: {
      sessions: () => get<{ sessions: any[] }>('/api/ai/sessions'),
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
      list:   (targetId?: string) =>
        get<any[]>(`/api/boosts${targetId ? `?targetId=${encodeURIComponent(targetId)}` : ''}`),
      create: (body: { targetType: string; targetId: string; budgetCents: number; durationDays: number }) =>
        post<any>('/api/boosts', body),
      update: (id: string, body: { status: 'paused' | 'cancelled' }) =>
        patch<any>(`/api/boosts/${encodeURIComponent(id)}`, body),
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
    /** Drop broadcast — send push to all followers when a drop goes live. */
    drops: {
      broadcast: (dropId: string) =>
        post<{ ok: boolean; sent: number; errors: number; followers: number }>(
          `/api/drops/${encodeURIComponent(dropId)}/broadcast`, {}
        ),
    },
  };
}

export type BrandthreadApi = ReturnType<typeof createApi>;

// ─── React hook ──────────────────────────────────────────────────────────────
/**
 * useApi() — hook for React components.
 * Returns a fully-authed BrandthreadApi instance tied to the current Clerk session.
 * Memoised — identity is stable as long as getToken doesn't change.
 */
export function useApi(): BrandthreadApi {
  const { getToken } = useAuth();
  return useMemo(() => createApi(async () => getToken()), [getToken]);
}

// ─── Module-level singleton ───────────────────────────────────────────────────
/**
 * Module-level `api` singleton.
 * Hydrate once at app boot via configureApi(getToken) — e.g. inside the
 * ServiceConfigurer component in _layout.tsx.  Falls back to unauthenticated
 * for public endpoints if never configured.
 */
let _globalGetter: GetToken = async () => null;
export function configureApi(getter: GetToken): void { _globalGetter = getter; }
export const api = createApi(() => _globalGetter());
