/**
 * Public collection landing — shareable deep link for a public saved collection.
 * Route: /c/[collectionId] (maps to https://brandthread.app/c/{collectionId})
 *
 * No auth required — fetches directly from the public API (mirrors
 * app/u/[username].tsx's pattern) rather than serviceRequest, since an
 * anonymous visitor may open this before the app's auth/service layer is ready.
 * Server returns 404 for anything not explicitly marked public.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, FlatList, TouchableOpacity, Image, StyleSheet, ActivityIndicator, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  BG, CARD, BORDER, FG, MUTED,
  FONT, FS, SP, RADIUS, COMP, CONTENT_MAX_WIDTH,
} from '@/lib/theme';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { ResponsiveContainer } from '@/components/layout';
import { formatCents } from '@/lib/money';

const { width: W } = Dimensions.get('window');
const GAP = SP.sm;
const TILE_SIZE = (Math.min(W, CONTENT_MAX_WIDTH) - SP.md * 2 - GAP) / 2;

const PROD_ORIGIN = 'https://brandthread.app';

interface PublicCollectionItem {
  id: string;
  type: string;
  targetId: string;
  title: string;
  image?: string;
  brand?: string;
  priceCents?: number;
}
interface PublicCollectionDto {
  collection: { id: string; name: string; coverImageUrl: string | null; itemCount: number; ownerName: string };
  items: PublicCollectionItem[];
}

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'error' }
  | { kind: 'ready'; data: PublicCollectionDto };

async function fetchPublicCollection(collectionId: string): Promise<PublicCollectionDto> {
  const apiBase =
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    (process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : PROD_ORIGIN);
  const res = await fetch(`${apiBase}/api/public/collections/${encodeURIComponent(collectionId)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json() as Promise<PublicCollectionDto>;
}

export default function PublicCollectionScreen() {
  const { collectionId } = useLocalSearchParams<{ collectionId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });

  useEffect(() => {
    if (!collectionId) { setState({ kind: 'not_found' }); return; }
    let cancelled = false;
    setState({ kind: 'loading' });
    fetchPublicCollection(collectionId)
      .then(data => { if (!cancelled) setState({ kind: 'ready', data }); })
      .catch((err) => { if (!cancelled) setState(err?.status === 404 ? { kind: 'not_found' } : { kind: 'error' }); });
    return () => { cancelled = true; };
  }, [collectionId]);

  if (state.kind === 'loading') {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={FG} />
      </View>
    );
  }

  if (state.kind === 'not_found' || state.kind === 'error') {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Feather name={state.kind === 'not_found' ? 'folder' : 'alert-circle'} size={40} color={MUTED} />
        <Text style={styles.messageTitle}>
          {state.kind === 'not_found' ? 'Collection not found' : 'Something went wrong'}
        </Text>
        <Text style={styles.messageDesc}>
          {state.kind === 'not_found'
            ? 'This collection may be private or no longer exists.'
            : 'Please check your connection and try again.'}
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/' as never)}>
          <Text style={styles.primaryBtnText}>Open Brandthread</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { collection, items } = state.data;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingTop: insets.top + SP.lg, paddingBottom: insets.bottom + SP.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <ResponsiveContainer maxWidth={CONTENT_MAX_WIDTH} style={{ paddingHorizontal: SP.md }}>
        <View style={styles.logoRow}>
          <BrandthreadLogo size={22} />
          <Text style={styles.logoText}>Brandthread</Text>
        </View>

        {collection.coverImageUrl ? (
          <Image source={{ uri: collection.coverImageUrl }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Feather name="folder" size={36} color={MUTED} />
          </View>
        )}

        <Text style={styles.title}>{collection.name}</Text>
        <Text style={styles.subtitle}>By {collection.ownerName} · {collection.itemCount} saved</Text>

        {items.length === 0 ? (
          <Text style={styles.messageDesc}>Nothing saved here yet.</Text>
        ) : (
          <FlatList
            data={items}
            keyExtractor={i => i.id}
            numColumns={2}
            scrollEnabled={false}
            columnWrapperStyle={{ gap: GAP }}
            contentContainerStyle={{ gap: GAP, marginTop: SP.lg }}
            renderItem={({ item }) => (
              <View style={styles.tile}>
                {item.image ? (
                  <Image source={{ uri: item.image }} style={styles.tileImage} />
                ) : (
                  <View style={[styles.tileImage, styles.coverPlaceholder]}>
                    <Feather name="shopping-bag" size={20} color={MUTED} />
                  </View>
                )}
                <Text style={styles.tileTitle} numberOfLines={2}>{item.title}</Text>
                {item.priceCents != null ? <Text style={styles.tilePrice}>{formatCents(item.priceCents)}</Text> : null}
              </View>
            )}
          />
        )}

        <TouchableOpacity style={[styles.primaryBtn, { marginTop: SP.xl }]} onPress={() => router.replace('/' as never)}>
          <Text style={styles.primaryBtnText}>Open in Brandthread</Text>
        </TouchableOpacity>
      </ResponsiveContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  center: { alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingHorizontal: SP.lg },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginBottom: SP.lg, alignSelf: 'center' },
  logoText: { color: FG, fontFamily: FONT.bold, fontSize: FS.base },
  cover: { width: '100%', aspectRatio: 16 / 9, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER },
  coverPlaceholder: { backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
  title: { color: FG, fontFamily: FONT.bold, fontSize: FS.xl, marginTop: SP.md, textAlign: 'center' },
  subtitle: { color: MUTED, fontSize: FS.sm, textAlign: 'center', marginTop: 2 },
  tile: { width: TILE_SIZE, gap: 4 },
  tileImage: { width: TILE_SIZE, height: TILE_SIZE, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER },
  tileTitle: { color: FG, fontFamily: FONT.medium, fontSize: FS.sm, marginTop: 4 },
  tilePrice: { color: MUTED, fontSize: FS.xs },
  messageTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.md, marginTop: SP.sm, textAlign: 'center' },
  messageDesc: { color: MUTED, fontSize: FS.sm, textAlign: 'center' },
  primaryBtn: { height: COMP.buttonHSm, borderRadius: RADIUS.pill, backgroundColor: FG, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.lg, alignSelf: 'center' },
  primaryBtnText: { color: BG, fontFamily: FONT.semibold, fontSize: FS.sm },
});
