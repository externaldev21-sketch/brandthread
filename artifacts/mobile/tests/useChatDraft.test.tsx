import React, { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatDraft } from '../hooks/useChatDraft';

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('@/services/socialService', () => ({
  getChatDraft: storage.get, setChatDraft: storage.set,
}));

let currentText = '';
let typeText: (text: string) => void;
let renderer: ReactTestRenderer | undefined;
function Composer({ owner }: { owner: string }) {
  const [text, setText] = useState('');
  currentText = text;
  typeText = setText;
  useChatDraft('thread', text, setText, owner);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  storage.get.mockReset().mockResolvedValue('');
  storage.set.mockReset().mockResolvedValue(undefined);
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  vi.useRealTimers();
});

describe('account-bound composer drafts', () => {
  it('saves typing that started before the draft read completed', async () => {
    let finish!: (text: string) => void;
    storage.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { renderer = create(<Composer owner="first" />); });
    await act(async () => { typeText('typed while loading'); });
    await act(async () => { finish(''); });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(storage.set).toHaveBeenCalledWith('thread', 'typed while loading', 'first');
  });

  it('flushes the old owner draft and clears the composer on account switch', async () => {
    await act(async () => { renderer = create(<Composer owner="first" />); });
    await act(async () => { typeText('first account private draft'); });
    await act(async () => { renderer!.update(<Composer owner="second" />); });
    expect(currentText).toBe('');
    expect(storage.set).toHaveBeenCalledWith('thread', 'first account private draft', 'first');
    expect(storage.set).not.toHaveBeenCalledWith('thread', 'first account private draft', 'second');
    await act(async () => { typeText('second draft'); vi.advanceTimersByTime(400); });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(storage.set).toHaveBeenCalledWith('thread', 'second draft', 'second');
  });

  it('ignores a late restoration from a previous account', async () => {
    let finish!: (text: string) => void;
    storage.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { renderer = create(<Composer owner="first" />); });
    await act(async () => { renderer!.update(<Composer owner="second" />); });
    await act(async () => { finish('old private text'); });
    expect(currentText).toBe('');
  });
});
