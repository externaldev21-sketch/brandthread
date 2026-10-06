import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetWebAlertInstallForTests,
  currentWebAlert,
  dismissWebAlert,
  installWebAlertPolyfill,
  normalizeButtons,
  orderButtons,
  primaryButton,
  resetWebAlerts,
  resolveWebAlert,
} from '@/lib/webAlert';

function makeAlert() {
  return { alert: vi.fn(), prompt: undefined as undefined | ((...a: any[]) => void) };
}

describe('web Alert polyfill', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetWebAlerts();
    __resetWebAlertInstallForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing on native', () => {
    const A = makeAlert();
    const original = A.alert;
    expect(installWebAlertPolyfill(A, 'ios')).toBe(false);
    expect(installWebAlertPolyfill(A, 'android')).toBe(false);
    expect(A.alert).toBe(original);
  });

  it('queues alerts on web and runs the tapped button after closing', () => {
    const A = makeAlert();
    installWebAlertPolyfill(A, 'web');
    const onDelete = vi.fn();
    A.alert('Delete post?', 'This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
    const req = currentWebAlert()!;
    expect(req.title).toBe('Delete post?');
    expect(req.buttons).toHaveLength(2);
    resolveWebAlert(req.id, req.buttons[1]);
    expect(currentWebAlert()).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('settles promise-based confirmations (confirmBlock pattern) on cancel and dismiss', async () => {
    const A = makeAlert();
    installWebAlertPolyfill(A, 'web');
    const p = new Promise<boolean>((resolve) => {
      A.alert('Block Ava?', 'msg', [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Block', style: 'destructive', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
    expect(dismissWebAlert(currentWebAlert()!.id)).toBe(true);
    vi.runAllTimers();
    await expect(p).resolves.toBe(false);
  });

  it('shows queued alerts one at a time (nested error after a confirm)', () => {
    const A = makeAlert();
    installWebAlertPolyfill(A, 'web');
    A.alert('First');
    A.alert('Second');
    expect(currentWebAlert()!.title).toBe('First');
    resolveWebAlert(currentWebAlert()!.id, currentWebAlert()!.buttons[0]);
    expect(currentWebAlert()!.title).toBe('Second');
  });

  it('a single OK alert runs its handler when dismissed (navigate-back-on-OK flows)', () => {
    const A = makeAlert();
    installWebAlertPolyfill(A, 'web');
    const back = vi.fn();
    A.alert('Saved', undefined, [{ text: 'OK', onPress: back }]);
    dismissWebAlert(currentWebAlert()!.id);
    vi.runAllTimers();
    expect(back).toHaveBeenCalled();
  });

  it('a choice without a cancel button cannot be dismissed by the backdrop', () => {
    const A = makeAlert();
    installWebAlertPolyfill(A, 'web');
    A.alert('Pick one', undefined, [{ text: 'A' }, { text: 'B' }]);
    expect(dismissWebAlert(currentWebAlert()!.id)).toBe(false);
    expect(currentWebAlert()).not.toBeNull();
  });

  it('adds Alert.prompt and passes the typed value', () => {
    const A = makeAlert();
    installWebAlertPolyfill(A, 'web');
    const cb = vi.fn();
    A.prompt!('Rename', 'New name:', cb, 'plain-text', 'Logo');
    const req = currentWebAlert()!;
    expect(req.kind).toBe('prompt');
    expect(req.defaultValue).toBe('Logo');
    resolveWebAlert(req.id, primaryButton(req), 'Wordmark');
    vi.runAllTimers();
    expect(cb).toHaveBeenCalledWith('Wordmark');
  });

  it('a throwing handler does not break the queue', () => {
    const A = makeAlert();
    installWebAlertPolyfill(A, 'web');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    A.alert('Boom', undefined, [{ text: 'OK', onPress: () => { throw new Error('x'); } }]);
    A.alert('Next');
    resolveWebAlert(currentWebAlert()!.id, currentWebAlert()!.buttons[0]);
    expect(() => vi.runAllTimers()).not.toThrow();
    expect(currentWebAlert()!.title).toBe('Next');
    warn.mockRestore();
  });
});

describe('button rules', () => {
  it('defaults to OK', () => {
    expect(normalizeButtons(undefined)).toEqual([{ text: 'OK' }]);
  });
  it('puts cancel first for two buttons and last for stacks', () => {
    const c = { text: 'Cancel', style: 'cancel' as const };
    const d = { text: 'Delete', style: 'destructive' as const };
    const e = { text: 'Edit' };
    expect(orderButtons([d, c]).map((b) => b.text)).toEqual(['Cancel', 'Delete']);
    expect(orderButtons([c, e, d]).map((b) => b.text)).toEqual(['Edit', 'Delete', 'Cancel']);
  });
  it('primary is the last non-cancel button', () => {
    expect(primaryButton({ buttons: [{ text: 'Cancel', style: 'cancel' }, { text: 'Save' }] })!.text).toBe('Save');
  });
});
