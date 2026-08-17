/**
 * Freelancer marketplace shared constants + helpers (Community tab).
 */
import type { Feather } from '@expo/vector-icons';

export const FREELANCER_SERVICE_TYPES: {
  value: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
}[] = [
  { value: 'graphic_design', label: 'Graphic Design', icon: 'pen-tool' },
  { value: 'copywriting',    label: 'Copywriting',    icon: 'edit-3' },
  { value: 'social_media',   label: 'Social Media',   icon: 'share-2' },
  { value: 'photography',    label: 'Photography',    icon: 'camera' },
  { value: 'video_editing',  label: 'Video Editing',  icon: 'video' },
  { value: 'web_design',     label: 'Web Design',     icon: 'layout' },
  { value: 'branding',       label: 'Branding',       icon: 'layers' },
];

export function serviceLabel(value: string | undefined | null): string {
  if (!value) return 'Creative';
  return FREELANCER_SERVICE_TYPES.find((t) => t.value === value)?.label ?? 'Creative';
}

export function serviceIcon(value: string | undefined | null): keyof typeof Feather.glyphMap {
  return FREELANCER_SERVICE_TYPES.find((t) => t.value === value)?.icon ?? 'star';
}

/** 8000 → "$80/hr", 5550 → "$55.50/hr" */
export function formatHourlyRate(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}/hr`;
}

/** 25000 → "$250.00" */
export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** avgRatingTenths 48 → "4.8"; 0/null → null (no reviews yet) */
export function ratingLabel(tenths: number | null | undefined): string | null {
  if (!tenths || tenths <= 0) return null;
  return (tenths / 10).toFixed(1);
}

/**
 * Extracts a human-readable message from api.ts errors, which look like
 * `Error: API 409: {"error":"...","code":"..."}`.
 */
export function apiErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const jsonStart = msg.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(msg.slice(jsonStart));
      if (parsed?.error) return String(parsed.error);
    } catch {
      // fall through to raw message
    }
  }
  return msg;
}

/** True when the error body carries a specific error `code`. */
export function apiErrorCode(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : String(e);
  const jsonStart = msg.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(msg.slice(jsonStart));
      if (parsed?.code) return String(parsed.code);
    } catch {}
  }
  return null;
}
