import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetWarmThreadsForTests,
  peekWarmThread,
  rememberWarmThread,
  sellerThreadCacheKey,
} from './conversationPrefetch';

const thread = (text: string) => ({
  conversation: null,
  messages: [{ id: text, text } as never],
});

describe('warm thread cache', () => {
  beforeEach(() => __resetWarmThreadsForTests());

  it('returns the warmed thread for the same account only', () => {
    rememberWarmThread('user-a', 'conv-1', thread('hi'));
    expect(peekWarmThread('user-a', 'conv-1')?.messages).toHaveLength(1);
    expect(peekWarmThread('user-b', 'conv-1')).toBeUndefined();
    expect(peekWarmThread(null, 'conv-1')).toBeUndefined();
    expect(peekWarmThread('user-a', undefined)).toBeUndefined();
  });

  it('keeps only the most recent 20 threads', () => {
    for (let i = 0; i < 25; i += 1) rememberWarmThread('u', `c${i}`, thread(String(i)));
    expect(peekWarmThread('u', 'c0')).toBeUndefined();
    expect(peekWarmThread('u', 'c4')).toBeUndefined();
    expect(peekWarmThread('u', 'c5')).toBeDefined();
    expect(peekWarmThread('u', 'c24')).toBeDefined();
  });

  it('re-warming a thread moves it to the newest slot', () => {
    for (let i = 0; i < 20; i += 1) rememberWarmThread('u', `c${i}`, thread(String(i)));
    rememberWarmThread('u', 'c0', thread('again'));
    rememberWarmThread('u', 'c20', thread('new'));
    expect(peekWarmThread('u', 'c0')?.messages[0]).toMatchObject({ text: 'again' });
    expect(peekWarmThread('u', 'c1')).toBeUndefined();
  });

  it('namespaces the seller thread cache key', () => {
    expect(sellerThreadCacheKey('abc')).toBe('seller-thread:abc');
  });
});
