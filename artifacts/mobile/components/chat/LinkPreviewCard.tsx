/**
 * Link card under a DM's text (polish #163), copied from Instagram Direct:
 * the page's image on top, then its title and the site name. Tapping opens
 * the link. Nothing renders until the server returns a preview, and nothing
 * at all for a page without one, so a plain link never shows a broken box.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { firstLink, loadLinkPreview, type LinkPreview } from '@/lib/linkPreview';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

export function LinkPreviewCard({ text, enabled = true }: { text: string | null | undefined; enabled?: boolean }) {
  const api = useApi();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const url = enabled ? firstLink(text) : null;
  const [preview, setPreview] = useState<LinkPreview | null>(null);

  useEffect(() => {
    setPreview(null);
    if (!url) return undefined;
    let active = true;
    void loadLinkPreview(url, (u) => api.conversations.linkPreview(u)).then((p) => { if (active) setPreview(p); });
    return () => { active = false; };
  }, [api, url]);

  if (!preview) return null;
  return (
    <PressableScale
      style={styles.card}
      onPress={() => { void Linking.openURL(preview.url).catch(() => {}); }}
      accessibilityRole="link"
      accessibilityLabel={`${preview.title}, ${preview.siteName}`}
      testID="dm-link-preview"
    >
      {preview.imageUrl ? (
        <CachedImage source={{ uri: preview.imageUrl }} style={styles.image} contentFit="cover" />
      ) : null}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>{preview.title}</Text>
        <Text style={styles.site} numberOfLines={1}>{preview.siteName}</Text>
      </View>
    </PressableScale>
  );
}

const makeStyles = (theme: { background: string; border: string; text: string; muted: string }) => StyleSheet.create({
  card: {
    marginTop: SP.sm,
    width: 236,
    maxWidth: '100%',
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    backgroundColor: theme.background,
    borderWidth: 1,
    borderColor: theme.border,
  },
  image: { width: '100%', aspectRatio: 1.91 },
  body: { paddingHorizontal: SP.sm + 4, paddingVertical: SP.sm + 2, gap: 2 },
  title: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm, lineHeight: 18 },
  site: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs },
});
