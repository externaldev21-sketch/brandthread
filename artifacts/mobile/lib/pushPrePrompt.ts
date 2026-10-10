/**
 * The short "why" sheet shown right before the system notification dialog
 * (pattern: Givingli's contextual nudge, https://mobbin.com/screens/502f2a58-a768-4285-8fdb-8a94a165103f).
 * The OS dialog can only be shown once, so we explain first and only ask the
 * OS when the person taps "Turn on notifications".
 *
 * PushPrePromptHost (mounted once in app/_layout.tsx) registers the presenter.
 * Without a host (tests, headless), the flow goes straight to the OS dialog,
 * which is the behavior before this sheet existed.
 */
export type PushPrePromptReason = 'follow' | 'order' | 'message' | 'general';

export interface PushPrePromptCopy { title: string; body: string }

export function prePromptCopy(reason: PushPrePromptReason): PushPrePromptCopy {
  switch (reason) {
    case 'follow':
      return { title: 'Know when they drop', body: 'Get a notification when brands you follow post a new drop or go live.' };
    case 'order':
      return { title: 'Know when it ships', body: 'Get a notification when your order ships, and when it arrives.' };
    case 'message':
      return { title: 'Know when they reply', body: 'Get a notification when someone replies to your messages.' };
    default:
      return { title: 'Turn on notifications', body: 'Get a notification for drops from brands you follow, order updates and messages.' };
  }
}

type Presenter = (reason: PushPrePromptReason) => Promise<boolean>;
let presenter: Presenter | null = null;

export function registerPushPrePrompt(fn: Presenter): () => void {
  presenter = fn;
  return () => { if (presenter === fn) presenter = null; };
}

/** Resolves true when the person chose to turn notifications on. */
export function showPushPrePrompt(reason: PushPrePromptReason): Promise<boolean> {
  return presenter ? presenter(reason) : Promise.resolve(true);
}

// ─── "Not now" pacing ────────────────────────────────────────────────────────

export const PRE_PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const PRE_PROMPT_MAX_DECLINES = 3;

export interface PrePromptDeclines { count: number; lastAt: number | null }

/** After "Not now", wait a week and ask at most three times in total. */
export function prePromptAllowed(state: PrePromptDeclines, now: number): boolean {
  if (state.count >= PRE_PROMPT_MAX_DECLINES) return false;
  if (state.lastAt !== null && now - state.lastAt < PRE_PROMPT_COOLDOWN_MS) return false;
  return true;
}

export function parseDeclines(raw: string | null): PrePromptDeclines {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (v && typeof v.count === 'number') return { count: v.count, lastAt: typeof v.lastAt === 'number' ? v.lastAt : null };
  } catch { /* fall through */ }
  return { count: 0, lastAt: null };
}
