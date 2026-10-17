/**
 * Metafield definition helpers shared by metafields.tsx and
 * metafield-definitions.tsx. Mirrors the server rules in
 * api-server/src/routes/seller-metafields.ts (KEY_RE, METAFIELD_TYPES).
 */

export const METAFIELD_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'single_line_text_field', label: 'Single line text' },
  { value: 'multi_line_text_field',  label: 'Multi-line text' },
  { value: 'number_integer',         label: 'Whole number' },
  { value: 'number_decimal',         label: 'Decimal number' },
  { value: 'boolean',                label: 'True / false' },
  { value: 'date',                   label: 'Date' },
  { value: 'url',                    label: 'URL' },
  { value: 'color',                  label: 'Color' },
];

export function metafieldTypeLabel(value: string | null | undefined): string {
  return METAFIELD_TYPE_OPTIONS.find((t) => t.value === value)?.label ?? 'Single line text';
}

const KEY_RE = /^[a-z0-9_]{1,64}$/;

/** "Care instructions" → "care_instructions" (what the server accepts as a key). */
export function keyFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

export interface MetafieldDraft {
  name: string;
  key: string;
  type: string;
  description: string;
}

/** Returns a human error message, or null when the draft can be saved. */
export function validateMetafieldDraft(draft: MetafieldDraft, isNew: boolean): string | null {
  if (!draft.name.trim()) return 'Give this field a name.';
  if (isNew && !KEY_RE.test(draft.key)) {
    return 'The key can only use lowercase letters, numbers and underscores.';
  }
  if (!METAFIELD_TYPE_OPTIONS.some((t) => t.value === draft.type)) return 'Choose a field type.';
  if (draft.description.length > 500) return 'Keep the description under 500 characters.';
  return null;
}
