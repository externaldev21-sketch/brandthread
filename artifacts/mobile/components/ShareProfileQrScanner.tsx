/**
 * QR scanner opened from the share-profile screen's scan icon.
 *
 * Layout mirrors the Mobbin Instagram QR-scanner reference 1:1: a full-bleed
 * camera viewfinder with rounded corner brackets, a back chevron top-left,
 * and a small icon top-right. Scanning a valid Brandthread profile QR code
 * (or deep link) navigates straight to that scanned user's public profile;
 * anything else is ignored so a foreign QR code never routes anywhere.
 *
 * Camera access is native/web-preview dependent — see the honesty note in
 * the PR description. Without a granted camera permission this renders a
 * clear "camera unavailable" state instead of a blank screen.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';

import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { parseProfileDeepLink } from '@/lib/shareProfile';
import { hapticSuccess } from '@/lib/haptics';
import { radius } from '@/constants/radii';

interface ShareProfileQrScannerProps {
  onClose: () => void;
}

const BRACKET = 44;
const FRAME_SIZE = 260;

export function ShareProfileQrScanner({ onClose }: ShareProfileQrScannerProps) {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [handled, setHandled] = useState(false);
  const topInset = useHeaderTopInset();

  // Prompt once on mount (native only — web has no meaningful permission
  // prompt here and should show the "not available in preview" state).
  useEffect(() => {
    if (Platform.OS !== 'web' && permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission?.granted]);

  const handleScanned = useCallback((result: BarcodeScanningResult) => {
    if (handled) return;
    const username = parseProfileDeepLink(result.data);
    if (!username) return; // Not a Brandthread profile QR — ignore, keep scanning.
    setHandled(true);
    hapticSuccess();
    onClose();
    router.push(`/u/${username}` as never);
  }, [handled, onClose, router]);

  const cameraReady = permission?.granted;

  return (
    <View style={styles.root} testID="share-profile-qr-scanner">
      {cameraReady ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleScanned}
        />
      ) : (
        <View style={styles.permissionState}>
          <Feather name="camera-off" size={40} color="#FFFFFF" />
          <Text style={styles.permissionTitle}>Camera unavailable</Text>
          <Text style={styles.permissionBody}>
            {Platform.OS === 'web'
              ? "Scanning isn't available on web. Try it on a phone."
              : 'Allow camera access to scan a Brandthread profile code.'}
          </Text>
          {Platform.OS !== 'web' && (
            <Pressable
              onPress={requestPermission}
              style={styles.permissionBtn}
              accessibilityRole="button"
              accessibilityLabel="Allow camera access"
            >
              <Text style={styles.permissionBtnText}>Allow Camera</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* ── Viewfinder corner brackets ── */}
      <View pointerEvents="none" style={styles.frameWrap}>
        <View style={styles.frame}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
      </View>

      <View style={[styles.headerRow, { top: topInset + SP.sm }]}>
        <Pressable
          onPress={onClose}
          style={styles.headerIcon}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="qr-scanner-back"
        >
          <Feather name="chevron-left" size={ICON.lg} color="#FFFFFF" />
        </Pressable>
        <Pressable
          onPress={onClose}
          style={styles.headerIcon}
          accessibilityRole="button"
          accessibilityLabel="Close scanner"
        >
          <Feather name="x" size={ICON.md} color="#FFFFFF" />
        </Pressable>
      </View>

      <Text style={styles.hint}>Point your camera at a Brandthread QR code</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  headerRow: {
    position: 'absolute',
    left: SP.md,
    right: SP.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  frameWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: { width: FRAME_SIZE, height: FRAME_SIZE },
  corner: {
    position: 'absolute',
    width: BRACKET,
    height: BRACKET,
    borderColor: '#FFFFFF',
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: RADIUS.md },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: RADIUS.md },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: RADIUS.md },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: RADIUS.md },
  hint: {
    position: 'absolute',
    bottom: 64,
    alignSelf: 'center',
    color: '#FFFFFF',
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
    borderRadius: RADIUS.pill,
  },
  permissionState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.xl,
    gap: SP.sm,
  },
  permissionTitle: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: FS.lg },
  permissionBody: { color: 'rgba(255,255,255,0.7)', fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center' },
  permissionBtn: {
    marginTop: SP.sm,
    paddingHorizontal: SP.lg,
    paddingVertical: SP.sm,
    borderRadius: radius.sm,
    backgroundColor: '#FFFFFF',
  },
  permissionBtnText: { color: '#000000', fontFamily: FONT.semibold, fontSize: FS.sm },
});
