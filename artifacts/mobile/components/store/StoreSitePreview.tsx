/**
 * The seller's store (brandthread.app/@handle), drawn natively so in-app
 * previews match the real page and stay sharp at any size. Mirrors
 * artifacts/api-server/src/lib/growth/storeSitePage.ts (Stan Store layout):
 * round photo, name, bio, social icons, then the product blocks — a Callout
 * card (thumbnail, title, subtitle, price, ship-by, full-width button) or a
 * compact Button row in the accent colour.
 *
 * `StoreSitePreview` renders at phone width (390pt); `StoreSiteThumbnail`
 * scales that render down (Share store sheet, My Store) instead of
 * rasterising it. `StoreCheckoutPreview` is the checkout page a block opens.
 */
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { CachedImage as Image } from '@/components/CachedImage';
import { FontAwesome6 } from '@expo/vector-icons';

import { Icon } from '@/components/ui/Icon';
import { storeSiteTheme, type StoreSiteTheme } from '@/lib/storeSiteDesign';
import type { StoreCard } from '@/lib/storeBlocks';

export const SITE_WIDTH = 390;

export type StoreSiteCard = StoreCard & { id: string };

export interface StoreSiteView {
  handle: string | null;
  displayName: string;
  bio: string;
  logoUrl: string | null;
  themeKey: string;
  socials: string[];
  blocks: StoreSiteCard[];
}

const BRAND_ICON: Record<string, string> = {
  instagram: 'instagram', tiktok: 'tiktok', youtube: 'youtube', x: 'x-twitter', facebook: 'facebook',
};

function SocialGlyph({ k, color }: { k: string; color: string }) {
  if (BRAND_ICON[k]) return <FontAwesome6 name={BRAND_ICON[k] as never} brand size={20} color={color} />;
  return <Icon name={k === 'email' ? 'mail' : 'globe'} size={20} color={color} />;
}

function Thumb({ uri, size, radius, t, bg }: { uri: string | null; size: number; radius: number; t: StoreSiteTheme; bg?: string }) {
  return uri
    ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius, backgroundColor: bg ?? t.line }} resizeMode="cover" />
    : <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: bg ?? t.line }} />;
}

function Price({ priceLabel, compareAtLabel, t, size }: { priceLabel: string; compareAtLabel: string; t: StoreSiteTheme; size: number }) {
  if (!priceLabel) return null;
  return (
    <Text style={[s.price, { color: t.fg, fontSize: size }]}>
      {priceLabel}
      {compareAtLabel ? <Text style={[s.compare, { color: t.muted }]}>{`  ${compareAtLabel}`}</Text> : null}
    </Text>
  );
}

/** One product block as the store shows it. */
export function StoreBlockCard({ card, themeKey, testID }: { card: StoreCard; themeKey: string; testID?: string }) {
  const t = storeSiteTheme(themeKey);
  const off = !!card.unavailableLabel;
  if (card.style === 'button') {
    const line = [card.priceLabel, card.shipByLabel, card.unavailableLabel].filter(Boolean).join(' · ');
    return (
      <View style={[s.btnRow, { backgroundColor: t.buttonBg }, off && s.off]} testID={testID}>
        <Thumb uri={card.image} size={48} radius={10} t={t} bg={t.card} />
        <View style={s.tx}>
          <Text style={[s.title, { color: t.buttonFg }]} numberOfLines={2}>{card.title}</Text>
          {!!line && <Text style={[s.line, { color: t.buttonFg }]} numberOfLines={1}>{line}</Text>}
        </View>
      </View>
    );
  }
  return (
    <View style={[s.callout, { backgroundColor: t.card }, off && s.off]} testID={testID}>
      <View style={s.row}>
        <Thumb uri={card.image} size={88} radius={12} t={t} />
        <View style={s.tx}>
          <Text style={[s.title, { color: t.fg }]} numberOfLines={2}>{card.title}</Text>
          {!!card.subtitle && <Text style={[s.sub, { color: t.muted }]} numberOfLines={2}>{card.subtitle}</Text>}
          <Price priceLabel={card.priceLabel} compareAtLabel={card.compareAtLabel} t={t} size={15} />
          {!!card.shipByLabel && <Text style={[s.ship, { color: t.muted }]}>{card.shipByLabel}</Text>}
        </View>
      </View>
      <View style={[s.cta, { backgroundColor: off ? t.line : t.buttonBg }]}>
        <Text style={[s.ctaText, { color: off ? t.fg : t.buttonFg }]} numberOfLines={1}>{card.unavailableLabel ?? card.buttonText}</Text>
      </View>
    </View>
  );
}

