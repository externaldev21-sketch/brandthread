/**
 * Development-only warning when the API server reports that Clerk rejected
 * its secret key (401 `clerk_key_invalid`). Sign-up and log-in cannot work
 * until the key is fixed, so the developer sees why instead of a silent
 * "signed out". Never rendered in release builds (`__DEV__` is false there),
 * and never shows any part of a key.
 */
import React, { useEffect, useState } from 'react';
import { MEDIA, FONT } from '@/lib/theme';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { serviceRequest } from '@/lib/serviceConfig';

type ClerkStatus = { clerkKeyInvalid: boolean };

export function ClerkKeyBanner({ forceInvalid = false }: { forceInvalid?: boolean }) {
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!__DEV__) return;
    let cancelled = false;
    serviceRequest<ClerkStatus>('/api/public/clerk-status', {}, false)
      .then((r) => { if (!cancelled) setInvalid(!!r?.clerkKeyInvalid); })
      .catch(() => { /* server unreachable: the screens show their own errors */ });
    return () => { cancelled = true; };
  }, []);

  if (!__DEV__ || !(invalid || forceInvalid)) return null;
  return (
    <View testID="clerk-key-invalid-banner" accessibilityRole="alert" style={s.banner}>
      <Feather name="alert-triangle" size={16} color={MEDIA.background} />
      <Text style={s.text}>
        <Text style={s.bold}>Dev only: Clerk rejected CLERK_SECRET_KEY (clerk_key_invalid).</Text>
        {' '}Sign-up and log-in won’t work. Paste the Secret key from the same Clerk instance as the publishable key (sk_test_ with pk_test_, sk_live_ with pk_live_) into the server env and restart.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  banner: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: '#FFD580', marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 8,
  },
  text: { flex: 1, color: MEDIA.background, fontSize: 13, lineHeight: 18 },
  bold: { fontFamily: FONT.bold },
});
