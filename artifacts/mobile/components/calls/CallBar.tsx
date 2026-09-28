/**
 * CallBar — the minimized call bar. Not part of the Mobbin "Calling a user"
 * flow (iOS Instagram hands this off to the OS-level PiP instead), but the
 * owner's brief explicitly asks for it: a persistent thin bar restoring the
 * full call view on tap, styled with the same floating/glass chrome as
 * `components/ScreenHeader.tsx` and the tab bar (`components/ui/GlassPanel.tsx`).
 *
 * Matches how a system call bar behaves: tapping it restores the call; it
 * has no end-call button of its own — that lives on the restored call view.
 */
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useCallSession } from '@/lib/calls/CallSessionContext';
import { PressableScale } from '@/components/BrandthreadUI';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { TYPE_SCALE } from '@/constants/typography';
import { CallAvatarCircle } from './CallAvatarCircle';
import { formatCallDuration } from './CallControls';

export function CallBar() {
  const { theme } = useAppTheme();
  const { session, restore } = useCallSession();
  const [durationSec, setDurationSec] = React.useState(0);
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === 'web' ? Math.max(insets.top, 54) : insets.top;

  React.useEffect(() => {
    if (!session?.connectedAt) return;
    const connectedAt = session.connectedAt;
    const tick = () => setDurationSec(Math.max(0, Math.floor((Date.now() - connectedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session?.connectedAt]);

  if (!session) return null;
  const { peer, status } = session;
  const statusText = status === 'connected' ? formatCallDuration(durationSec) : 'Calling…';

  return (
    <View style={[styles.wrap, { top: topInset + 8 }]} pointerEvents="box-none">
      <PressableScale
        onPress={restore}
        accessibilityRole="button"
        accessibilityLabel={`Restore call with ${peer.name}, ${statusText}`}
        noMinHeight
        style={styles.pressWrap}
      >
        <GlassPanel radius={999} style={styles.panel}>
          <CallAvatarCircle
            name={peer.name}
            initials={peer.initials}
            color={peer.color}
            avatarUri={peer.avatarUri}
            size={28}
          />
          <Text style={[TYPE_SCALE.footnote, styles.text, { color: theme.text }]} numberOfLines={1}>
            {peer.name} · {statusText}
          </Text>
        </GlassPanel>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  pressWrap: { alignSelf: 'stretch' },
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  text: { flex: 1 },
});
