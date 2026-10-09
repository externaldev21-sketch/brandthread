/**
 * In-app replacement for the system `Alert.alert` popup.
 *
 * The app calls `Alert.alert` in ~1,000 places. Rather than rewrite every
 * call site (and conflict with every open PR touching those lines), this
 * module re-points `Alert.alert` at an in-app queue once at boot
 * (`installAppAlert`, called by `<AppAlertHost />`). Call sites keep the
 * exact same `(title, message, buttons, options)` signature and semantics:
 *
 *  - No buttons, or one plain "OK" button with no handler  -> toast
 *  - 1–2 choices -> Instagram-style centred dialog, 3+ -> Instagram options menu
 *
 * The decision is a pure function (`classifyAlert`) so it is unit-tested
 * without rendering. `nativeAlert` keeps a handle on the platform alert for
 * the rare caller that needs it, and is used as the fallback whenever the
 * host isn't mounted (e.g. an error boundary above the root layout).
 */
import { Alert, type AlertButton, type AlertOptions } from 'react-native';

export type AppAlertButton = {
  text: string;
  onPress?: () => void;
  style: 'default' | 'cancel' | 'destructive';
};

export type AppAlertRequest =
  /** `text` is the one-line form (screen readers, de-dupe); title/message are shown on two lines. */
  | { kind: 'toast'; id: number; text: string; title?: string; message?: string }
  | {
      kind: 'sheet';
      id: number;
      title?: string;
      message?: string;
      /**
       * Instagram iOS patterns: 'dialog' = centred card with stacked text
       * buttons (1–2 choices, e.g. "Log out of your account?"); 'menu' =
       * floating options card with a separate Cancel card (3+ choices, e.g.
       * the profile ⋯ menu). Cancel is always last in both.
       */
      layout: 'dialog' | 'menu';
      buttons: AppAlertButton[];
      /** Runs when the sheet is dismissed without a button (backdrop / Android back). Null = not dismissable. */
      onDismiss: (() => void) | null;
    };

/** Longer than this and an info message reads badly in a toast; it gets a sheet with OK instead. */
export const TOAST_MAX_CHARS = 140;

const OK_LABELS = new Set(['ok', 'okay', 'got it', 'done', 'close', 'dismiss']);

function clean(s: string | undefined | null): string | undefined {
  const t = typeof s === 'string' ? s.trim() : '';
  return t.length ? t : undefined;
}

/** Joins title + message into one toast line ("Saved. Your changes are live."). */
export function toastText(title?: string, message?: string): string {
  const t = clean(title);
  const m = clean(message);
  if (t && m) return /[.!?]$/.test(t) ? `${t} ${m}` : `${t}. ${m}`;
  return t ?? m ?? '';
}

let nextId = 1;

/**
 * Pure: turns an `Alert.alert` call into what the host should show.
 * Returns null when there is nothing to show (empty title, message and buttons).
 */
