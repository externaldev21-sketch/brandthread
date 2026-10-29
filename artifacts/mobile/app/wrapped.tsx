/**
 * Monthly Wrapped — Spotify Wrapped's story, reskinned: 4–6 full-screen cards
 * you swipe (or tap the right/left edge) through, segment bar on top, close
 * top-right. Plain type on black with real product photos; no auto-advance,
 * no sound, no confetti. The last card exports one share card (9:16 PNG).
 *
 * Route: /wrapped?month=YYYY-MM (default: last month)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CachedImage } from '@/components/CachedImage';
import { Button } from '@/components/ui/Button';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { hapticSuccess } from '@/lib/haptics';
import { captureShareCard, shareStoryCardImage } from '@/lib/shareCard';
import { FONT, FS, SP } from '@/lib/theme';
import { monthName, piecesLine, wrappedCards, type WrappedCard } from '@/lib/wrapped';
import { getWrapped, type Wrapped } from '@/services/wrappedService';

const INK = '#000000';
const PAPER = '#FFFFFF';
const SILVER = '#A7A7AD';
const LINE = '#2C2C30';

function Photo({ uri, style, label }: { uri: string | null; style: object; label?: string }) {
  return uri
    ? <CachedImage source={{ uri }} style={[styles.photoBase, style]} accessibilityLabel={label} />
    : <View style={[styles.photoBase, style]} />;
}

/** The exported card: plain type on black + one real product photo. */
export function WrappedShareCard({ wrapped, width }: { wrapped: Wrapped; width: number }) {
  const height = Math.round(width * 16 / 9);
  const top = wrapped.topBrands[0];
  const pad = Math.round(width * 0.08);
  return (
    <View style={{ width, height, backgroundColor: INK, padding: pad, justifyContent: 'space-between' }} collapsable={false} testID="wrapped-share-card">
      <View>
        <Text style={{ fontFamily: FONT.medium, fontSize: width * 0.04, color: SILVER }}>Brandthread</Text>
        <Text style={{ fontFamily: FONT.bold, fontSize: width * 0.11, color: PAPER, letterSpacing: -1, marginTop: width * 0.02 }}>My {monthName(wrapped.month)}</Text>
      </View>
      <Photo uri={wrapped.coverImageUrl} style={{ width: width - pad * 2, height: (width - pad * 2) * 1.25 }} />
      <View style={{ gap: width * 0.012 }}>
        <Text style={{ fontFamily: FONT.semibold, fontSize: width * 0.05, color: PAPER }}>{piecesLine(wrapped)}</Text>
        {top ? <Text style={{ fontFamily: FONT.regular, fontSize: width * 0.042, color: SILVER }} numberOfLines={1}>Top brand · {top.name}</Text> : null}
        {wrapped.supporter ? <Text style={{ fontFamily: FONT.regular, fontSize: width * 0.042, color: SILVER }} numberOfLines={1}>Top {wrapped.supporter.topPercent}% of {wrapped.supporter.brand} supporters</Text> : null}
      </View>
    </View>
  );
}

