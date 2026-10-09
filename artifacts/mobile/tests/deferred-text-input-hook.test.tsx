import React, { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { useDeferredTextInput } from '../hooks/useDeferredTextInput';
import { useStableCallback } from '../hooks/useStableCallback';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Field = ReturnType<typeof useDeferredTextInput>;

function Owner({ transform, onField, onOwnerRender }: {
  transform: (prev: string, next: string) => string;
  onField: (field: Field, ownerValue: string, setOwner: (v: string) => void) => void;
  onOwnerRender?: () => void;
}) {
  const [value, setValue] = useState('ab');
  onOwnerRender?.();
  return <Child value={value} onChange={(next) => setValue((prev) => transform(prev, next))} report={(f) => onField(f, value, setValue)} />;
}

function Child({ value, onChange, report }: { value: string; onChange: (v: string) => void; report: (f: Field) => void }) {
  report(useDeferredTextInput(value, onChange));
  return null;
}

describe('useDeferredTextInput', () => {
  let renderer: ReactTestRenderer | null = null;
  afterEach(() => { act(() => renderer?.unmount()); renderer = null; });

  function mount(transform: (prev: string, next: string) => string) {
    const state: { field?: Field; owner?: string; setOwner?: (v: string) => void } = {};
    act(() => {
      renderer = create(<Owner transform={transform} onField={(f, owner, setOwner) => { state.field = f; state.owner = owner; state.setOwner = setOwner; }} />);
    });
    return state;
  }

  it('shows the keystroke and forwards it to the owner', () => {
    const s = mount((_prev, next) => next);
    expect(s.field!.text).toBe('ab');
    act(() => s.field!.onChangeText('abc'));
    expect(s.field!.text).toBe('abc');
    expect(s.owner).toBe('abc');
  });

  it('adopts an owner-side change (reset / prefill / formatting)', () => {
    const s = mount((_prev, next) => next.toUpperCase());
    act(() => s.field!.onChangeText('abc'));
    expect(s.owner).toBe('ABC');
    expect(s.field!.text).toBe('ABC');
    act(() => s.setOwner!(''));
    expect(s.field!.text).toBe('');
  });

  it('reverts to the owner value when the owner rejects the edit', () => {
    const s = mount((prev, next) => (/^[a-z]*$/.test(next) ? next : prev));
    act(() => s.field!.onChangeText('ab1'));
    expect(s.owner).toBe('ab');
    expect(s.field!.text).toBe('ab');
  });
});

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
