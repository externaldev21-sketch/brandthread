import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { useStableCallback } from '../hooks/useStableCallback';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useStableCallback', () => {
  it('keeps one identity and calls the latest function', () => {
    const seen: Array<(n: number) => number> = [];
    function Probe({ add }: { add: number }) {
      seen.push(useStableCallback((n: number) => n + add));
      return null;
    }
    let r!: ReactTestRenderer;
    act(() => { r = create(<Probe add={1} />); });
    act(() => r.update(<Probe add={10} />));
    expect(seen[0]).toBe(seen[seen.length - 1]);
    expect(seen[0](1)).toBe(11);
    act(() => r.unmount());
  });
});
