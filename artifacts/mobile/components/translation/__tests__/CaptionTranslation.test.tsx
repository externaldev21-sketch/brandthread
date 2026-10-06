import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';

const h = vi.hoisted(() => ({
  push: vi.fn(),
  translate: vi.fn(),
  prefs: { translationLanguage: 'en', autoTranslateCaptions: false, textSize: 'default', highContrastIcons: false },
  syncsToAccount: true,
}));

vi.mock('react-native', () => ({ Text: (_props: Record<string, unknown>) => null }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('@/lib/api', () => ({ useApi: () => ({ translate: h.translate }) }));
vi.mock('@/contexts/DisplayPrefsContext', () => ({
  useDisplayPrefs: () => ({ prefs: h.prefs, syncsToAccount: h.syncsToAccount, update: async () => {} }),
}));

import { useCaptionTranslation, type CaptionTranslation } from '../CaptionTranslation';

const SPANISH = 'Hola amigos, el nuevo drop ya está aquí para todos';
let latest: CaptionTranslation;
function Probe({ text }: { text: string }) {
  latest = useCaptionTranslation(text);
  return null;
}

async function mount(text: string) {
  await act(async () => { TestRenderer.create(<Probe text={text} />); });
}

beforeEach(() => {
  h.push.mockReset();
  h.translate.mockReset();
  h.prefs = { ...h.prefs, autoTranslateCaptions: false, translationLanguage: 'en' };
  h.syncsToAccount = true;
});

describe('useCaptionTranslation', () => {
  it('offers nothing for text already in the viewer language', async () => {
    await mount('The new drop is live for you');
    expect(latest.linkLabel).toBeNull();
  });

  it('signed-out preview: the link opens sign-in and never calls the protected API', async () => {
    h.syncsToAccount = false;
    h.prefs = { ...h.prefs, autoTranslateCaptions: true };
    await mount(`${SPANISH} 1`);
    expect(latest.linkLabel).toBe('See translation');
    await act(async () => { latest.onPressLink(); });
    expect(h.push).toHaveBeenCalledWith('/sign-in');
    expect(h.translate).not.toHaveBeenCalled();
  });

  it('signed in: See translation fetches and shows it, See original goes back', async () => {
    h.translate.mockResolvedValue({ targetLanguage: 'en', translations: [{ text: `${SPANISH} 2`, translatedText: 'Hello friends', detectedLanguage: 'es', sameLanguage: false }] });
    await mount(`${SPANISH} 2`);
    await act(async () => { latest.onPressLink(); });
    expect(h.translate).toHaveBeenCalledWith([`${SPANISH} 2`], 'en');
    expect(latest.text).toBe('Hello friends');
    expect(latest.linkLabel).toBe('See original');
    await act(async () => { latest.onPressLink(); });
    expect(latest.text).toBe(`${SPANISH} 2`);
  });

  it('auto-translate translates without a tap', async () => {
    h.prefs = { ...h.prefs, autoTranslateCaptions: true };
    h.translate.mockResolvedValue({ targetLanguage: 'en', translations: [{ text: `${SPANISH} 3`, translatedText: 'Hello all', detectedLanguage: 'es', sameLanguage: false }] });
    await mount(`${SPANISH} 3`);
    expect(h.translate).toHaveBeenCalledTimes(1);
    expect(latest.text).toBe('Hello all');
  });
});
