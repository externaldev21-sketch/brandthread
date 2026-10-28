/**
 * Runs `effect` once when this screen mounts hidden — pre-mounted by
 * components/navigation/TabScenePreloader before the user ever opened it.
 *
 * Tab screens load their data in useFocusEffect, which a preloaded (mounted
 * but unfocused) scene never runs, so without this its first visit would
 * still paint the skeleton/empty state and then pop in the data. With it the
 * first visit shows loaded content on the tap frame, and the screen's own
 * focus effect then runs exactly as before as a silent refresh.
 *
 * Only the read side belongs here: never mark-as-read, clear badges, start
 * polling or anything else that means "the user is looking at this".
 * A screen mounted focused (a normal first visit) skips this entirely.
 */
import { useEffect, useRef } from 'react';
import { useNavigation } from 'expo-router';

export function usePreloadedSceneEffect(effect: () => void): void {
  const navigation = useNavigation();
  const effectRef = useRef(effect);
  effectRef.current = effect;
  useEffect(() => {
    if (navigation.isFocused()) return;
    effectRef.current();
  }, [navigation]);
}
