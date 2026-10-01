import React from 'react';
import { Modal, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useAppTheme } from '@/contexts/AppThemeContext';

/**
 * Full-screen inline player for a video message. Bare close button under the status bar; native
 * controls give play/pause + scrub. The player only exists while a uri is set.
 */
function Player({ uri, width, height }: { uri: string; width: number; height: number }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; p.play(); });
  React.useEffect(() => () => { try { player.pause(); } catch { /* released */ } }, [player]);
  return <VideoView player={player} style={{ width, height }} contentFit="contain" nativeControls />;
}

export default function VideoMessageViewer({
  uri, onClose,
}: {
  uri: string | null;
  onClose: () => void;
}) {
  const headerTopInset = useHeaderTopInset();
  const { theme } = useAppTheme();
  const { width, height } = useWindowDimensions();
  return (
    <Modal visible={uri != null} animationType="fade" onRequestClose={onClose}>
      <View style={[s.page, { backgroundColor: theme.background, width, height }]} testID="video-message-viewer">
        {uri ? <Player uri={uri} width={width} height={height} /> : null}
        <View style={[s.topBar, { paddingTop: headerTopInset + 12 }]}>
          <TouchableOpacity
            style={s.iconBtn}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close video"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="x" size={22} color={theme.text} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, overflow: 'hidden' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, paddingHorizontal: 16, paddingBottom: 8 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
