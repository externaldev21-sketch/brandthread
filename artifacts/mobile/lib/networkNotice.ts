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
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`API ${status}: ${body}`);
    this.name = 'ApiError';
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
    return error.status >= 500 || error.status === 408 || error.status === 429
      ? 'server'
      : null;
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  const match = message.match(/\bAPI (\d{3})\b/);
  if (match) {
    const status = Number(match[1]);
    return status >= 500 || status === 408 || status === 429 ? 'server' : null;
  }
  if (
    error instanceof TypeError ||
    /network request failed|failed to fetch|network error|internet connection|offline/i.test(message)
  ) {
    return 'offline';
  }
  return null;
}

export function reportNetworkError(
  error: unknown,
  retry?: () => void | Promise<unknown>,
): void {
  const kind = classifyNetworkError(error);
  if (!kind) return;
  notice = {
    id: nextId++,
    kind,
    title: kind === 'offline' ? "You're offline" : 'Server unavailable',
    message: kind === 'offline'
      ? 'Check your connection and try again.'
      : 'Brandthread could not load this right now.',
    retry,
    retrying: false,
  };
  emit();
}

export async function retryNetworkNotice(): Promise<void> {
  const current = notice;
  if (!current?.retry || current.retrying) return;
  notice = { ...current, retrying: true };
  emit();
  try {
    await current.retry();
    if (notice?.id === current.id) notice = null;
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