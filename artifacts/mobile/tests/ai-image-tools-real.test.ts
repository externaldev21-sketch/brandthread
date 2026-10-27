/**
 * AI image tools, for real (Remove Background, Mockup to Model, AI Photoshoot):
 * the one-screen removal flow with its sparkle, the photoshoot contract that
 * keeps the seller's product photos and references apart, the dock inset fix,
 * cancellation on leave, and the copy a seller sees when the image model is
 * not switched on yet or the daily cap is hit.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/aiCredits', () => ({ OUT_OF_CREDITS_ROUTE: '/ai-credits' }));

import { AI_IMAGE_ENGINE_OFF_COPY, aiToolErrorMessage } from '@/components/ai-tools/aiToolErrorMessage';
import { AI_CREDITS_ALERT_COPY, classifyAiCreditsError } from '@/lib/aiCreditsError';

const ROOT = resolve(__dirname, '..');
const read = (file: string) => readFileSync(resolve(ROOT, file), 'utf8');

describe('Remove Background: one screen', () => {
  const src = read('app/design-bg-removal.tsx');

  it('starts removal as soon as a photo is picked, with no second tap', () => {
    expect(src).toContain('runRemovalRef.current?.({ ...p, w, h });');
    expect(src).not.toContain('onPress={handleRemove}');
  });

  it('offers Save, Share, Use and the optional Refine brush on the same screen', () => {
    for (const id of ['bg-removal-save', 'bg-removal-share', 'bg-removal-use', 'bg-removal-refine']) expect(src).toContain(`testID="${id}"`);
    expect(src).toContain('<BgRefineCanvas');
    expect(src).not.toMatch(/router\.push\(/); // no multi-step navigation
  });

  it('gives the empty state words and the pinned button a job', () => {
    expect(src).toContain('Tap to choose a photo');
    expect(src).toContain('label="Choose a photo"');
  });

  it("shows the credit gate's own copy for the daily cap, which says it resets tomorrow", () => {
    expect(src).toContain('classifyAiCreditsError(resp.status');
    expect(src).toContain('AI_CREDITS_ALERT_COPY[creditsKind].message');
    const body = JSON.stringify({ error: "You have reached today's AI limit. It resets tomorrow.", code: 'user_daily_cap' });
    const kind = classifyAiCreditsError(429, body);
    expect(kind).toBe('user_daily_cap');
    expect(AI_CREDITS_ALERT_COPY.user_daily_cap.message).toMatch(/resets tomorrow/);
  });
});

describe('Remove Background: sparkle', () => {
  const src = read('components/ai-tools/BgRemovalGlowSweep.tsx');

  it('keeps the cutout as the top layer so only the background sparkles, and ends on a silver rim glisten', () => {
    const rim = src.indexOf('tintColor: SILVER_LIGHT');
    const top = src.lastIndexOf('<Image source={{ uri: cutoutUri }}');
    expect(rim).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(rim);
    expect(src).toContain('GLISTEN_MS');
    expect(src).toContain('<Checkerboard />');
  });

  it('stays black, white and silver', () => {
    const hexes = [...src.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0].toUpperCase());
    expect(new Set(hexes)).toEqual(new Set(['#FFFFFF', '#C0C0C0', '#E6E6E6', '#000000']));
    for (const m of src.matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+)/g)) {
      expect(m[1]).toBe(m[2]); // greys only: r = g = b
      expect(m[2]).toBe(m[3]);
    }
  });

  it('respects reduced motion', () => {
    expect(src).toContain('useReducedMotion()');
    expect(src).toMatch(/if \(reduceMotion\) \{\s*dissolving\.value = 1;/);
  });
});

describe('Mockup to Model and AI Photoshoot screens', () => {
  const m2m = read('app/design-mockup-to-model.tsx');
  const shoot = read('app/design-ai-photoshoot.tsx');

  it('pin the Create/Generate dock to the safe area, not the hidden tab bar height', () => {
    for (const src of [m2m, shoot]) {
      expect(src).not.toContain("from '@/hooks/useSellerTabBarInset'");
      expect(src).toContain('const bottomInset = useScreenBottomInset();');
      expect(src).toContain('bottomInset={bottomInset}');
    }
  });

  it('cancel in-flight generation when the seller leaves', () => {
    expect(m2m).toContain('useEffect(() => () => cancelBatch(), []);');
    expect(m2m).toContain('signal: controller.signal');
    expect(shoot).toContain('useEffect(() => () => cancelRun(), []);');
    expect(shoot).toContain('signal: controller.signal');
    expect(shoot).toMatch(/function backToSetup\(\) \{\s*cancelRun\(\);/);
  });

  it('AI Photoshoot sends product photos and references separately, with separate budgets', () => {
    expect(shoot).toContain('preparePhotoshootPhotos({ productImageUris, referenceUris: refUris })');
    expect(shoot).toContain('generatePhotoshootShot({ ...run, shotIndex: i, signal: controller.signal })');
    expect(shoot).toContain('const MAX_PRODUCT_PHOTOS = PHOTOSHOOT_MAX_PRODUCT_PHOTOS;');
    expect(shoot).toContain('const MAX_REF_PHOTOS = PHOTOSHOOT_MAX_REFERENCE_PHOTOS;');
    expect(shoot).not.toContain('PHOTOSHOOT_MAX_IMAGES');
  });

  it('keeps the audit fixes: ratio chips, Model label, product tile fallback + caption, products loaded in an effect', () => {
    expect(shoot).toContain("{ value: '9:16', label: '9:16' }");
    expect(shoot).toContain('>Model</Text>');
    expect(shoot).toContain('onError={() => setBrokenThumbs(prev => new Set(prev).add(p.id))}');
    expect(shoot).toContain("{p.name || 'Untitled product'}");
    expect(shoot).toMatch(/useEffect\(\(\) => \{\s*let alive = true;\s*getProducts\(\)/);
  });
});

describe('seller copy for AI failures', () => {
  it('says AI photos are not switched on yet (and nothing was charged) when the image model key is missing', () => {
    const err = { status: 503, body: JSON.stringify({ code: 'ai_image_engine_not_configured', missingKey: 'GEMINI_API_KEY' }), message: 'API 503: x' };
    expect(aiToolErrorMessage(err, 'fallback')).toBe(AI_IMAGE_ENGINE_OFF_COPY);
    expect(AI_IMAGE_ENGINE_OFF_COPY).not.toMatch(/GEMINI|key/i); // never shows a secret's name to sellers
  });

  it('keeps the generic outage copy for other 503s', () => {
    expect(aiToolErrorMessage({ status: 503, body: '{}' }, 'fallback')).toMatch(/temporarily unavailable/);
  });
});

describe('result tiles when AI photos are switched off', () => {
  it('marks the engine-off failure as not retryable, and keeps Retry for everything else', async () => {
    const { aiToolFailure } = await import('@/components/ai-tools/aiToolErrorMessage');
    expect(aiToolFailure(AI_IMAGE_ENGINE_OFF_COPY)).toEqual({ error: AI_IMAGE_ENGINE_OFF_COPY, retryable: false });
    expect(aiToolFailure('Generation failed. Please try again.').retryable).toBe(true);
    const grid = read('components/ai-tools/AiResultsGrid.tsx');
    expect(grid).toContain("{slot.retryable !== false && (");
    expect(grid).toContain('<View style={[s.tile, s.tileFailed, tileW]}>'); // a failed tile keeps its column width
  });
});
