/**
 * Brandthread AI Brain — Brand Memory Service
 *
 * Seller-controlled brand memory stored in AsyncStorage.
 * Only enabled fields are passed to the AI as context.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BrandMemory, BrandMemoryField, BrandMemorySummary, DEFAULT_BRAND_MEMORY,
} from './aiTypes';

const MEMORY_KEY = 'bt:ai:brand-memory:v1';

// ─── Load ─────────────────────────────────────────────────────────────────────

export async function getBrandMemory(): Promise<BrandMemory> {
  try {
    const raw = await AsyncStorage.getItem(MEMORY_KEY);
    if (!raw) return { ...DEFAULT_BRAND_MEMORY };
    const parsed = JSON.parse(raw) as Partial<BrandMemory>;
    // Merge with defaults so new fields are always present
    const result = { ...DEFAULT_BRAND_MEMORY } as BrandMemory;
    for (const k of Object.keys(result) as (keyof BrandMemory)[]) {
      if (parsed[k]) result[k] = { ...result[k], ...parsed[k] };
    }
    return result;
  } catch {
    return { ...DEFAULT_BRAND_MEMORY };
  }
}

// ─── Save ─────────────────────────────────────────────────────────────────────

export async function saveBrandMemory(memory: BrandMemory): Promise<void> {
  await AsyncStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
}

export async function updateMemoryField(
  key: keyof BrandMemory,
  updates: Partial<BrandMemoryField>,
): Promise<BrandMemory> {
  const memory = await getBrandMemory();
  memory[key] = { ...memory[key], ...updates } as BrandMemoryField;
  await saveBrandMemory(memory);
  return memory;
}

export async function toggleMemoryField(key: keyof BrandMemory): Promise<BrandMemory> {
  const memory = await getBrandMemory();
  memory[key] = { ...memory[key], enabled: !memory[key].enabled };
  await saveBrandMemory(memory);
  return memory;
}

// ─── Clear ────────────────────────────────────────────────────────────────────

export async function clearBrandMemory(): Promise<BrandMemory> {
  const fresh = { ...DEFAULT_BRAND_MEMORY };
  await saveBrandMemory(fresh);
  return fresh;
}

// ─── Rebuild from real DB data (via API) ─────────────────────────────────────

export async function rebuildBrandMemory(authToken?: string | null): Promise<BrandMemory> {
  const memory = await getBrandMemory();

  // Try real API first — derives brand voice from seller's actual products/posts/store
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
  if (API_BASE && authToken) {
    try {
      const res = await fetch(`${API_BASE}/ai/brand-memory/rebuild`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const { fields } = await res.json() as { fields: Record<string, string> };
        const keyMap: Partial<Record<string, keyof BrandMemory>> = {
          brandDescription:  'brandDescription',
          brandVoice:        'brandVoice',
          targetAudience:    'targetAudience',
          pricePosition:     'pricePosition',
          visualStyle:       'visualStyle',
          marketingTone:     'marketingTone',
          preferredWords:    'preferredWords',
          productCategories: 'productCategories',
        };
        for (const [apiKey, value] of Object.entries(fields)) {
          const memKey = keyMap[apiKey];
          if (memKey && value?.trim()) {
            memory[memKey] = { ...memory[memKey], value: value.trim(), enabled: true };
          }
        }
        await saveBrandMemory(memory);
        return memory;
      }
    } catch { /* fall through to demo defaults */ }
  }

  // Fallback: pre-fill with sensible demo defaults if fields are empty
  const demoValues: Partial<Record<keyof BrandMemory, string>> = {
    brandDescription:  'Premium streetwear brand focused on elevated basics and limited drops.',
    brandVoice:        'Confident, concise, luxury-adjacent. Never corporate.',
    targetAudience:    'Style-conscious 18–34 year olds who value quality over hype.',
    pricePosition:     'Mid-to-high. $50–$250 range. Compete on quality and brand story.',
    visualStyle:       'Dark, minimal, high-contrast. Studio photography. No lifestyle clutter.',
    marketingTone:     'Direct and premium. No exclamation marks. No emojis in copy.',
    productCategories: 'Hoodies, tees, joggers, outerwear, accessories.',
  };
  for (const [k, v] of Object.entries(demoValues)) {
    const key = k as keyof BrandMemory;
    if (!memory[key].value && v) {
      memory[key] = { ...memory[key], value: v, enabled: true };
    }
  }
  await saveBrandMemory(memory);
  return memory;
}

// ─── Summary (enabled fields only) ───────────────────────────────────────────

export async function getEnabledMemorySummary(): Promise<BrandMemorySummary> {
  const memory = await getBrandMemory();
  const summary: BrandMemorySummary = {};
  for (const [k, field] of Object.entries(memory) as [keyof BrandMemory, BrandMemoryField][]) {
    if (field.enabled && field.value.trim()) {
      summary[k] = field.value;
    }
  }
  return summary;
}