function Profile({ site, t }: { site: StoreSiteView; t: StoreSiteTheme }) {
  const name = site.displayName.trim() || (site.handle ? `@${site.handle}` : '');
  const initial = (name.replace(/^@/, '').trim()[0] ?? 'B').toUpperCase();
  return (
    <View style={s.hero}>
      {site.logoUrl
        ? <Image source={{ uri: site.logoUrl }} style={[s.logo, { backgroundColor: t.card }]} accessibilityLabel={`${name} photo`} />
        : <View style={[s.logo, s.logoPh, { backgroundColor: t.card }]}><Text style={[s.initial, { color: t.fg }]}>{initial}</Text></View>}
      {!!name && <Text style={[s.name, { color: t.fg }]} numberOfLines={2}>{name}</Text>}
      {!!site.bio.trim() && <Text style={[s.bio, { color: t.muted }]} numberOfLines={3}>{site.bio.trim()}</Text>}
      {site.socials.length > 0 && (
        <View style={s.socials}>
          {site.socials.map((k) => <View key={k} style={s.social}><SocialGlyph k={k} color={t.fg} /></View>)}
        </View>
      )}
    </View>
  );
}

interface PreviewProps {
  site: StoreSiteView;
  /** Only the first N blocks (thumbnails don't need them all). */
  maxBlocks?: number;
  testID?: string;
}

export function StoreSitePreview({ site, maxBlocks, testID = 'store-site-preview' }: PreviewProps) {
  const t = storeSiteTheme(site.themeKey);
  const blocks = maxBlocks != null ? site.blocks.slice(0, maxBlocks) : site.blocks;
  return (
    <View style={[s.page, { backgroundColor: t.bg }]} testID={testID}>
      <View style={s.topSpace} />
      <Profile site={site} t={t} />
      {blocks.length > 0 && (
        <View style={s.blocks}>
          {blocks.map((b) => <StoreBlockCard key={b.id} card={b} themeKey={site.themeKey} />)}
        </View>
      )}
      <Text style={[s.footer, { color: t.muted }]}>
        Powered by <Text style={{ color: t.fg, fontWeight: '600' }}>Brandthread</Text>
      </Text>
    </View>
  );
}

export interface StoreCheckoutView {
  themeKey: string;
  kind: 'premade' | 'preorder';
  title: string;
  image: string | null;
  description: string;
  priceLabel: string;
  compareAtLabel: string;
  shipByLabel: string;
}

/** What the store's checkout always asks for (needed to ship). */
export const CHECKOUT_FIELDS = ['Full name', 'Email', 'Phone', 'Shipping address'] as const;

/** The checkout page a block opens on the store (image, price, description, buyer details). */
export function StoreCheckoutPreview({ view, testID = 'store-checkout-preview' }: { view: StoreCheckoutView; testID?: string }) {
  const t = storeSiteTheme(view.themeKey);
  return (
    <View style={[s.page, s.checkout, { backgroundColor: t.bg }]} testID={testID}>
      <View style={s.back}><Icon name="chevron-left" size={26} color={t.fg} /></View>
      {view.image
        ? <Image source={{ uri: view.image }} style={[s.hero1, { backgroundColor: t.card }]} resizeMode="cover" />
        : <View style={[s.hero1, { backgroundColor: t.card }]} />}
      <Text style={[s.coTitle, { color: t.fg }]} numberOfLines={2}>{view.title}</Text>
      <Price priceLabel={view.priceLabel} compareAtLabel={view.compareAtLabel} t={t} size={20} />
      {!!view.shipByLabel && <Text style={[s.coShip, { color: t.muted }]}>{view.shipByLabel}</Text>}
      {!!view.description && <Text style={[s.coDesc, { color: t.muted }]} numberOfLines={6}>{view.description}</Text>}
      <View style={s.fields}>
        {CHECKOUT_FIELDS.map((f) => (
          <View key={f} style={s.field}>
            <Text style={[s.fieldLabel, { color: t.muted }]}>{f}</Text>
            <View style={[s.input, { backgroundColor: t.card, borderColor: t.line }]} />
          </View>
        ))}
      </View>
      <View style={[s.cta, s.coCta, { backgroundColor: t.buttonBg }]}>
        <Text style={[s.ctaText, { color: t.buttonFg }]}>{view.kind === 'preorder' ? 'Continue to pre-order' : 'Continue to payment'}</Text>
      </View>
    </View>
  );
}

