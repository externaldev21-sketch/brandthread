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
    expect(BUYER_QUICK_REPLIES).toContainEqual({ label: 'Just browsing', value: 'Just browsing for now' });
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
    expect(reply.text).toBe("Check in daily to earn credit, then turn it on at checkout as a discount — your card covers the rest. You can send it to people you mutually follow, and credit someone sends you can't be re-sent onward.");
    expect(reply.cardKind).toBe('thread_cash');
  });

  it('covers selling topics for a seller-flavored question', () => {
    const reply = cannedAgentReply('How do I start selling on Brandthread?');
    expect(reply.text.toLowerCase()).toMatch(/seller hub|listing|shopify/);
    expect(reply.text).toBe("Start from the Seller Hub — list a product in a couple of minutes, or import your catalog from Shopify. Go live when you're ready to sell in real time; payouts arrive once orders ship.");
  });

  it('offers a discover card for a "find me brands" question', () => {
    const reply = cannedAgentReply("Find me some brands I'd like");
    expect(reply.cardKind).toBe('discover');
    expect(reply.text).toBe("Open Discover — new drops and brands picked for you. The more you browse, the better it gets.");
  });

  it('always returns non-empty text for an unrecognized message', () => {
    const reply = cannedAgentReply('asdkjfhaskjdfh');
    expect(reply.text).toBe("I can help with brands, orders, Thread Cash, or anything else in the app. What do you need?");
  });

  it.each(['Just browsing for now', 'Just vibing', 'browsing'])('acknowledges %s without slang', (text) => {
    expect(cannedAgentReply(text).text).toBe("Sounds good. I'm here whenever you need anything.");
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
