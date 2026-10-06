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

  // Derives brand voice from the seller's actual products/posts/store. On any
  // failure this throws (the caller shows "Could not rebuild") — it never
  // fills the seller's brand memory with made-up demo values.
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
  if (!API_BASE || !authToken) throw new Error('Sign in to rebuild brand memory.');
  const res = await fetch(`${API_BASE}/api/ai/brand-memory/rebuild`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Brand memory rebuild failed (${res.status})`);
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
  for (const [apiKey, value] of Object.entries(fields ?? {})) {
    const memKey = keyMap[apiKey];
    if (memKey && value?.trim()) {
      memory[memKey] = { ...memory[memKey], value: value.trim(), enabled: true };
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