interface ScaledProps {
  /** Rendered width. */
  width: number;
  /** Rendered height; the page is cropped at the bottom. */
  height: number;
  radius?: number;
  themeKey: string;
  children: React.ReactNode;
  testID?: string;
}

/** A 390pt-wide render scaled down and cropped — crisp, not a screenshot. */
export function ScaledPage({ width, height, radius = 16, themeKey, children, testID }: ScaledProps) {
  const scale = width / SITE_WIDTH;
  const t = storeSiteTheme(themeKey);
  return (
    <View style={{ width, height, borderRadius: radius, overflow: 'hidden', backgroundColor: t.bg }} testID={testID} pointerEvents="none">
      <View
        style={{
          width: SITE_WIDTH,
          transform: [{ translateX: -(SITE_WIDTH * (1 - scale)) / 2 }, { translateY: -(height / scale) * (1 - scale) / 2 }, { scale }],
          height: height / scale,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </View>
  );
}

interface ThumbnailProps extends PreviewProps {
  width: number;
  height: number;
  radius?: number;
}

export function StoreSiteThumbnail({ width, height, radius = 16, testID = 'store-site-thumbnail', ...rest }: ThumbnailProps) {
  return (
    <ScaledPage width={width} height={height} radius={radius} themeKey={rest.site.themeKey} testID={testID}>
      <StoreSitePreview {...rest} />
    </ScaledPage>
  );
}

const s = StyleSheet.create({
  page: { width: '100%', paddingBottom: 32 },
  topSpace: { height: 56 },
  hero: { alignItems: 'center', paddingHorizontal: 16 },
  logo: { width: 104, height: 104, borderRadius: 52, marginBottom: 14 },
  logoPh: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 40, fontWeight: '700' },
  name: { fontSize: 24, lineHeight: 29, fontWeight: '700', textAlign: 'center' },
  bio: { fontSize: 15, lineHeight: 21, textAlign: 'center', marginTop: 6, maxWidth: 320 },
  socials: { flexDirection: 'row', gap: 4, marginTop: 10 },
  social: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  blocks: { paddingHorizontal: 16, marginTop: 24, gap: 12 },
  callout: { borderRadius: 16, padding: 12 },
  row: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  tx: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
  sub: { fontSize: 14, lineHeight: 19 },
  price: { fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  compare: { fontWeight: '400', textDecorationLine: 'line-through' },
  ship: { fontSize: 13 },
  cta: { marginTop: 12, minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  ctaText: { fontSize: 16, fontWeight: '600' },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, borderRadius: 16, paddingVertical: 8, paddingLeft: 8, paddingRight: 16 },
  line: { fontSize: 13, opacity: 0.75 },
  off: { opacity: 0.55 },
  footer: { textAlign: 'center', fontSize: 13, marginTop: 40 },
  checkout: { paddingHorizontal: 16 },
  back: { height: 56, justifyContent: 'center' },
  hero1: { width: '100%', aspectRatio: 1, borderRadius: 16 },
  coTitle: { fontSize: 24, lineHeight: 30, fontWeight: '700', marginTop: 20, marginBottom: 4 },
  coShip: { fontSize: 15, marginTop: 6 },
  coDesc: { fontSize: 15, lineHeight: 22, marginTop: 16 },
  fields: { marginTop: 24, gap: 12 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13 },
  input: { height: 48, borderRadius: 12, borderWidth: 1 },
  coCta: { marginTop: 20, minHeight: 50 },
});
