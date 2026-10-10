/**
 * Store link card — the seller's QR code, link, and Copy / Share / Save QR.
 * Used by the Share Store screen. Not a boxed card: the QR sits on its own
 * white tile (it must stay dark-on-white to scan) and the actions are the
 * shared Button pair, equal widths.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useRouter } from 'expo-router';

import { Button } from '@/components/ui';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { TYPE_SCALE } from '@/constants/typography';
import { displayStoreLink } from '@/lib/storeShare';
import type { StoreLinkState } from '@/hooks/useStoreLink';

interface StoreLinkCardProps {
  link: StoreLinkState;
  /** QR edge length. */
  qrSize?: number;
  /** Hide the Save QR action. */
  showSaveQr?: boolean;
  testID?: string;
}

export function StoreLinkCard({
  link, qrSize = 184, showSaveQr = true, testID = 'store-link-card',
}: StoreLinkCardProps) {
  const { theme } = useAppTheme();
  const router = useRouter();

  if (link.loading) {
    return (
      <View style={[styles.root, styles.loading]} testID={`${testID}-loading`}>
        <ActivityIndicator color={theme.muted} />
      </View>
    );
  }

  if (!link.url) {
    // No username yet means no real link — never an invented one.
    return (
      <View style={styles.root} testID={`${testID}-no-username`}>
        <Text style={[styles.title, { color: theme.text }]}>Pick a username</Text>
        <Button
          label="Set username"
          onPress={() => router.push('/edit-profile' as never)}
          fullWidth
          style={styles.spaced}
          testID={`${testID}-set-username`}
        />
      </View>
    );
  }

  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.qrTile} accessible accessibilityRole="image" accessibilityLabel="Store QR code">
        <QRCode
          value={link.url}
          size={qrSize}
          backgroundColor="#FFFFFF"
          // theme-exempt: a QR must stay physically dark-on-white to scan.
          color="#0A0A0B"
        />
      </View>
      {link.brandName ? (
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{link.brandName}</Text>
      ) : null}
      <Text
        style={[styles.link, { color: theme.muted }]}
        numberOfLines={1}
        ellipsizeMode="middle"
        selectable
        testID={`${testID}-url`}
      >
        {displayStoreLink(link.url)}
      </Text>
      <View style={styles.pair}>
        <View style={styles.pairItem}>
          <Button
            label={link.copied ? 'Copied' : 'Copy link'}
            variant="secondary"
            onPress={() => { void link.copy(); }}
            fullWidth
            testID={`${testID}-copy`}
          />
        </View>
        <View style={styles.pairItem}>
          <Button
            label="Share"
            onPress={() => { void link.share(); }}
            fullWidth
            testID={`${testID}-share`}
          />
        </View>
      </View>
      {showSaveQr ? (
        <Button
          label={link.saved ? 'Saved' : 'Save QR code'}
          variant="tertiary"
          onPress={() => { void link.saveQr(); }}
          fullWidth
          style={styles.saveQr}
          testID={`${testID}-save-qr`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', alignItems: 'center' },
  loading: { minHeight: 240, justifyContent: 'center' },
  qrTile: { padding: 16, backgroundColor: '#FFFFFF', borderRadius: 16, marginBottom: 20 },
  title: { ...TYPE_SCALE.headline, textAlign: 'center', maxWidth: '100%' },
  link: { ...TYPE_SCALE.footnote, textAlign: 'center', marginTop: 4, maxWidth: '100%' },
  pair: { flexDirection: 'row', gap: 12, width: '100%', marginTop: 24 },
  pairItem: { flex: 1, minWidth: 0 },
  spaced: { marginTop: 20 },
  saveQr: { marginTop: 8 },
});
