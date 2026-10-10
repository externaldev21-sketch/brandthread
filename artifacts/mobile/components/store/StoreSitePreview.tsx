/**
 * The seller's store website (brandthread.app/@handle), drawn natively so
 * in-app previews match the real page and stay sharp at any size. Mirrors
 * artifacts/api-server/src/lib/growth/storeSitePage.ts: banner, logo, name,
 * bio, social icons, 3:4 product grid with prices, link buttons, footer.
 *
 * `StoreSitePreview` renders it at phone width (390pt); `StoreSiteThumbnail`
 * scales that render down for cards (Share store sheet, My store) instead of
 * rasterising it, so text and edges stay crisp.
 */
import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';

import { Icon } from '@/components/ui/Icon';
import {
  storeSiteFontFamily, storeSiteTheme, type ButtonStyle, type StoreSiteFont,
} from '@/lib/storeSiteDesign';

export const SITE_WIDTH = 390;

export interface StoreSiteView {
  handle: string | null;
  displayName: string;
  bio: string;
  logoUrl: string | null;
  /** Shown only when set (the seller's banner, with "show banner" on). */
  bannerUrl: string | null;
  themeKey: string;
  buttonStyle: ButtonStyle;
  font: StoreSiteFont;
  socials: string[];
  products: { id: string; name: string; image: string | null; priceLabel: string }[];
  links: string[];
}

const BRAND_ICON: Record<string, string> = {
  instagram: 'instagram', tiktok: 'tiktok', youtube: 'youtube', x: 'x-twitter', facebook: 'facebook',
};

function SocialGlyph({ k, color }: { k: string; color: string }) {
  if (BRAND_ICON[k]) return <FontAwesome6 name={BRAND_ICON[k] as never} brand size={20} color={color} />;
  return <Icon name={k === 'email' ? 'mail' : 'globe'} size={20} color={color} />;
}

interface PreviewProps {
  site: StoreSiteView;
  /** Only the first N products (thumbnails don't need the whole grid). */
  maxProducts?: number;
  testID?: string;
}

export function StoreSitePreview({ site, maxProducts, testID = 'store-site-preview' }: PreviewProps) {
  const t = storeSiteTheme(site.themeKey);
  const fontFamily = storeSiteFontFamily(site.font, Platform.OS);
  const ff = fontFamily ? { fontFamily } : null;
  const btnRadius = site.buttonStyle === 'square' ? 0 : 12;
  const tileRadius = site.buttonStyle === 'square' ? 0 : 8;
  const name = site.displayName.trim() || (site.handle ? `@${site.handle}` : '');
  const initial = (name.replace(/^@/, '').trim()[0] ?? 'B').toUpperCase();
  const products = maxProducts != null ? site.products.slice(0, maxProducts) : site.products;
  const hasBanner = !!site.bannerUrl;

  return (
    <View style={[s.page, { backgroundColor: t.bg }]} testID={testID}>
      {hasBanner ? <Image source={{ uri: site.bannerUrl! }} style={[s.banner, { backgroundColor: t.line }]} resizeMode="cover" /> : <View style={s.topSpace} />}
      <View style={s.hero}>
        {site.logoUrl
          ? <Image source={{ uri: site.logoUrl }} style={[s.logo, { backgroundColor: t.line }, hasBanner && [s.logoOnBanner, { borderColor: t.bg }]]} accessibilityLabel={`${name} logo`} />
          : (
            <View style={[s.logo, s.logoPh, { backgroundColor: t.line }, hasBanner && [s.logoOnBanner, { borderColor: t.bg }]]}>
              <Text style={[s.initial, { color: t.fg }, ff]}>{initial}</Text>
            </View>
          )}
        {!!name && <Text style={[s.name, { color: t.fg }, ff]} numberOfLines={2}>{name}</Text>}
        {!!site.bio.trim() && <Text style={[s.bio, { color: t.muted }, ff]} numberOfLines={3}>{site.bio.trim()}</Text>}
        {site.socials.length > 0 && (
          <View style={s.socials}>
            {site.socials.map((k) => <View key={k} style={s.social}><SocialGlyph k={k} color={t.fg} /></View>)}
          </View>
        )}
      </View>
      {products.length > 0 && (
        <View style={s.grid}>
          {products.map((p) => (
            <View key={p.id} style={s.cell}>
              {p.image
                ? <Image source={{ uri: p.image }} style={[s.tile, { borderRadius: tileRadius, backgroundColor: t.line }]} resizeMode="cover" accessibilityLabel={p.name} />
                : <View style={[s.tile, { borderRadius: tileRadius, backgroundColor: t.line }]} />}
              <Text style={[s.pn, { color: t.fg }, ff]} numberOfLines={1}>{p.name}</Text>
              {!!p.priceLabel && <Text style={[s.pp, { color: t.muted }, ff]}>{p.priceLabel}</Text>}
            </View>
          ))}
        </View>
      )}
      {site.links.length > 0 && (
        <View style={s.links}>
          {site.links.map((title, i) => (
            <View key={`${i}-${title}`} style={[s.btn, { backgroundColor: t.buttonBg, borderRadius: btnRadius }]}>
              <Text style={[s.btnText, { color: t.buttonFg }, ff]} numberOfLines={1}>{title}</Text>
            </View>
          ))}
        </View>
      )}
      <Text style={[s.footer, { color: t.muted }]}>
        Powered by <Text style={{ color: t.fg, fontWeight: '600' }}>Brandthread</Text>
      </Text>
    </View>
  );
}

interface ThumbnailProps extends PreviewProps {
  /** Rendered width of the thumbnail. */
  width: number;
  /** Rendered height; the page is cropped at the bottom. */
  height: number;
  radius?: number;
}

/** The full-size render, scaled down and cropped — crisp, not a screenshot. */
export function StoreSiteThumbnail({ width, height, radius = 16, testID = 'store-site-thumbnail', ...rest }: ThumbnailProps) {
  const scale = width / SITE_WIDTH;
  const t = storeSiteTheme(rest.site.themeKey);
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
        <StoreSitePreview {...rest} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { width: '100%', paddingBottom: 32 },
  banner: { width: '100%', aspectRatio: 3 },
  topSpace: { height: 56 },
  hero: { alignItems: 'center', paddingHorizontal: 16 },
  logo: { width: 96, height: 96, borderRadius: 48, marginBottom: 16 },
  logoOnBanner: { marginTop: -48, borderWidth: 3 },
  logoPh: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 36, fontWeight: '700' },
  name: { fontSize: 22, lineHeight: 28, fontWeight: '700', textAlign: 'center' },
  bio: { fontSize: 15, lineHeight: 21, textAlign: 'center', marginTop: 6, maxWidth: 320 },
  socials: { flexDirection: 'row', gap: 4, marginTop: 12 },
  social: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, marginTop: 28, columnGap: 12, rowGap: 20 },
  cell: { width: (SITE_WIDTH - 32 - 12) / 2 },
  tile: { width: '100%', aspectRatio: 3 / 4 },
  pn: { fontSize: 15, fontWeight: '600', marginTop: 8 },
  pp: { fontSize: 15, marginTop: 2, fontVariant: ['tabular-nums'] },
  links: { paddingHorizontal: 16, marginTop: 28, gap: 12 },
  btn: { minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  btnText: { fontSize: 16, fontWeight: '600' },
  footer: { textAlign: 'center', fontSize: 13, marginTop: 40 },
});