export function classifyAlert(
  title?: string | null,
  message?: string | null,
  buttons?: AlertButton[] | null,
  options?: AlertOptions | null,
): AppAlertRequest | null {
  const t = clean(title ?? undefined);
  const m = clean(message ?? undefined);
  const list: AppAlertButton[] = (buttons ?? [])
    .filter((b): b is AlertButton => !!b && typeof b === 'object')
    .map((b) => ({
      text: clean(b.text) ?? 'OK',
      onPress: b.onPress ? () => (b.onPress as () => void)() : undefined,
      style: b.style === 'cancel' || b.style === 'destructive' ? b.style : 'default',
    }));

  if (!t && !m && list.length === 0) return null;

  const isPlainOk =
    list.length === 0 ||
    (list.length === 1 && !list[0].onPress && list[0].style !== 'destructive' && OK_LABELS.has(list[0].text.toLowerCase()));
  const text = toastText(t, m);
  if (isPlainOk && text.length <= TOAST_MAX_CHARS) {
    return { kind: 'toast', id: nextId++, text, title: t, message: m };
  }

  const sheetButtons: AppAlertButton[] = list.length ? list : [{ text: 'OK', style: 'default' }];
  // A handler-less choice next to a real action ("View copy" / "OK") only
  // closes the sheet, so it behaves — and is styled and placed — as Cancel.
  if (sheetButtons.length > 1 && !sheetButtons.some((b) => b.style === 'cancel')) {
    const passive = sheetButtons.findIndex((b) => !b.onPress && b.style === 'default');
    if (passive !== -1 && sheetButtons.some((b) => b.onPress)) {
      sheetButtons[passive] = { ...sheetButtons[passive], style: 'cancel' };
    }
  }
  // Instagram order: actions first, Cancel last (bottom) in both layouts.
  const cancel = sheetButtons.filter((b) => b.style === 'cancel');
  const rest = sheetButtons.filter((b) => b.style !== 'cancel');
  const layout: 'dialog' | 'menu' = sheetButtons.length <= 2 ? 'dialog' : 'menu';
  const ordered = [...rest, ...cancel];

  // Dismissing (backdrop, Android back) behaves like the Cancel button when
  // there is one. A lone OK info sheet can always be dismissed. Otherwise
  // follow RN: `cancelable` opts in, and `onDismiss` fires.
  const cancelBtn = cancel[0];
  let onDismiss: (() => void) | null = null;
  if (cancelBtn) onDismiss = () => cancelBtn.onPress?.();
  else if (sheetButtons.length === 1 && !sheetButtons[0].onPress) onDismiss = () => options?.onDismiss?.();
  else if (options?.cancelable) onDismiss = () => options?.onDismiss?.();

  // A single button with a handler still fires it on dismiss ("OK" -> go back)
  // so a person who taps outside isn't left on a screen the flow meant to leave.
  // Never for a destructive button: tapping outside must not delete anything.
  if (!cancelBtn && sheetButtons.length === 1 && sheetButtons[0].onPress && sheetButtons[0].style !== 'destructive') {
    const only = sheetButtons[0];
    onDismiss = () => only.onPress?.();
  }

  return { kind: 'sheet', id: nextId++, title: t, message: m, layout, buttons: ordered, onDismiss };
}

// ─── Queue shared with <AppAlertHost /> ──────────────────────────────────────

type Listener = (queue: AppAlertRequest[]) => void;
let queue: AppAlertRequest[] = [];
const listeners = new Set<Listener>();
let hostCount = 0;

function emit() {
  for (const l of listeners) l(queue);
}

export function subscribeAppAlerts(listener: Listener): () => void {
  listeners.add(listener);
  hostCount++;
  listener(queue);
  return () => {
    listeners.delete(listener);
    hostCount--;
  };
}

export function hasAppAlertHost(): boolean {
  return hostCount > 0;
}

/** Removes a shown request (after a button press, dismiss or toast timeout). */
export function resolveAppAlert(id: number): void {
  const before = queue.length;
  queue = queue.filter((r) => r.id !== id);
  if (queue.length !== before) emit();
}

/** Clears every pending alert (tests / sign-out). */
export function resetAppAlerts(): void {
  queue = [];
  emit();
}

export function peekAppAlerts(): readonly AppAlertRequest[] {
  return queue;
}

// The platform alert, captured before `installAppAlert` swaps it.
const platformAlert = Alert.alert.bind(Alert);

/** The untouched platform alert. Prefer `Alert.alert` (the in-app one) everywhere. */
export function nativeAlert(...args: Parameters<typeof Alert.alert>): void {
  platformAlert(...args);
}

/** Same signature as `Alert.alert`; shows the in-app toast/sheet. */
export function appAlert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions): void {
  if (!hasAppAlertHost()) {
    platformAlert(title, message, buttons, options);
    return;
  }
  const req = classifyAlert(title, message, buttons, options);
  if (!req) return;
  // Identical toast already showing/queued (double tap on "Save") — don't stack it.
  if (req.kind === 'toast' && queue.some((r) => r.kind === 'toast' && r.text === req.text)) return;
  queue = [...queue, req];
  emit();
}

let installed = false;

/** Points `Alert.alert` at the in-app host. Idempotent. */
export function installAppAlert(): void {
  if (installed) return;
  installed = true;
  (Alert as { alert: typeof Alert.alert }).alert = appAlert;
}
