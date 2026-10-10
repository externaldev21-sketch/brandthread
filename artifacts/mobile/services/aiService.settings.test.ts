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

import {
  _resetSessionForTest,
  getAISettings,
  getAISuggestions,
  loadSession,
  pushAISettings,
  sendMessage,
  sendPreviewMessageStream,
  syncAISettingsFromServer,
} from './aiService';
import { DEFAULT_AI_SETTINGS } from './aiTypes';

const SETTINGS_KEY = 'bt:ai:settings:v1';
const PENDING_KEY = 'bt:ai:settings:pending:v1';

function setLocal(over: Record<string, unknown>) {
  store[SETTINGS_KEY] = JSON.stringify({ ...DEFAULT_AI_SETTINGS, ...over });
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  calls = [];
  respond = () => ({ status: 200, body: { content: 'ok' } });
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.test';
  _resetSessionForTest();
});

describe('Enable AI assistant', () => {
  it('refuses to send and never calls the API when off', async () => {
    setLocal({ enabled: false });
    const session = await loadSession({ screen: 'home' });
    await expect(sendMessage({ userText: 'hi', session, authToken: 'tok' })).rejects.toMatchObject({ name: 'AIDisabledError' });
    expect(calls).toHaveLength(0);
  });

  it('refuses in the local preview path too', async () => {
    setLocal({ enabled: false });
    const session = await loadSession({ screen: 'home' });
    await expect(sendPreviewMessageStream({ userText: 'hi', session }, () => {})).rejects.toMatchObject({ name: 'AIDisabledError' });
  });

  it('maps the server AI_DISABLED refusal and mirrors it in the cache', async () => {
    respond = () => ({ status: 403, body: { error: 'off', code: 'AI_DISABLED' } });
    const session = await loadSession({ screen: 'home' });
    await expect(sendMessage({ userText: 'hi', session, authToken: 'tok' })).rejects.toMatchObject({ name: 'AIDisabledError' });
    expect((await getAISettings()).enabled).toBe(false);
  });

  it('still treats a plain 403 as an auth error', async () => {
    respond = () => ({ status: 403, body: { error: 'Forbidden' } });
    const session = await loadSession({ screen: 'home' });
    await expect(sendMessage({ userText: 'hi', session, authToken: 'tok' })).rejects.toThrow(/Authentication error/);
  });
});

describe('chat request', () => {
  it('sends brand memory and the device settings when Brand Memory is on', async () => {
    setLocal({ dataSources: { ...DEFAULT_AI_SETTINGS.dataSources, customers: false } });
    const session = await loadSession({ screen: 'home' });
    await sendMessage({ userText: 'hi', session, authToken: 'tok' });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.brandMemory).toEqual({ brandVoice: 'Confident' });
    expect(body.aiSettings.dataSources.customers).toBe(false);
  });

  it('omits brand memory when Brand Memory is off', async () => {
    setLocal({ brandMemoryEnabled: false });
    const session = await loadSession({ screen: 'home' });
    await sendMessage({ userText: 'hi', session, authToken: 'tok' });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.brandMemory).toBeUndefined();
    expect(body.aiSettings.brandMemoryEnabled).toBe(false);
  });
});

describe('Dashboard suggestions', () => {
  const suggestions = [
    { id: 'a', title: 'Restock', reason: '', expectedImpact: '', actionLabel: '', category: 'inventory', priority: 'high' },
    { id: 'b', title: 'Ship', reason: '', expectedImpact: '', actionLabel: '', category: 'orders', priority: 'high' },
  ];

  it('does not fetch when suggestions are off', async () => {
    setLocal({ suggestionsEnabled: false });
    expect(await getAISuggestions('tok', 'u1')).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('does not fetch when the assistant is off', async () => {
    setLocal({ enabled: false });
    expect(await getAISuggestions('tok', 'u1')).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('drops categories whose data source is off', async () => {
    setLocal({ dataSources: { ...DEFAULT_AI_SETTINGS.dataSources, inventory: false } });
    respond = () => ({ status: 200, body: { suggestions } });
    const out = await getAISuggestions('tok', 'u1');
    expect(out.map(s => s.id)).toEqual(['b']);
  });
});

describe('account sync', () => {
  it('pushes to the account and clears the pending marker on success', async () => {
    const ok = await pushAISettings({ ...DEFAULT_AI_SETTINGS, confirmSending: false }, async () => 'tok');
    expect(ok).toBe(true);
    expect(calls[0].url).toBe('https://api.test/api/v1/ai/settings');
    expect(calls[0].init?.method).toBe('PUT');
    expect(JSON.parse(String(calls[0].init?.body)).settings.confirmSending).toBe(false);
    expect(store[PENDING_KEY]).toBeUndefined();
    expect((await getAISettings()).confirmSending).toBe(false);
  });

  it('keeps the change cached and pending when the server is unreachable', async () => {
    respond = () => ({ status: 503, body: {} });
    const ok = await pushAISettings({ ...DEFAULT_AI_SETTINGS, enabled: false }, 'tok');
    expect(ok).toBe(false);
    expect(store[PENDING_KEY]).toBeDefined();
    expect((await getAISettings()).enabled).toBe(false);
  });

  it('pulls the account copy into the cache', async () => {
    respond = () => ({ status: 200, body: { settings: { ...DEFAULT_AI_SETTINGS, suggestionsEnabled: false }, updatedAt: '2026-01-01T00:00:00Z' } });
    const out = await syncAISettingsFromServer('tok');
    expect(out?.suggestionsEnabled).toBe(false);
    expect((await getAISettings()).suggestionsEnabled).toBe(false);
  });

  it('a pending local change wins over the (stale) account copy and is re-sent', async () => {
    setLocal({ enabled: false });
    store[PENDING_KEY] = 'x';
    respond = (_url, init) => init?.method === 'PUT'
      ? { status: 200, body: {} }
      : { status: 200, body: { settings: DEFAULT_AI_SETTINGS, updatedAt: '2026-01-01T00:00:00Z' } };
    const out = await syncAISettingsFromServer('tok');
    expect(out?.enabled).toBe(false);
    expect(calls.some(c => c.init?.method === 'PUT')).toBe(true);
    expect(store[PENDING_KEY]).toBeUndefined();
  });

  it('does nothing without a token', async () => {
    expect(await syncAISettingsFromServer(null)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
