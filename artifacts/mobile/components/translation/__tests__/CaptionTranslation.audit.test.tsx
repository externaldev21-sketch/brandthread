import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';

const h = vi.hoisted(() => ({
  push: vi.fn(),
  translate: vi.fn(),
  prefs: { translationLanguage: 'en', autoTranslateCaptions: true, textSize: 'default', highContrastIcons: false },
}));

vi.mock('react-native', () => ({ Text: (_props: Record<string, unknown>) => null }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('@/lib/api', () => ({ useApi: () => ({ translate: h.translate }) }));
vi.mock('@/contexts/DisplayPrefsContext', () => ({
  useDisplayPrefs: () => ({ prefs: h.prefs, syncsToAccount: true, update: async () => {} }),
}));

import { useCaptionTranslation, type CaptionTranslation } from '../CaptionTranslation';

let latest: CaptionTranslation;
function Probe({ text }: { text: string }) {
  latest = useCaptionTranslation(text);
  return null;
}

beforeEach(() => {
  h.translate.mockReset();
});

describe('useCaptionTranslation (audit)', () => {
  it('never shows an earlier caption\'s translation once the caption changed (recycled feed row)', async () => {
    const A = 'Hola amigos, el nuevo drop ya está aquí para todos audit-a';
    const B = 'Bonjour à tous, la nouvelle collection est enfin arrivée audit-b';
    let resolveA!: (v: unknown) => void;
    h.translate.mockImplementation((texts: string[]) => {
      if (texts[0] === A) return new Promise((r) => { resolveA = r; });
      return new Promise(() => {}); // B never answers in this test
    });
    let root!: TestRenderer.ReactTestRenderer;
    await act(async () => { root = TestRenderer.create(<Probe text={A} />); });
    expect(h.translate).toHaveBeenCalledWith([A], 'en');
    // The row is recycled for caption B before A's translation lands.
    await act(async () => { root.update(<Probe text={B} />); });
    await act(async () => {
      resolveA({ targetLanguage: 'en', translations: [{ text: A, translatedText: 'Hello friends (A)', detectedLanguage: 'es', sameLanguage: false }] });
    });
    expect(latest.text).toBe(B);
  });
});
