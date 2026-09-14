import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const component = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
  return {
    Pressable: component('Pressable'),
    Text: component('Text'),
    View: component('View'),
    StyleSheet: { create: (styles: unknown) => styles },
  };
});

import NavigationIsolationProbe from '@/app/navigation-isolation-probe';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('native navigation isolation probe', () => {
  it('presses through buyer, seller, editor, live, comments, and report routes', async () => {
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<NavigationIsolationProbe />);
    });

    const buttons = tree!.root.findAll(
      (node) => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'button',
    );
    expect(buttons).toHaveLength(6);

    for (const button of buttons) {
      await act(async () => {
        button.props.onPress();
      });
    }

    expect(push.mock.calls.map(([href]) => href)).toEqual([
      '/buyer-product-detail?id=scene-isolation-product',
      '/setup',
      '/product-editor?id=scene-isolation-product',
      '/seller-go-live',
      '/buyer-post-comments?postId=scene-isolation-post',
      '/buyer-report?targetType=post&targetId=scene-isolation-post',
    ]);
  });

  it('keeps the required native pipeline wired to interrupted device gestures', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    const deviceFlow = readFileSync(
      resolve(process.cwd(), 'tests/navigation-scene-isolation.device.mjs'),
      'utf8',
    );

    expect(packageJson.scripts['test:navigation:native']).toContain(
      'navigation-scene-isolation.device.mjs',
    );
    expect(packageJson.scripts['test:navigation:native:ci']).toContain(
      'NATIVE_GESTURE_REQUIRED=1',
    );
    expect(deviceFlow).toContain('type: \'pointerDown\'');
    expect(deviceFlow).toContain('type: \'pause\'');
    expect(deviceFlow).toContain('type: \'pointerUp\'');
    expect(deviceFlow).toContain("const progressPoints = [0.15, 0.35, 0.55]");
    expect(deviceFlow).toContain("name: 'card'");
    expect(deviceFlow).toContain("name: 'retained-modal'");
    expect(deviceFlow).toContain("'xcrun'");
    expect(deviceFlow).toContain("'adb'");
    expect(deviceFlow).toContain('pixelHash(settledPath) === pixelHash(interruptedPath)');
    expect(deviceFlow).not.toContain(`/session/\${sessionId}/screenshot`);
  });
});