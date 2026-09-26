import { describe, it, expect, vi, beforeEach } from 'vitest';

const asyncStorageStore: Record<string, string> = {};

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncStorageStore[key] ?? null),
    setItem: vi.fn(async (key: string, value: string) => { asyncStorageStore[key] = value; }),
  },
}));

import {
  parseQuickReplies, cannedAgentReply, hasWelcomePlayed, markWelcomePlayed, BUYER_QUICK_REPLIES,
} from '../agentChat';

describe('parseQuickReplies', () => {
  it('falls back to buyer defaults when optionsJson is missing', () => {
    expect(parseQuickReplies(undefined)).toEqual(BUYER_QUICK_REPLIES);
    expect(parseQuickReplies(null)).toEqual(BUYER_QUICK_REPLIES);
  });

  it('falls back to buyer defaults on malformed JSON', () => {
    expect(parseQuickReplies('not json')).toEqual(BUYER_QUICK_REPLIES);
  });

  it('parses a well-formed options array from the server', () => {
    const options = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }];
    expect(parseQuickReplies(JSON.stringify(options))).toEqual(options);
  });
});

describe('cannedAgentReply', () => {
  it('mentions Thread Cash rules and a thread_cash card for a Thread Cash question', () => {
    const reply = cannedAgentReply('Show me how Thread Cash works');
    expect(reply.text.toLowerCase()).toContain('checkout');
    expect(reply.cardKind).toBe('thread_cash');
  });

  it('covers selling topics for a seller-flavored question', () => {
    const reply = cannedAgentReply('How do I start selling on Brandthread?');
    expect(reply.text.toLowerCase()).toMatch(/seller hub|listing|shopify/);
  });

  it('offers a discover card for a "find me brands" question', () => {
    const reply = cannedAgentReply("Find me some brands I'd like");
    expect(reply.cardKind).toBe('discover');
  });

  it('always returns non-empty text for an unrecognized message', () => {
    const reply = cannedAgentReply('asdkjfhaskjdfh');
    expect(reply.text.length).toBeGreaterThan(0);
  });
});

describe('welcome-played persistence', () => {
  beforeEach(() => {
    for (const key of Object.keys(asyncStorageStore)) delete asyncStorageStore[key];
  });

  it('is false before markWelcomePlayed is called', async () => {
    expect(await hasWelcomePlayed('conv-1')).toBe(false);
  });

  it('is true after markWelcomePlayed, and scoped per conversation id', async () => {
    await markWelcomePlayed('conv-1');
    expect(await hasWelcomePlayed('conv-1')).toBe(true);
    expect(await hasWelcomePlayed('conv-2')).toBe(false);
  });
});
