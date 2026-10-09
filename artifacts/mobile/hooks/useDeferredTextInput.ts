import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

/**
 * Keeps a text field responsive when its owner is a heavy screen.
 *
 * A controlled `<TextInput value={state} onChangeText={setState}>` whose
 * state lives in a big form/screen re-renders that whole screen before the
 * keystroke is reflected, so typing lags whenever the screen is expensive.
 * This hook gives the field its own text state (updated immediately, so the
 * character is drawn at once) and forwards the change to the owner inside a
 * React transition — the expensive re-render is low priority and gets
 * interrupted/batched by the next keystroke instead of blocking it.
 *
 * The owner's `value` stays the source of truth:
 *  - an outside change (reset, prefill, autocomplete pick, formatting the
 *    owner applies) replaces the field text as soon as it lands;
 *  - if the owner rejects an edit (keeps its old value), the field goes back
 *    to that value once the deferred update has settled.
 */
export function useDeferredTextInput(
  value: string,
  onChange: ((next: string) => void) | undefined,
): { text: string; onChangeText: (next: string) => void } {
  const [text, setText] = useState(value);
  const [seenValue, setSeenValue] = useState(value);
  const [isPending, startTransition] = useTransition();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  if (value !== seenValue) {
    setSeenValue(value);
    setText(value);
  }

  useEffect(() => {
    if (!isPending) setText((current) => (current === value ? current : value));
  }, [isPending, value]);

  const onChangeText = useCallback((next: string) => {
    setText(next);
    startTransition(() => { onChangeRef.current?.(next); });
  }, []);

  return { text, onChangeText };
}
