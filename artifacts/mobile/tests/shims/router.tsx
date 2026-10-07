/** Router host boundary for Node renderer tests; suites override navigation spies. */
import React from 'react';
export function useRouter() { return { push() {}, replace() {}, back() {}, canGoBack: () => false, setParams() {} }; }
export function usePathname() { return '/'; }
export function useSegments() { return []; }
export function useLocalSearchParams() { return {}; }
export function useGlobalSearchParams() { return {}; }
export function useFocusEffect(effect: () => void | (() => void)) { React.useEffect(effect, [effect]); }
export function useNavigation() { return { setOptions() {}, addListener: () => () => {} }; }
export function useRootNavigationState() { return { key: 'test-root' }; }
export function Link({ children }: { children?: React.ReactNode }) { return children; }
export function Redirect() { return null; }
