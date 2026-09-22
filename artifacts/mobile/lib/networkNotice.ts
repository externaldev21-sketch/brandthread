export type NetworkNoticeKind = 'offline' | 'server';

export type NetworkNotice = {
  id: number;
  kind: NetworkNoticeKind;
  title: string;
  message: string;
  retry?: () => void | Promise<unknown>;
  retrying: boolean;
};

type Listener = () => void;

let notice: NetworkNotice | null = null;
let nextId = 1;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();
const NOTICE_TTL_MS = 10_000;

function emit() {
  listeners.forEach((listener) => listener());
}

export class ApiError extends Error {
  public readonly code?: string;
  public readonly details?: Record<string, unknown>;
  public readonly requestId?: string;

  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    let message = body;
    let code: string | undefined;
    let details: Record<string, unknown> | undefined;
    let requestId: string | undefined;
    try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed === 'object' && parsed !== null) {
        const value = parsed as Record<string, unknown>;
        requestId = typeof value.requestId === 'string' ? value.requestId : undefined;
        if (typeof value.error === 'object' && value.error !== null) {
          const error = value.error as Record<string, unknown>;
          message = typeof error.message === 'string' ? error.message : body;
          code = typeof error.code === 'string' ? error.code : undefined;
          details = typeof error.details === 'object' && error.details !== null
            ? error.details as Record<string, unknown>
            : undefined;
        } else {
          message = typeof value.message === 'string'
            ? value.message
            : typeof value.error === 'string'
              ? value.error
              : body;
          code = typeof value.code === 'string' ? value.code : undefined;
        }
      }
    } catch {
      // Non-JSON failures (proxies, gateways) remain readable.
    }
    super(`API ${status}: ${message}`);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export function getNetworkNotice(): NetworkNotice | null {
  return notice;
}

export function subscribeNetworkNotice(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dismissNetworkNotice(): void {
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  if (!notice) return;
  notice = null;
  emit();
}

export function isAuthError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 401 || error.status === 403;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /\bAPI (401|403)\b/.test(message);
}

export function classifyNetworkError(error: unknown): NetworkNoticeKind | null {
  if (isAuthError(error)) return null;
  if (error instanceof ApiError) {
    return error.status >= 500 || error.status === 408
      ? 'server'
      : null;
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  const match = message.match(/\bAPI (\d{3})\b/);
  if (match) {
    const status = Number(match[1]);
    return status >= 500 || status === 408 ? 'server' : null;
  }
  if (
    /network request failed|failed to fetch|network error|internet connection|offline/i.test(message)
  ) {
    return 'offline';
  }
  return null;
}

export function reportNetworkError(
  error: unknown,
  retry?: () => void | Promise<unknown>,
  usingCachedContent = false,
): void {
  const kind = classifyNetworkError(error);
  if (!kind) return;
  notice = {
    id: nextId++,
    kind,
    title: kind === 'offline' ? "You're offline" : 'Server unavailable',
    message: kind === 'offline'
      ? usingCachedContent
        ? 'Showing saved content until your connection returns.'
        : 'Check your connection and try again.'
      : 'Brandthread could not load this right now.',
    retry,
    retrying: false,
  };
  emit();
  if (expiryTimer) clearTimeout(expiryTimer);
  const reportedId = notice.id;
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    if (notice?.id !== reportedId) return;
    notice = null;
    emit();
  }, NOTICE_TTL_MS);
}

export async function retryNetworkNotice(): Promise<void> {
  const current = notice;
  if (!current?.retry || current.retrying) return;
  notice = { ...current, retrying: true };
  emit();
  try {
    await current.retry();
    if (notice?.id === current.id) dismissNetworkNotice();
  } catch (error) {
    if (notice?.id === current.id) {
      const kind = classifyNetworkError(error) ?? current.kind;
      notice = {
        ...current,
        kind,
        title: kind === 'offline' ? "You're offline" : 'Server unavailable',
        message: kind === 'offline'
          ? 'Check your connection and try again.'
          : 'Brandthread could not load this right now.',
        retrying: false,
      };
    }
  }
  emit();
}
