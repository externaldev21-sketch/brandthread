import React, { useState, useEffect } from 'react';
import { View, Text, Switch, StyleSheet, Platform, Alert, ActivityIndicator } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';

const BIOMETRIC_KEY = 'bt:biometric:enabled';

export default function BiometricUnlockScreen() {
  const colors = useColors();
  const [faceId, setFaceId] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [biometricType, setBiometricType] = useState<string>('Face ID');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (Platform.OS === 'web') {
        setSupported(false);
        setLoading(false);
        return;
      }
      try {
        // Check hardware support
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        setSupported(hasHardware && isEnrolled);

        // Detect biometric type label
        if (hasHardware) {
          const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
          if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
            setBiometricType(Platform.OS === 'ios' ? 'Face ID' : 'Face Recognition');
          } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
            setBiometricType(Platform.OS === 'ios' ? 'Touch ID' : 'Fingerprint');
          } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
            setBiometricType('Iris Scan');
          }
        }

        const saved = await SecureStore.getItemAsync(BIOMETRIC_KEY);
        setFaceId(saved === 'true');
      } catch { /* device may not support */ }
      setLoading(false);
    })();
  }, []);

  async function toggle() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (!supported) {
      Alert.alert(
        'Not available',
        Platform.OS === 'web'
          ? 'Biometric unlock is not available on web.'
          : 'Your device does not have biometrics enrolled. Set up Face ID or fingerprint in device Settings first.',
      );
      return;
    }

    const enabling = !faceId;

    if (enabling) {
      // Require a successful biometric auth before enabling
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: `Confirm your identity to enable ${biometricType}`,
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });

      if (!result.success) {
        Alert.alert('Authentication failed', 'Biometric unlock was not enabled.');
        return;
      }
    }

    const next = enabling;
    setFaceId(next);
    if (Platform.OS !== 'web') {
      await SecureStore.setItemAsync(BIOMETRIC_KEY, next ? 'true' : 'false');
    }

    if (enabling) {
      Alert.alert(
        `${biometricType} enabled`,
        `You will be prompted to authenticate with ${biometricType} the next time you open the app.`,
      );
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Security" />
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <>
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>
                Unlock with {biometricType}
              </Text>
              {!supported && (
                <Text style={[styles.sublabel, { color: colors.mutedForeground }]}>
                  {Platform.OS === 'web'
                    ? 'Not available on web'
                    : 'No biometrics enrolled — set up in device Settings'}
                </Text>
              )}
            </View>
            <Switch
              value={faceId}
              onValueChange={toggle}
              disabled={Platform.OS === 'web'}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
            />
          </View>
          {faceId && (
            <View style={[styles.infoRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
                {biometricType} unlock is active. You'll be prompted when opening the app.
              </Text>
            </View>
          )}
        </>
      )}
      <View style={[styles.body, { backgroundColor: colors.secondary }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { paddingTop: 40, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  label: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  sublabel: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  infoRow: {
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  infoText: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  body: { flex: 1 },
});
