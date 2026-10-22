import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Platform, Text } from 'react-native';

vi.mock('@/components/BrandthreadUI', () => ({
  PressableScale: (props: Record<string, unknown>) =>
    React.createElement('PressableScale', props, props.children as React.ReactNode),
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

import { SpotlightOverlay } from '@/components/first-run-tips/SpotlightOverlay';
import { SpotlightTip } from '@/components/first-run-tips/SpotlightTip';
import { AnchoredCardTip } from '@/components/first-run-tips/AnchoredCardTip';
import { setTipTarget, tipTargetProps, useTipTarget } from '@/components/first-run-tips/tipTargets';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const renderers: ReactTestRenderer[] = [];
const target = { x: 190, y: 200, width: 160, height: 60 };
async function render(element: React.ReactElement) {
  let result!: ReactTestRenderer;
  await act(async () => { result = create(element); });
  renderers.push(result);
  return result;
}
afterEach(async () => {
  await act(async () => { renderers.splice(0).forEach(r => r.unmount()); });
  Platform.OS = 'android';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('first-run spotlight interactions', () => {
  it('keeps the target hole touch-transparent and dismisses on a scrim tap', async () => {
    const dismiss = vi.fn();
    const r = await render(<SpotlightOverlay hole={target} onScrimPress={dismiss} />);
    const hole = r.root.findByProps({ testID: 'spotlight-hole' });
    expect(hole.props.pointerEvents).toBe('none');
    expect(r.root.findByProps({ testID: 'spotlight-overlay' }).props.pointerEvents).toBe('box-none');
    await act(async () => r.root.findByProps({ testID: 'spotlight-scrim-top' }).props.onPress());
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('closes the measured spotlight using X without replacing the real action', async () => {
    const dismiss = vi.fn();
    const r = await render(<SpotlightTip visible target={target} title="Original title" body="Original body" onDismiss={dismiss} />);
    await act(async () => r.root.findByProps({ testID: 'first-run-tip-close' }).props.onPress());
    expect(dismiss).toHaveBeenCalledOnce();
    expect(r.root.findAllByType(Text).some(n => n.props.children === 'Original body')).toBe(true);
  });

  it('retains tour order, step indicator and final dismissal', async () => {
    const dismiss = vi.fn();
    const r = await render(<AnchoredCardTip visible onDismiss={dismiss}
      steps={[{ title: 'First original step' }, { title: 'Second original step' }]}
      targets={[target, target]} />);
    const texts = () => r.root.findAllByType(Text).map(n => n.props.children);
    expect(texts()).toContain('First original step');
    await act(async () => r.root.findByProps({ accessibilityLabel: 'Next' }).props.onPress());
    expect(texts()).toContain('Second original step');
    expect(texts()).toContainEqual([2, ' / ', 2]);
    expect(dismiss).not.toHaveBeenCalled();
    await act(async () => r.root.findByProps({ accessibilityLabel: 'Done' }).props.onPress());
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('observes a web target click without cancelling it and cleans up the observer', async () => {
    Platform.OS = 'web';
    const add = vi.fn(), remove = vi.fn();
    vi.stubGlobal('document', { addEventListener: add, removeEventListener: remove });
    const complete = vi.fn();
    const r = await render(<SpotlightOverlay hole={target} onScrimPress={() => {}} onTargetPress={complete} />);
    const handler = add.mock.calls[0][1];
    const click = { clientX: 220, clientY: 230, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    handler(click);
    expect(complete).not.toHaveBeenCalled();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(complete).toHaveBeenCalledOnce();
    expect(click.preventDefault).not.toHaveBeenCalled();
    expect(click.stopPropagation).not.toHaveBeenCalled();
    await act(async () => r.unmount());
    expect(remove).toHaveBeenCalled();
  });

  it('relays an invisible target measurement and clears it on unmount', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 1; });
    let measured: typeof target | null = null;
    function Probe() { measured = useTipTarget('test-target'); return null; }
    await render(<Probe />);
    const props = tipTargetProps('test-target');
    await act(async () => {
      props.ref({ measureInWindow: (cb: (...args: number[]) => void) => cb(190, 200, 160, 60) });
      props.onLayout();
    });
    expect(measured).toEqual(target);
    await act(async () => props.ref(null));
    expect(measured).toBeNull();
    setTipTarget('test-target', null);
  });
});
