import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

/** Profile tab selection lasts for one focused visit, never across visits. */
export function useProfilePostsDefault(
  setTab: (tab: 'Posts') => void,
  identity: string | null | undefined,
) {
  useFocusEffect(useCallback(() => {
    setTab('Posts');
  }, [setTab, identity]));
}
