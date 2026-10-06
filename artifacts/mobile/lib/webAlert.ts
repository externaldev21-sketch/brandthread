/**
 * `Alert.alert` / `Alert.prompt` for the web build.
 *
 * react-native-web ships `Alert` as `class Alert { static alert() {} }` — a
 * complete no-op. This app has 1000+ `Alert.alert` call sites (confirmations,
 * option menus, validation errors, "Saved" prompts that navigate on OK), so on
 * the web preview every one of them silently did nothing: Delete/Block/Sign out
 * never ran, `confirmBlock()` promises never settled, and invalid forms looked
 * like a dead Save button (docs/audit/FULL_APP_AUDIT.md, the "dead on web
 * (Alert.alert callback)" findings).
 *
 * Instead of rewriting every call site, `installWebAlertPolyfill()` replaces
 * `Alert.alert` (and adds `Alert.prompt`) on web only with a queue that
 * `<WebAlertHost />` renders as a real dialog. Native platforms are untouched:
 * the installer returns immediately unless `Platform.OS === 'web'`.
 *
 * This module holds only the queue and the button rules (no React), so it is
 * unit-tested directly in lib/__tests__/webAlert.test.ts.
 */
import type { AlertButton, AlertOptions } from 'react-native';

export type WebAlertButton = {
  text?: string;
  style?: 'default' | 'cancel' | 'destructive';
  /** For prompts the typed value is passed through. */
  onPress?: (value?: string) => void | Promise<unknown>;
};

export type WebAlertRequest = {
  id: number;
  kind: 'alert' | 'prompt';
  title: string;
  message?: string;
  buttons: WebAlertButton[];
  options?: AlertOptions;
  /** Prompt only. */
  defaultValue?: string;
  secure?: boolean;
  keyboardType?: string;
};

type Listener = (current: WebAlertRequest | null) => void;

let nextId = 1;
const queue: WebAlertRequest[] = [];
const listeners = new Set<Listener>();

function emit() {
  const current = queue[0] ?? null;
  listeners.forEach((l) => l(current));
}

/** Subscribe to the front of the queue. Calls back immediately with the current item. */
export function subscribeWebAlerts(listener: Listener): () => void {
  listeners.add(listener);
  listener(queue[0] ?? null);
  return () => {
    listeners.delete(listener);
  };
}

export function currentWebAlert(): WebAlertRequest | null {
  return queue[0] ?? null;
}

/** Test helper: drop everything that is queued. */
export function resetWebAlerts() {
  queue.length = 0;
  emit();
}

/** No buttons means a single "OK", the same as iOS/Android. */
export function normalizeButtons(buttons?: readonly WebAlertButton[] | null): WebAlertButton[] {
  const list = (buttons ?? []).filter(Boolean);
  return list.length ? [...list] : [{ text: 'OK' }];
}

/**
 * Display order. Two buttons sit side by side with Cancel on the left (the iOS
 * order); three or more stack vertically with Cancel moved to the bottom.
 */
export function orderButtons(buttons: WebAlertButton[]): WebAlertButton[] {
  const cancel = buttons.filter((b) => b.style === 'cancel');
  const rest = buttons.filter((b) => b.style !== 'cancel');
  return buttons.length === 2 ? [...cancel, ...rest] : [...rest, ...cancel];
}

/**
 * What a backdrop tap / Escape does. Runs the cancel-style button if there is
 * one; a single-button alert ("OK") runs that button so any "navigate back on
 * OK" logic still happens; otherwise the person has to pick (the iOS rule).
 */
export function dismissAction(req: Pick<WebAlertRequest, 'buttons'>): WebAlertButton | null {
  const cancel = req.buttons.find((b) => b.style === 'cancel');
  if (cancel) return cancel;
  if (req.buttons.length === 1) return req.buttons[0];
  return null;
}

/** Enter key: the last non-cancel button (the "primary" action). */
export function primaryButton(req: Pick<WebAlertRequest, 'buttons'>): WebAlertButton | null {
  const nonCancel = req.buttons.filter((b) => b.style !== 'cancel');
  return nonCancel[nonCancel.length - 1] ?? req.buttons[0] ?? null;
}

export function enqueueWebAlert(req: Omit<WebAlertRequest, 'id'>): number {
  const id = nextId++;
  queue.push({ ...req, id });
  if (queue.length === 1) emit();
  return id;
}

function runSafely(fn: (() => unknown) | undefined) {
  if (!fn) return;
  try {
    const out = fn();
    if (out && typeof (out as Promise<unknown>).catch === 'function') {
      (out as Promise<unknown>).catch((e) => console.warn('[Alert] button handler failed', e));
    }
  } catch (e) {
    console.warn('[Alert] button handler failed', e);
  }
}

/**
 * Close the front dialog and run `button` (if any). The handler runs on the
 * next tick so a handler that opens another alert queues it after this one
 * has closed (nested "Couldn't block" after "Block", etc.).
 */
export function resolveWebAlert(id: number, button: WebAlertButton | null, value?: string) {
  const front = queue[0];
  if (!front || front.id !== id) return;
  queue.shift();
  emit();
  const run = () => {
    if (button) runSafely(() => button.onPress?.(front.kind === 'prompt' ? value ?? '' : undefined));
    else runSafely(() => front.options?.onDismiss?.());
  };
  if (typeof setTimeout === 'function') setTimeout(run, 0);
  else run();
}

/** Backdrop tap / Escape. Returns false when the dialog must stay open. */
export function dismissWebAlert(id: number): boolean {
  const front = queue[0];
  if (!front || front.id !== id) return false;
  const action = dismissAction(front);
  if (action === null) return false;
  resolveWebAlert(id, action, front.defaultValue);
  return true;
}

type AlertLike = {
  alert: (...args: any[]) => void;
  prompt?: (...args: any[]) => void;
};

let installed = false;

/**
 * Patch `Alert` on web. Safe to call more than once; a no-op on native.
 * `platformOS` is injectable for tests.
 */
export function installWebAlertPolyfill(AlertImpl: AlertLike, platformOS: string): boolean {
  if (platformOS !== 'web' || installed) return false;
  installed = true;

  AlertImpl.alert = (
    title?: string,
    message?: string,
    buttons?: AlertButton[],
    options?: AlertOptions,
  ) => {
    enqueueWebAlert({
      kind: 'alert',
      title: title ?? '',
      message: message || undefined,
      buttons: normalizeButtons(buttons as WebAlertButton[] | undefined),
      options,
    });
  };

  AlertImpl.prompt = (
    title?: string,
    message?: string,
    callbackOrButtons?: ((text: string) => void) | AlertButton[],
    type?: string,
    defaultValue?: string,
    keyboardType?: string,
  ) => {
    const buttons: WebAlertButton[] =
      typeof callbackOrButtons === 'function'
        ? [
            { text: 'Cancel', style: 'cancel' },
            { text: 'OK', onPress: (v) => (callbackOrButtons as (text: string) => void)(v ?? '') },
          ]
        : normalizeButtons(callbackOrButtons as WebAlertButton[] | undefined);
    enqueueWebAlert({
      kind: 'prompt',
      title: title ?? '',
      message: message || undefined,
      buttons,
      defaultValue: defaultValue ?? '',
      secure: type === 'secure-text',
      keyboardType,
    });
  };
  return true;
}

/** Test helper. */
export function __resetWebAlertInstallForTests() {
  installed = false;
}
