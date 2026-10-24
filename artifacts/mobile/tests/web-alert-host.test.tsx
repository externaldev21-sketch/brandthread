import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const host = (name: string) => {
    function MockHost(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockHost.displayName = name;
    return MockHost;
  };
  function Modal(props: { visible: boolean; children?: React.ReactNode }) {
    return props.visible ? React.createElement('Modal', props, props.children) : null;
  }
  return {
    Alert: { alert: vi.fn() },
    ActionSheetIOS: { showActionSheetWithOptions: vi.fn() },
    Platform: { OS: 'web' },
    Modal,
    Pressable: host('Pressable'),
    Text: host('Text'),
    View: host('View'),
    StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  };
});

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: { card: '#000000', shadowColor: '#000000', border: '#C0C0C047', text: '#FFFFFF', muted: '#C0C0C0', error: '#FFB4B4' },
  }),
}));

import { WebAlertHost } from '@/components/ui/WebAlertHost';
import { showAlert } from '@/lib/actionSheet';

let renderer: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const alertCards = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === ('Pressable' as never) && n.props.testID === 'web-alert');
const texts = (r: ReactTestRenderer) => r.root.findAllByType('Text' as never).map((n) => n.props.children);

describe('<WebAlertHost /> on web', () => {
  it('renders the alert with the same copy and runs the pressed button handler', async () => {
    act(() => { renderer = create(<WebAlertHost />); });
    const onDelete = vi.fn();
    act(() => {
      showAlert('Your story', undefined, [
        { text: 'Delete story', style: 'destructive', onPress: onDelete },
        { text: 'Cancel', style: 'cancel' },
      ]);
    });

    expect(alertCards(renderer!)).toHaveLength(1);
    expect(texts(renderer!)).toEqual(['Your story', 'Delete story', 'Cancel']);

    act(() => renderer!.root.findByProps({ testID: 'web-alert-button-0' }).props.onPress());
    await flush();
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(alertCards(renderer!)).toHaveLength(0);
  });

  it('queues a second alert raised while the first is open', async () => {
    act(() => { renderer = create(<WebAlertHost />); });
    act(() => {
      showAlert('Delete Layer', 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive' }]);
      showAlert('Export failed', "Couldn't save your design. Try again.");
    });
    expect(texts(renderer!)).toContain('Delete Layer');

    act(() => renderer!.root.findByProps({ testID: 'web-alert-button-1' }).props.onPress());
    await flush();
    expect(texts(renderer!)).toEqual(['Export failed', "Couldn't save your design. Try again.", 'OK']);
  });

  it('backdrop dismiss runs the cancel button', async () => {
    act(() => { renderer = create(<WebAlertHost />); });
    const onCancel = vi.fn();
    act(() => { showAlert('Clear read notifications', 'This will remove all read notifications.', [{ text: 'Clear', style: 'destructive' }, { text: 'Cancel', style: 'cancel', onPress: onCancel }]); });

    act(() => renderer!.root.findByProps({ accessibilityLabel: 'Dismiss' }).props.onPress());
    await flush();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
