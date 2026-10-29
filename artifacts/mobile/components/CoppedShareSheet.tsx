/**
 * "Share to your story" after checkout: a full-screen page with the
 * "Just copped" card and three actions, laid out like the app's existing
 * Share profile page (components/ShareProfileSheet.tsx, Instagram's
 * share-profile flow): X top-left, card in the middle, equal tiles below.
 * A tile that worked flips to a check with "Copied" / "Saved", the way
 * Instagram's share sheet confirms Copy link.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/BrandthreadUI';
import { CoppedShareCard } from '@/components/share-cards/CoppedShareCard';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticLight, hapticSuccess, hapticError } from '@/lib/haptics';
import type { CoppedCardData } from '@/lib/coppedCard';
import {
  captureCardAtNaturalSize, captureShareCard, saveCardImageToLibrary, shareCardToInstagramStories,
  triggerWebImageDownload,
} from '@/lib/shareCard';
import { CARD_PREVIEW_HEIGHT, CARD_PREVIEW_WIDTH } from '@/components/share-cards/ShareCardFrame';
import { FONT, FS, SP } from '@/lib/theme';

type Action = 'story' | 'copy' | 'save';
type TileState = { action: Action; label: string; icon: React.ComponentProps<typeof Feather>['name'] } | null;

export function CoppedShareSheet({ visible, data, onClose }: {
  visible: boolean;
  data: CoppedCardData;
  onClose: () => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [done, setDone] = useState<TileState>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (doneTimer.current) clearTimeout(doneTimer.current); }, []);

  const confirm = useCallback((next: NonNullable<TileState>) => {
    hapticSuccess();
    setFailed(null);
    setDone(next);
    if (doneTimer.current) clearTimeout(doneTimer.current);
    doneTimer.current = setTimeout(() => setDone(null), 2000);
  }, []);

  const run = useCallback(async (action: Action, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(action);
    try {
      await fn();
    } catch {
      hapticError();
      setFailed("Couldn't complete that. Try again.");
    } finally {
      setBusy(null);
    }
  }, [busy]);

  const capture = useCallback(async () => {
    if (Platform.OS === 'web') return captureCardAtNaturalSize(cardRef, CARD_PREVIEW_WIDTH, 1080 / CARD_PREVIEW_WIDTH);
    return captureShareCard(cardRef);
  }, []);

  const addToStory = () => run('story', async () => {
    hapticLight();
    const uri = await capture();
    await shareCardToInstagramStories(uri);
  });

  const copyLink = () => run('copy', async () => {
    if (!data.url) return;
    if (Platform.OS === 'web') {
      if (!navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(data.url);
    } else {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(data.url);
    }
    confirm({ action: 'copy', label: 'Copied', icon: 'check' });
  });

  const save = () => run('save', async () => {
    hapticLight();
    const uri = await capture();
    if (Platform.OS === 'web') {
      triggerWebImageDownload(uri, 'just-copped.png');
      confirm({ action: 'save', label: 'Saved', icon: 'check' });
      return;
    }
    const result = await saveCardImageToLibrary(uri);
    if (result.ok) confirm({ action: 'save', label: 'Saved', icon: 'check' });
    else {
      hapticError();
      setFailed(result.unavailable ? 'Saving to Photos is unavailable in this app build.' : 'Allow Photos access to save this.');
    }
  });

  if (!visible) return null;

  const tile = (action: Action, icon: React.ComponentProps<typeof Feather>['name'], label: string, onPress: () => void) => {
    const confirmed = done?.action === action ? done : null;
    return (
      <View style={styles.tileFlex} key={action}>
        <PressableScale
          style={styles.tile}
          onPress={onPress}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel={label}
          testID={`copped-share-${action}`}
        >
          <View style={[styles.tileCircle, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}>
            <Feather name={confirmed?.icon ?? icon} size={20} color={theme.text} />
          </View>
          <Text style={[styles.tileLabel, { color: theme.text }]} numberOfLines={1}>{confirmed?.label ?? label}</Text>
        </PressableScale>
      </View>
    );
  };

  return (
    <Modal
      visible
      animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
      onRequestClose={onClose}
      presentationStyle={Platform.OS === 'ios' ? 'fullScreen' : undefined}
    >
      <View style={[styles.root, { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <PressableScale
            onPress={onClose}
            style={styles.close}
            accessibilityRole="button"
            accessibilityLabel="Close"
            testID="copped-share-close"
            noMinHeight
          >
            <Feather name="x" size={24} color={theme.text} />
          </PressableScale>
        </View>

        <View style={styles.center}>
          <View collapsable={false}>
            <CoppedShareCard ref={cardRef} theme={theme} data={data} />
          </View>
        </View>

        <View style={styles.tiles}>
          {Platform.OS !== 'web' ? tile('story', 'plus-circle', 'Add to story', addToStory) : null}
          {data.url ? tile('copy', 'link-2', 'Copy link', copyLink) : null}
          {tile('save', 'download', 'Save', save)}
        </View>
        <Text style={[styles.error, { color: theme.error, opacity: failed ? 1 : 0 }]} accessibilityLiveRegion="polite">
          {failed ?? ' '}
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md },
  close: { width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: CARD_PREVIEW_HEIGHT },
  tiles: { flexDirection: 'row', paddingHorizontal: SP.lg, marginTop: SP.lg },
  tileFlex: { flex: 1 },
  tile: { alignItems: 'center', gap: SP.xs },
  tileCircle: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontFamily: FONT.medium, fontSize: FS.xs },
  error: { fontFamily: FONT.medium, fontSize: FS.sm, textAlign: 'center', marginTop: SP.md, marginBottom: SP.md },
});
