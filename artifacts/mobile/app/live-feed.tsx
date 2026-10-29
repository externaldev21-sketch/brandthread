/**
 * LIVE — every show that's live right now, as Whatnot's two-up grid
 * (components/live/LiveShowsGrid.tsx). The feed header's LIVE entry opens
 * this; tapping a show joins it in the swipeable viewer (app/live.tsx),
 * opened at that show.
 *
 * Reference: Whatnot "Watching a livestream"
 * https://mobbin.com/flows/ed55f754-472f-46f8-914b-ce7cb7345c7b
 */
import React from 'react';
import { ScreenExplainer } from '@/components/first-run-tips/ScreenExplainer';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { LiveShowsGrid } from '@/components/live/LiveShowsGrid';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { liveHref } from '@/lib/live/useLiveDirectory';

export default function LiveFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }} testID="live-feed-screen">
      <ScreenHeader title="LIVE" backAccessibilityLabel="Close LIVE" />
      <LiveShowsGrid
        bottomInset={insets.bottom}
        onOpenShow={stream => router.push(liveHref({ streamId: stream.id }) as never)}
      />
      <ScreenExplainer id="explain-live-feed" />
    </View>
  );
}
