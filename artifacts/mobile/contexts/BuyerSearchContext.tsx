import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { makeMutable, useSharedValue, type SharedValue } from 'react-native-reanimated';

/**
 * Shared state between the buyer tab bar's inline search field and the
 * Search screen behind it.
 *
 * The field lives in the tab bar, the results live in the Search tab. Routing
 * the typed text through navigation params re-rendered the navigator on every
 * keystroke; a plain context keeps typing local to the two consumers.
 */
type BuyerSearchContextValue = {
  query: string;
  setQuery: (value: string) => void;
  /** Increments every time the bar asks the Search screen to open its filters. */
  filtersRequest: number;
  requestFilters: () => void;
  /** Increments every time the user submits from the keyboard. */
  submitRequest: number;
  submit: () => void;
  /** Number of active filters, shown as a dot on the bar's filter button. */
  activeFilterCount: number;
  setActiveFilterCount: (count: number) => void;
  /** Keyboard height while search is open, driven on the UI thread. */
  keyboardHeight: SharedValue<number>;
};

const fallbackKeyboardHeight = makeMutable(0);

const BuyerSearchContext = createContext<BuyerSearchContextValue>({
  query: '',
  setQuery: () => {},
  filtersRequest: 0,
  requestFilters: () => {},
  submitRequest: 0,
  submit: () => {},
  activeFilterCount: 0,
  setActiveFilterCount: () => {},
  keyboardHeight: fallbackKeyboardHeight,
});

export function BuyerSearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState('');
  const [filtersRequest, setFiltersRequest] = useState(0);
  const [submitRequest, setSubmitRequest] = useState(0);
  const [activeFilterCount, setActiveFilterCount] = useState(0);
  const keyboardHeight = useSharedValue(0);

  const requestFilters = useCallback(() => setFiltersRequest(n => n + 1), []);
  const submit = useCallback(() => setSubmitRequest(n => n + 1), []);

  const value = useMemo<BuyerSearchContextValue>(() => ({
    query,
    setQuery,
    filtersRequest,
    requestFilters,
    submitRequest,
    submit,
    activeFilterCount,
    setActiveFilterCount,
    keyboardHeight,
  }), [query, filtersRequest, requestFilters, submitRequest, submit, activeFilterCount, keyboardHeight]);

  return <BuyerSearchContext.Provider value={value}>{children}</BuyerSearchContext.Provider>;
}

export function useBuyerSearch() {
  return useContext(BuyerSearchContext);
}
