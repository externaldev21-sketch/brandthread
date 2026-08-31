import { Platform } from 'react-native';

export type MarketingPixelEvent =
  | 'PageView'
  | 'ViewContent'
  | 'AddToCart'
  | 'InitiateCheckout'
  | 'Purchase'
  | 'CompleteRegistration';

type PixelConfig = {
  metaPixelId?: string;
  tiktokPixelId?: string;
};

type MetaPixelQueue = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  loaded: boolean;
  version: string;
};

type TikTokQueue = unknown[] & {
  _i?: Record<string, unknown[]>;
  _t?: Record<string, number>;
  _o?: Record<string, unknown>;
  methods?: string[];
  setAndDefer?: (target: TikTokQueue, method: string) => void;
  load?: (id: string, options?: unknown) => void;
  page?: () => void;
  track?: (event: string, properties?: Record<string, unknown>) => void;
  [key: string]: unknown;
};

type PixelWindow = Window & {
  fbq?: MetaPixelQueue;
  _fbq?: PixelWindow['fbq'];
  ttq?: TikTokQueue;
};

const PLACEHOLDER_PATTERN = /(test|demo|fake|placeholder|your[_-]?pixel|change[_-]?me)/i;
const ALLOWED_EVENTS = new Set<MarketingPixelEvent>([
  'PageView',
  'ViewContent',
  'AddToCart',
  'InitiateCheckout',
  'Purchase',
  'CompleteRegistration',
]);

let consentGranted = false;
let initialized = false;

export function isConfiguredPixelId(value: string | undefined, provider: 'meta' | 'tiktok'): boolean {
  const id = value?.trim();
  if (!id || PLACEHOLDER_PATTERN.test(id)) return false;
  return provider === 'meta'
    ? /^\d{5,24}$/.test(id)
    : /^[A-Z0-9]{8,32}$/i.test(id);
}

export function configuredPixels(): PixelConfig {
  const metaPixelId = process.env.EXPO_PUBLIC_META_PIXEL_ID?.trim();
  const tiktokPixelId = process.env.EXPO_PUBLIC_TIKTOK_PIXEL_ID?.trim();
  return {
    metaPixelId: isConfiguredPixelId(metaPixelId, 'meta') ? metaPixelId : undefined,
    tiktokPixelId: isConfiguredPixelId(tiktokPixelId, 'tiktok') ? tiktokPixelId : undefined,
  };
}

function initializeMeta(win: PixelWindow, id: string): void {
  if (!win.fbq) {
    const fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue.push(args);
    } as MetaPixelQueue;
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = '2.0';
    win.fbq = fbq;
    win._fbq = fbq;
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);
  }
  win.fbq?.('init', id);
}

function initializeTikTok(win: PixelWindow, id: string): void {
  if (!win.ttq) {
    const ttq = [] as unknown as TikTokQueue;
    const methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'];
    ttq.methods = methods;
    ttq.setAndDefer = (target, method) => {
      target[method] = (...args: unknown[]) => {
        target.push([method, ...args]);
      };
    };
    methods.forEach((method) => ttq.setAndDefer?.(ttq, method));
    ttq.load = (pixelId, options) => {
      ttq._i = ttq._i ?? {};
      ttq._i[pixelId] = [];
      ttq._i[pixelId].push(options ?? {});
      ttq._t = ttq._t ?? {};
      ttq._t[pixelId] = Date.now();
      ttq._o = ttq._o ?? {};
      ttq._o[pixelId] = options ?? {};
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(pixelId)}&lib=ttq`;
      document.head.appendChild(script);
    };
    win.ttq = ttq;
  }
  win.ttq?.load?.(id);
}

export function setMarketingPixelConsent(granted: boolean, config = configuredPixels()): boolean {
  const win = Platform.OS === 'web' && typeof window !== 'undefined'
    ? window as PixelWindow
    : undefined;
  if (!granted && initialized) {
    win?.fbq?.('consent', 'revoke');
    const revokeConsent = win?.ttq?.revokeConsent;
    if (typeof revokeConsent === 'function') revokeConsent();
    const disableCookie = win?.ttq?.disableCookie;
    if (typeof disableCookie === 'function') disableCookie();
  }
  consentGranted = granted;
  if (!granted || Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') {
    return initialized;
  }
  if (initialized) {
    win?.fbq?.('consent', 'grant');
    const grantConsent = win?.ttq?.grantConsent;
    if (typeof grantConsent === 'function') grantConsent();
    const enableCookie = win?.ttq?.enableCookie;
    if (typeof enableCookie === 'function') enableCookie();
    return true;
  }
  if (!config.metaPixelId && !config.tiktokPixelId) return false;
  if (!win) return false;
  if (config.metaPixelId) initializeMeta(win, config.metaPixelId);
  if (config.tiktokPixelId) initializeTikTok(win, config.tiktokPixelId);
  initialized = true;
  win.fbq?.('consent', 'grant');
  const grantConsent = win.ttq?.grantConsent;
  if (typeof grantConsent === 'function') grantConsent();
  const enableCookie = win.ttq?.enableCookie;
  if (typeof enableCookie === 'function') enableCookie();
  return true;
}

export function trackMarketingPixelEvent(
  event: MarketingPixelEvent,
  properties: Record<string, unknown> = {},
  config = configuredPixels(),
): boolean {
  if (!consentGranted || !initialized || !ALLOWED_EVENTS.has(event) || Platform.OS !== 'web' || typeof window === 'undefined') {
    return false;
  }
  const win = window as PixelWindow;
  if (config.metaPixelId) win.fbq?.('track', event, properties);
  if (config.tiktokPixelId) {
    if (event === 'PageView') win.ttq?.page?.();
    else win.ttq?.track?.(event, properties);
  }
  return true;
}

/** Test-only reset for the module-level consent and initialization boundary. */
export function resetMarketingPixelsForTest(): void {
  consentGranted = false;
  initialized = false;
}