export default function WrappedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const params = useLocalSearchParams<{ month?: string }>();
  const [wrapped, setWrapped] = useState<Wrapped | null | undefined>(undefined);
  const [index, setIndex] = useState(0);
  const [shareState, setShareState] = useState<'idle' | 'busy' | 'unavailable'>('idle');
  const list = useRef<FlatList<WrappedCard>>(null);
  const shareRef = useRef<View>(null);

  useEffect(() => {
    let live = true;
    getWrapped(typeof params.month === 'string' ? params.month : undefined).then((w) => { if (live) setWrapped(w); });
    return () => { live = false; };
  }, [params.month]);

  const cards = useMemo(() => (wrapped?.available ? wrappedCards(wrapped) : []), [wrapped]);
  const close = useCallback(() => goBackOr(router, '/(buyer)/profile' as never), [router]);

  const go = useCallback((next: number) => {
    if (next < 0 || next >= cards.length) return;
    list.current?.scrollToIndex({ index: next, animated: true });
    setIndex(next);
  }, [cards.length]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)));
  };

  const share = useCallback(async () => {
    if (!wrapped) return;
    if (Platform.OS === 'web') { setShareState('unavailable'); return; }
    setShareState('busy');
    try {
      const uri = await captureShareCard(shareRef);
      // Android's Share.share({ message }) sent the tmp file path as text, not the image.
      await shareStoryCardImage(uri, 'brandthread-wrapped.png');
      hapticSuccess();
    } catch { /* dismissed or unavailable */ }
    setShareState('idle');
  }, [wrapped]);

  if (wrapped === undefined) {
    return <View style={[styles.root, styles.center]}><ActivityIndicator color={SILVER} /></View>;
  }
  if (!wrapped || !wrapped.available) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.small}>No recap for this month.</Text>
        <Pressable onPress={close} hitSlop={12} style={{ marginTop: SP.md }} accessibilityRole="button"><Text style={styles.link}>Close</Text></Pressable>
      </View>
    );
  }

  const pageH = height;
  const contentTop = insets.top + 56;
  const renderCard = ({ item }: { item: WrappedCard }) => {
    const pad = { width, height: pageH, paddingTop: contentTop, paddingBottom: insets.bottom + SP.xl, paddingHorizontal: SP.lg };
    if (item === 'intro') {
      return (
        <View style={[pad, styles.page, { justifyContent: 'flex-end' }]} testID="wrapped-card-intro">
          <Text style={styles.kicker}>Your month on Brandthread</Text>
          <Text style={styles.giant}>{monthName(wrapped.month)}</Text>
        </View>
      );
    }
    if (item === 'pieces') {
      const photos = wrapped.topBrands.map((b) => b.imageUrl).filter((u): u is string => !!u).slice(0, 4);
      const cell = (width - SP.lg * 2 - 2) / 2;
      return (
        <View style={[pad, styles.page]} testID="wrapped-card-pieces">
          <Text style={styles.kicker}>New in your closet</Text>
          <Text style={styles.giant}>{wrapped.totalPieces}</Text>
          <Text style={styles.big}>{wrapped.totalPieces === 1 ? 'piece' : 'pieces'}</Text>
          <View style={styles.grid}>
            {photos.map((uri) => <Photo key={uri} uri={uri} style={{ width: cell, height: cell * 1.25 }} />)}
          </View>
        </View>
      );
    }
    if (item === 'brands') {
      return (
        <View style={[pad, styles.page]} testID="wrapped-card-brands">
          <Text style={styles.kicker}>Your top brands</Text>
          {wrapped.topBrands.map((b, i) => (
            <View key={b.sellerId} style={styles.brandRow}>
              <Text style={styles.rank}>{i + 1}</Text>
              <Photo uri={b.imageUrl} style={styles.brandThumb} />
              <View style={{ flex: 1 }}>
                <Text style={styles.brandName} numberOfLines={1}>{b.name}</Text>
                <Text style={styles.small}>{b.pieces} {b.pieces === 1 ? 'piece' : 'pieces'}</Text>
              </View>
            </View>
          ))}
        </View>
      );
    }
    if (item === 'mostPosted' && wrapped.mostPosted) {
      const p = wrapped.mostPosted;
      const w = width - SP.lg * 2;
      return (
        <View style={[pad, styles.page]} testID="wrapped-card-most-posted">
          <Text style={styles.kicker}>Your most-posted piece</Text>
          <Photo uri={p.imageUrl} style={{ width: w, height: Math.min(w * 1.25, pageH * 0.5), marginTop: SP.md }} label={p.name} />
          <Text style={[styles.big, { marginTop: SP.md }]} numberOfLines={2}>{p.name}</Text>
          <Text style={styles.small}>{[p.brand, `in ${p.posts} ${p.posts === 1 ? 'fit' : 'fits'}`].filter(Boolean).join(' · ')}</Text>
        </View>
      );
    }
    if (item === 'supporter' && wrapped.supporter) {
      return (
        <View style={[pad, styles.page, { justifyContent: 'center' }]} testID="wrapped-card-supporter">
          <Text style={styles.giant}>Top {wrapped.supporter.topPercent}%</Text>
          <Text style={styles.big}>of {wrapped.supporter.brand} supporters</Text>
        </View>
      );
    }
    // share
    const cardW = Math.min(width * 0.62, 260);
    return (
      <View style={[pad, styles.page, { alignItems: 'center' }]} testID="wrapped-card-share">
        <View ref={shareRef} collapsable={false} style={styles.shareFrame}>
          <WrappedShareCard wrapped={wrapped} width={cardW} />
        </View>
        <View style={{ alignSelf: 'stretch', marginTop: 'auto', gap: SP.xs }}>
          {shareState === 'unavailable' ? <Text style={[styles.small, { textAlign: 'center' }]}>Sharing works in the app.</Text> : null}
          <Button label="Share" onPress={share} loading={shareState === 'busy'} fullWidth testID="wrapped-share" />
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root} testID="wrapped">
      <FlatList
        ref={list}
        data={cards}
        keyExtractor={(c) => c}
        renderItem={renderCard}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      />
      {/* Tap the edges to step, like a story. */}
      <Pressable style={[styles.edge, { left: 0, top: contentTop, bottom: 140 }]} onPress={() => go(index - 1)} accessibilityLabel="Previous" accessibilityRole="button" />
      <Pressable style={[styles.edge, { right: 0, top: contentTop, bottom: 140 }]} onPress={() => go(index + 1)} accessibilityLabel="Next" accessibilityRole="button" testID="wrapped-next" />
      <View style={[styles.top, { paddingTop: insets.top + SP.sm }]} pointerEvents="box-none">
        <View style={styles.segments}>
          {cards.map((c, i) => <View key={c} style={[styles.segment, { backgroundColor: i <= index ? PAPER : LINE }]} />)}
        </View>
        <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" testID="wrapped-close" style={styles.close}>
          <Feather name="x" size={24} color={PAPER} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: INK },
  center: { alignItems: 'center', justifyContent: 'center' },
  page: { backgroundColor: INK },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: SP.md },
  segments: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 2.5, borderRadius: 2 },
  close: { alignSelf: 'flex-end', marginTop: SP.sm },
  edge: { position: 'absolute', width: '28%' },
  kicker: { fontFamily: FONT.medium, fontSize: FS.base, color: SILVER },
  giant: { fontFamily: FONT.bold, fontSize: 64, color: PAPER, letterSpacing: -2, lineHeight: 70 }, // type-exempt: Wrapped recap stat, display size
  big: { fontFamily: FONT.semibold, fontSize: FS.xxl, color: PAPER, letterSpacing: -0.5 },
  small: { fontFamily: FONT.regular, fontSize: FS.sm, color: SILVER },
  link: { fontFamily: FONT.semibold, fontSize: FS.base, color: PAPER },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginTop: SP.lg },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginTop: SP.lg },
  rank: { fontFamily: FONT.bold, fontSize: FS.xxl, color: PAPER, width: 24 },
  brandThumb: { width: 64, height: 80 },
  brandName: { fontFamily: FONT.semibold, fontSize: FS.lg, color: PAPER },
  photoBase: { backgroundColor: '#111114' },
  shareFrame: { borderWidth: StyleSheet.hairlineWidth, borderColor: LINE },
});
