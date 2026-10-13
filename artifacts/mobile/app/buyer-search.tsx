/**
 * Retired screen. Search now opens in place on Discover (TikTok-style: the
 * tapped bar becomes the search field — see
 * components/discover/search/DiscoverSearchOverlay.tsx). Every existing link
 * and deep link to /buyer-search (Home's search icon, Friend requests,
 * Search history's `?q=` taps) redirects into that overlay, keeping `q`.
 */
import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function BuyerSearchRedirect() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  const query = typeof q === 'string' && q.trim() ? q.trim() : undefined;
  return (
    <Redirect href={{ pathname: '/(buyer)/discover', params: query ? { search: '1', q: query } : { search: '1' } } as never} />
  );
}