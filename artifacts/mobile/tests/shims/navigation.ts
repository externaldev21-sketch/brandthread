import { createContext, useEffect } from 'react';
export const NavigationContext = createContext<typeof navigation | undefined>(undefined);
export const useIsFocused = () => true;
export const useFocusEffect = (effect: () => void | (() => void)) => useEffect(effect, [effect]);
const navigation = {
  addListener: () => () => {},
  isFocused: () => true,
  canGoBack: () => false,
  getParent: () => undefined,
  setOptions() {},
  navigate() {},
  dispatch() {},
  goBack() {},
};
export const useNavigation = () => navigation;
