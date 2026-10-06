import { describe, expect, it } from 'vitest';
import { dmCallModeFromType, dmCallScreenHref, resolveDmCallRoute } from '../dmCallLinks';

describe('resolveDmCallRoute', () => {
  it('uses the simulated call only in the &demo=1 preview', () => {
    expect(resolveDmCallRoute({ demo: true, preview: true, platform: 'web', configured: false })).toBe('simulated');
  });

  it('hides call buttons in a fresh preview and on web', () => {
    expect(resolveDmCallRoute({ demo: false, preview: true, platform: 'web', configured: true })).toBe('hidden');
    expect(resolveDmCallRoute({ demo: false, preview: false, platform: 'web', configured: true })).toBe('hidden');
  });

  it('hides call buttons on native when the server has no Agora credentials', () => {
    expect(resolveDmCallRoute({ demo: false, preview: false, platform: 'ios', configured: false })).toBe('hidden');
  });

  it('uses the real Agora call on native when calling is configured', () => {
    expect(resolveDmCallRoute({ demo: false, preview: false, platform: 'ios', configured: true })).toBe('agora');
    expect(resolveDmCallRoute({ demo: false, preview: false, platform: 'android', configured: true })).toBe('agora');
  });
});

describe('dmCallScreenHref', () => {
  it('links the caller to the real call screen as a DM call', () => {
    const href = dmCallScreenHref({ conversationId: 'conv 1', mode: 'video', participantName: 'Maison Vela', participantInitials: 'MV' });
    const url = new URL(href, 'https://x.test');
    expect(url.pathname).toBe('/call-screen');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      conversationId: 'conv 1', mode: 'video', participantName: 'Maison Vela', dmCall: '1', participantInitials: 'MV',
    });
  });

  it('marks the callee as answering so the caller is never re-rung', () => {
    const url = new URL(dmCallScreenHref({ conversationId: 'c', mode: 'voice', participantName: 'A', answer: true }), 'https://x.test');
    expect(url.searchParams.get('answer')).toBe('1');
  });
});

describe('dmCallModeFromType', () => {
  it('reads the mode from the ring notification type', () => {
    expect(dmCallModeFromType('dm_call_video')).toBe('video');
    expect(dmCallModeFromType('dm_call_voice')).toBe('voice');
    expect(dmCallModeFromType(undefined)).toBe('voice');
  });
});
