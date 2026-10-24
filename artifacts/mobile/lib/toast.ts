/**
 * Good-news toast: `showToast('Link copied')`.
 *
 * Success messages ("Cashed out", "Plan updated", "Link copied") used to open
 * a blocking `Alert.alert`. A toast says the same thing without asking for a
 * tap. One host (`<ToastHost />`, components/ui/Toast.tsx, mounted once in
 * app/_layout.tsx) draws them; errors and choices still use `showAlert`.
 */

export interface ToastRequest {
  id: number;
  /** Short headline, e.g. "Cashed out". */
  title: string;
  /** Optional second line, e.g. "$42.60 is on its way to your bank." */
  message?: string;
}

type Listener = (toast: ToastRequest | null) => void;

let current: ToastRequest | null = null;
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(current);
}

/** Shows a toast, replacing whatever toast is on screen. */
export function showToast(title: string, message?: string): void {
  const t = title.trim();
  const m = message?.trim() || undefined;
  if (!t && !m) return;
  // Same toast already up (double tap on "Save") — keep the one showing.
  if (current && current.title === t && current.message === m) return;
  current = { id: nextId++, title: t || (m as string), message: t ? m : undefined };
  emit();
}

/** Called by the host when a toast times out or is tapped away. */
export function dismissToast(id: number): void {
  if (current?.id !== id) return;
  current = null;
  emit();
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper. */
export function peekToast(): ToastRequest | null {
  return current;
}
