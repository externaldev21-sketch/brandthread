/**
 * aiService audit fixes: duplicate repair only drops true double-writes,
 * a finished turn never replaces another account's session in memory,
 * Stop before the stream request is sent, "Clear history" without ids,
 * a hung settings PUT can't block later ones, and an empty suggestions answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, string> = {};
let onGetItem: ((key: string) => void) | null = null;
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => { onGetItem?.(key); return Promise.resolve(store[key] ?? null); },
    setItem: (key: string, val: string) => { store[key] = val; return Promise.resolve(); },
    removeItem: (key: string) => { delete store[key]; return Promise.resolve(); },
  },
}));
vi.mock('./aiBrandMemory', () => ({ getEnabledMemorySummary: () => Promise.resolve({}) }));
vi.mock('./aiAuditLog', () => ({ addAuditEntry: () => Promise.resolve() }));
vi.mock('../lib/previewAiBrain', () => ({ getPreviewAiReply: () => 'preview reply' }));
vi.mock('@/lib/devPreview', () => ({ isSellerDevPreview: () => false }));

let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
vi.stubGlobal('fetch', (url: string, init?: RequestInit) => fetchImpl(url, init));
const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) } as unknown as Response);

import {
  _resetSessionForTest, clearSession, getAISuggestions, loadSession, pushAISettings, sendMessage,
  sendMessageStream, cancelGeneration,
} from './aiService';
import { DEFAULT_AI_SETTINGS } from './aiTypes';

beforeEach(() => {
  onGetItem = null;
  for (const k of Object.keys(store)) delete store[k];
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.test';
  fetchImpl = () => ok({ content: 'ok' });
  _resetSessionForTest();
});
afterEach(() => { vi.useRealTimers(); });

describe('session repair', () => {
  it('keeps the same question asked again later in the conversation', async () => {
    store['bt:ai:session:v2:u1:default'] = JSON.stringify({
      id: 's', context: { screen: 'general' }, createdAt: 1, updatedAt: 1,
      messages: [
        { id: 'a', role: 'user', content: 'thanks', ts: 1_000 },
        { id: 'b', role: 'assistant', content: 'Anything else?', ts: 2_000 },
        { id: 'c', role: 'user', content: 'thanks', ts: 600_000 },
        { id: 'd', role: 'assistant', content: 'Anything else?', ts: 601_000 },
      ],
    });
    const session = await loadSession({ screen: 'general' }, 'u1');
    expect(session.messages.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('still drops a double-written message right after itself', async () => {
    store['bt:ai:session:v2:u1:default'] = JSON.stringify({
      id: 's', context: { screen: 'general' }, createdAt: 1, updatedAt: 1,
      messages: [
        { id: 'a', role: 'user', content: 'hi', ts: 1_000 },
        { id: 'a2', role: 'user', content: 'hi', ts: 1_500 },
        { id: 'b', role: 'assistant', content: 'hello', ts: 2_000 },
      ],
    });
    const session = await loadSession({ screen: 'general' }, 'u1');
    expect(session.messages.map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('account switch during a turn', () => {
  it("does not put user A's finished turn in user B's in-memory session", async () => {
    let release!: () => void;
    fetchImpl = () => new Promise<Response>((resolve) => { release = () => resolve(ok({ content: 'for A' }) as unknown as Response); });
    const sA = await loadSession({ screen: 'general' }, 'userA');
    const turn = sendMessage({ userText: 'A asks', session: sA, authToken: 'tok', userId: 'userA' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    // Account switch: the screen loads B's (empty) session while A's reply is in flight.
    const sB = await loadSession({ screen: 'general' }, 'userB');
    expect(sB.messages).toHaveLength(0);
    release();
    await turn;
    const again = await loadSession({ screen: 'general' }, 'userB');
    expect(again.messages).toHaveLength(0);
  });
});

describe('streaming Stop before the request is sent', () => {
  it('never sends a request that was cancelled while it was being built', async () => {
    const sent: unknown[] = [];
    class FakeXHR {
      readyState = 0; status = 0; responseText = '';
      onreadystatechange: (() => void) | null = null;
      onerror: (() => void) | null = null;
      timeout = 0; ontimeout: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send(body: unknown) { sent.push(body); }
      abort() {}
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    const session = await loadSession({ screen: 'general' }, 'u1');
    // Stop lands while the request body is being built (its settings read —
    // the second settings read of the turn, after the controller exists).
    let settingsReads = 0;
    onGetItem = (key) => {
      if (key.startsWith('bt:ai:settings:v1') && ++settingsReads === 2) cancelGeneration();
    };
    const turn = sendMessageStream({ userText: 'hi', session, authToken: 'tok', userId: 'u1' }, () => {});
    await expect(turn).rejects.toMatchObject({ name: 'AbortError' });
    onGetItem = null;
    expect(sent).toHaveLength(0);
  });
});

describe('clear history from AI Settings (no ids)', () => {
  it("removes the loaded account's conversation, not the signed-out slot", async () => {
    store['bt:ai:session:v2:u1:own'] = JSON.stringify({
      id: 's', context: { screen: 'general' }, createdAt: 1, updatedAt: 1,
      messages: [{ id: 'a', role: 'user', content: 'secret', ts: 1 }],
    });
    await loadSession({ screen: 'general' }, 'u1', 'own');
    await clearSession();
    expect(store['bt:ai:session:v2:u1:own']).toBeUndefined();
  });
});

describe('settings push', () => {
  it('a hung PUT times out instead of blocking every later settings change', async () => {
    vi.useFakeTimers();
    let calls = 0;
    fetchImpl = (_url, init) => {
      calls += 1;
      if (calls === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      }
      return ok({});
    };
    const first = pushAISettings({ ...DEFAULT_AI_SETTINGS, confirmSending: false }, 'tok');
    const second = pushAISettings({ ...DEFAULT_AI_SETTINGS, confirmSending: true }, 'tok');
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
  });
});

describe('dashboard suggestions', () => {
  it('an empty server answer replaces the cached suggestions', async () => {
    store['bt:ai:suggestions:v1:u1'] = JSON.stringify([
      { id: 'old', title: 'Restock', reason: '', expectedImpact: '', actionLabel: '', category: 'orders', priority: 'high' },
    ]);
    fetchImpl = () => ok({ suggestions: [] });
    expect(await getAISuggestions('tok', 'u1')).toEqual([]);
  });
});
