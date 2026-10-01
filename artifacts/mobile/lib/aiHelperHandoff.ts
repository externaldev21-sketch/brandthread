/**
 * One-shot hand-off of an AI description from app/ai-helper.tsx back to the
 * product form it was opened from. The form applies it to its own draft only
 * when the seller taps "Use in product"; nothing is saved until they save the
 * product as usual.
 */
let pendingDescription: string | null = null;

export function setPendingAiDescription(text: string): void {
  pendingDescription = text;
}

export function takePendingAiDescription(): string | null {
  const t = pendingDescription;
  pendingDescription = null;
  return t;
}

/** Object path (/objects/uploads/...) inside a stored image reference, or null. */
export function toUploadObjectPath(uri: string | undefined | null): string | null {
  const m = typeof uri === 'string' ? uri.match(/\/objects\/uploads\/[A-Za-z0-9._-]{1,120}/) : null;
  return m ? m[0] : null;
}
