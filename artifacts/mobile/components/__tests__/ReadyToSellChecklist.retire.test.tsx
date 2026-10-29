import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { ReadyToSellChecklist } from '@/components/ReadyToSellChecklist';
import { buildFreshReadyToSell, type ReadyToSellResponse } from '@/lib/readyToSell';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const allDone: ReadyToSellResponse = {
  ...buildFreshReadyToSell(),
  steps: buildFreshReadyToSell().steps.map((s) => ({ ...s, done: true })),
  doneCount: 6,
  complete: true,
};

function render(props: Partial<React.ComponentProps<typeof ReadyToSellChecklist>>): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<ReadyToSellChecklist data={buildFreshReadyToSell()} hasPlan={false} onOpen={() => {}} {...props} />);
  });
  return tree;
}

const has = (tree: ReactTestRenderer, testID: string) => tree.root.findAll((n) => n.props.testID === testID).length > 0;

describe('ReadyToSellChecklist retires on server state', () => {
  it('new seller, no plan: checklist and the free-trial block both show', () => {
    const tree = render({ progress: { done: 0, total: 9, complete: false } });
    expect(has(tree, 'ready-to-sell-count')).toBe(true);
    expect(has(tree, 'ready-to-sell-select-plan')).toBe(true);
  });

  it('plan bought: "Select a plan" is gone, checklist stays', () => {
    const tree = render({ hasPlan: true, progress: { done: 4, total: 9, complete: false } });
    expect(has(tree, 'ready-to-sell-plan')).toBe(false);
    expect(has(tree, 'ready-to-sell-count')).toBe(true);
  });

  it('all 9 steps done: checklist is gone, plan block alone if still unpaid', () => {
    const tree = render({ data: allDone, progress: { done: 9, total: 9, complete: true } });
    expect(has(tree, 'ready-to-sell-count')).toBe(false);
    expect(has(tree, 'ready-to-sell-plan')).toBe(true);
  });

  it('all done and on a plan: renders nothing at all', () => {
    const tree = render({ data: allDone, hasPlan: true, progress: { done: 9, total: 9, complete: true } });
    expect(tree.toJSON()).toBeNull();
  });
});
