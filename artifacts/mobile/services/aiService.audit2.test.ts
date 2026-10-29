/**
 * QA-0041 — aiService honors AI Settings and syncs them to the account.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, string> = {};

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(store[key] ?? null),
    setItem: (key: string, val: string) => { store[key] = val; return Promise.resolve(); },
    removeItem: (key: string) => { delete store[key]; return Promise.resolve(); },
  },
}));

vi.mock('./aiBrandMemory', () => ({
  getEnabledMemorySummary: () => Promise.resolve({ brandVoice: 'Confident' }),
}));

vi.mock('./aiAuditLog', () => ({
  addAuditEntry: () => Promise.resolve(),
}));

vi.mock('../lib/previewAiBrain', () => ({ getPreviewAiReply: () => 'preview reply' }));
// lib/devPreview pulls in react-native; these tests are the signed-in path.
vi.mock('@/lib/devPreview', () => ({ isSellerDevPreview: () => false }));

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let respond: (url: string, init?: RequestInit) => { status: number; body: unknown } = () => ({ status: 200, body: { content: 'ok' } });

vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
  calls.push({ url, init });
  const { status, body } = respond(url, init);
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
});

import { completeSuggestion, getAISuggestions } from './aiService';
import { DEFAULT_AI_SETTINGS } from './aiTypes';

const SETTINGS_KEY = 'bt:ai:settings:v1:u:anon';

describe('getAISuggestions after completeSuggestion', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.test';
    calls = [];
    store[SETTINGS_KEY] = JSON.stringify({ ...DEFAULT_AI_SETTINGS });
  });

  it('keeps a completed suggestion hidden across API refetches', async () => {
    const suggestions = [
      { id: 'a', title: 'Restock', reason: '', expectedImpact: '', actionLabel: '', category: 'orders', priority: 'high' },
      { id: 'b', title: 'Ship', reason: '', expectedImpact: '', actionLabel: '', category: 'orders', priority: 'high' },
    ];
    respond = () => ({ status: 200, body: { suggestions } });
    expect((await getAISuggestions('tok', 'u1')).map(s => s.id)).toEqual(['a', 'b']);
    await completeSuggestion('a', 'u1');
    expect((await getAISuggestions('tok', 'u1')).map(s => s.id)).toEqual(['b']);
    // and still hidden on the refetch after that (the marker survived the cache rewrite)
    expect((await getAISuggestions('tok', 'u1')).map(s => s.id)).toEqual(['b']);
  });
});
