import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

/**
 * App icon and App theme were merged into one Appearance screen
 * (app/appearance.tsx). This route is kept only so old links/bookmarks and
 * deep links still land somewhere real.
 */
export default function AppIconRedirectScreen() {
  const router = useRouter();
  useEffect(() => { router.replace('/appearance' as never); }, [router]);
  return <View style={{ flex: 1, backgroundColor: 'transparent' }} />;
}
