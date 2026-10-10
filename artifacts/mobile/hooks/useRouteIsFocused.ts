import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

/** Route focus without importing a second navigation runtime. */
export function useRouteIsFocused(): boolean {
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  return focused;
}
