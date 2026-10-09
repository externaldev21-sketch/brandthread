import { beforeEach, describe, expect, it, vi } from 'vitest';

const platformAlert = vi.fn();
vi.mock('react-native', () => ({ Alert: { alert: (...args: unknown[]) => platformAlert(...args) } }));

import { Alert } from 'react-native';
import {
  TOAST_MAX_CHARS, appAlert, classifyAlert, installAppAlert, peekAppAlerts,
  resetAppAlerts, resolveAppAlert, subscribeAppAlerts, toastText,
} from '@/lib/appAlert';

describe('classifyAlert', () => {
  it('shows a toast for a plain message with no buttons', () => {
    const r = classifyAlert('Saved', 'Your changes are live.');
    expect(r).toMatchObject({ kind: 'toast', text: 'Saved. Your changes are live.', title: 'Saved', message: 'Your changes are live.' });
  });

  it('shows a toast for a single OK button with no handler', () => {
    expect(classifyAlert('Copied', undefined, [{ text: 'OK' }])).toMatchObject({ kind: 'toast', text: 'Copied' });
    expect(classifyAlert('Error', 'Try again', [{ text: 'Got it' }])?.kind).toBe('toast');
  });

  it('returns null when there is nothing to show', () => {
    expect(classifyAlert('', '')).toBeNull();
    expect(classifyAlert('   ')).toBeNull();
  });

  it('uses a sheet when the only button has a handler, and dismiss still runs it', () => {
    const goBack = vi.fn();
    const r = classifyAlert('Request sent', 'We will email you.', [{ text: 'OK', onPress: goBack }]);
    expect(r?.kind).toBe('sheet');
    if (r?.kind !== 'sheet') return;
    expect(r.layout).toBe('dialog');
    r.onDismiss?.();
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('uses a sheet for long info messages so they stay readable', () => {
    const long = 'x'.repeat(TOAST_MAX_CHARS + 1);
    expect(classifyAlert('Note', long)?.kind).toBe('sheet');
  });

  it('puts Cancel last in a dialog (Instagram order) and dismiss maps to Cancel', () => {
    const onCancel = vi.fn();
    const onDelete = vi.fn();
    const r = classifyAlert('Delete product?', 'This cannot be undone.', [
      { text: 'Delete', style: 'destructive', onPress: onDelete },
      { text: 'Cancel', style: 'cancel', onPress: onCancel },
    ]);
    if (r?.kind !== 'sheet') throw new Error('expected sheet');
    expect(r.buttons.map((b) => b.text)).toEqual(['Delete', 'Cancel']);
    r.onDismiss?.();
    expect(onCancel).toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('never runs a lone destructive action on dismiss', () => {
    const onDelete = vi.fn();
    const r = classifyAlert('Remove?', undefined, [{ text: 'Remove', style: 'destructive', onPress: onDelete }]);
    if (r?.kind !== 'sheet') throw new Error('expected sheet');
    expect(r.onDismiss).toBeNull();
  });

  it('stacks 3+ choices as a menu with Cancel last', () => {
    const r = classifyAlert('Product', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Edit', onPress: () => {} },
      { text: 'Duplicate', onPress: () => {} },
      { text: 'Delete', style: 'destructive', onPress: () => {} },
    ]);
    if (r?.kind !== 'sheet') throw new Error('expected sheet');
    expect(r.layout).toBe('menu');
    expect(r.buttons.map((b) => b.text)).toEqual(['Edit', 'Duplicate', 'Delete', 'Cancel']);
  });

  it('respects cancelable / onDismiss when there is no Cancel button', () => {
    const onDismiss = vi.fn();
    const buttons = [{ text: 'A', onPress: () => {} }, { text: 'B', onPress: () => {} }];
    const notCancelable = classifyAlert('Pick', undefined, buttons);
    if (notCancelable?.kind !== 'sheet') throw new Error('expected sheet');
    expect(notCancelable.onDismiss).toBeNull();
    const cancelable = classifyAlert('Pick', undefined, buttons, { cancelable: true, onDismiss });
    if (cancelable?.kind !== 'sheet') throw new Error('expected sheet');
    cancelable.onDismiss?.();
    expect(onDismiss).toHaveBeenCalled();
  });

  it('tolerates null entries and missing labels', () => {
    const r = classifyAlert('Hi', undefined, [null as never, { onPress: () => {} }]);
    if (r?.kind !== 'sheet') throw new Error('expected sheet');
    expect(r.buttons).toHaveLength(1);
    expect(r.buttons[0].text).toBe('OK');
  });
});

describe('toastText', () => {
  it('does not double punctuation', () => {
    expect(toastText('Done!', 'Shared')).toBe('Done! Shared');
    expect(toastText(undefined, 'Only message')).toBe('Only message');
  });
});

describe('appAlert queue', () => {
  beforeEach(() => {
    resetAppAlerts();
    platformAlert.mockClear();
  });

  it('falls back to the platform alert when no host is mounted', () => {
    appAlert('Hello', 'World');
    expect(platformAlert).toHaveBeenCalledWith('Hello', 'World', undefined, undefined);
    expect(peekAppAlerts()).toHaveLength(0);
  });

  it('queues for a mounted host, de-dupes identical toasts, and resolves', () => {
    const seen: number[] = [];
    const unsubscribe = subscribeAppAlerts((q) => seen.push(q.length));
    appAlert('Saved');
    appAlert('Saved');
    appAlert('Delete?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive' }]);
    const q = peekAppAlerts();
    expect(q.map((r) => r.kind)).toEqual(['toast', 'sheet']);
    resolveAppAlert(q[0].id);
    expect(peekAppAlerts()).toHaveLength(1);
    expect(platformAlert).not.toHaveBeenCalled();
    unsubscribe();
    expect(seen.length).toBeGreaterThan(1);
  });

  it('installAppAlert re-points Alert.alert at the in-app queue', () => {
    installAppAlert();
    const unsubscribe = subscribeAppAlerts(() => {});
    Alert.alert('Copied');
    expect(peekAppAlerts()).toMatchObject([{ kind: 'toast', text: 'Copied' }]);
    expect(platformAlert).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('passive buttons', () => {
  it('treats a handler-less OK next to a real action as Cancel', () => {
    const view = vi.fn();
    const r = classifyAlert('Product duplicated', 'Tee was added as a draft.', [
      { text: 'View copy', onPress: view },
      { text: 'OK' },
    ]);
    if (r?.kind !== 'sheet') throw new Error('expected sheet');
    expect(r.buttons.map((b) => [b.text, b.style])).toEqual([['View copy', 'default'], ['OK', 'cancel']]);
    r.onDismiss?.();
    expect(view).not.toHaveBeenCalled();
  });
});
