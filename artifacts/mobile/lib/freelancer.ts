/**
 * Freelancer marketplace shared constants + helpers (Community tab).
 */
import type { Feather } from '@expo/vector-icons';
import { formatCents } from './money';
import { ApiError } from './networkNotice';

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
  return `${formatCents(cents)}/hr`;
}

/** 25000 → "$250.00" */
export function formatPrice(cents: number): string {
  return formatCents(cents);
}

/** avgRatingTenths 48 → "4.8"; 0/null → null (no reviews yet) */
export function ratingLabel(tenths: number | null | undefined): string | null {
  if (!tenths || tenths <= 0) return null;
  return (tenths / 10).toFixed(1);
}

const GENERIC_ERROR_FALLBACK = 'Something went wrong. Try again.';

/**
 * Human-readable message from an api.ts error. Never surfaces the raw
 * "API 4xx: ..." wire format, a 5xx/infra message, or this app's own
 * audit/e2e fake-API 'NOT_SEEDED' placeholder text — those all fall back to
 * a generic, friendly message instead.
 */
export function apiErrorMessage(e: unknown, fallback: string = GENERIC_ERROR_FALLBACK): string {
  if (e instanceof ApiError) {
    if (e.code === 'NOT_SEEDED') return fallback;
    const message = e.message.replace(/^API \d{3}:\s*/, '').trim();
    if (e.status >= 500 || !message) return fallback;
    return message;
  }
  return fallback;
}

/** True when the error body carries a specific error `code`. */
export function apiErrorCode(e: unknown): string | null {
  return e instanceof ApiError ? e.code ?? null : null;
}
