import React, { useCallback, useEffect, useState } from 'react';
import SellerHomeCommerceDashboard from '@/components/SellerHomeCommerceDashboard';
import StripeConnectWarning from '@/components/StripeConnectWarning';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { getSetupState, type SetupState } from '@/lib/setupStore';
import { LoadingSkeleton } from '@/components/BrandthreadUI';
import { SP, RADIUS, SCREEN_BG } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';

const DEFAULT_SETUP: SetupState = {
  started: false,
  dismissed: false,
  currentStep: null,
  tasks: [],
  dismissedTips: [],
  openedFeatures: [],
  lastUpdated: Date.now(),
};

// ─── Screen ───────────────────────────────────────────────────────────────────
//
// This screen is a thin host for the seller dashboard: it resolves the
// authenticated seller's setup checklist state and hands it, plus the
// authenticated user id, to SellerHomeCommerceDashboard, which owns all of
// the dashboard's own data fetching and layout.
export default function SellerHomeScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const api = useApi();

  const [loading, setLoading] = useState(true);
  const [setupState, setSetupState] = useState<SetupState>(DEFAULT_SETUP);

  const loadSetup = useCallback(async () => {
    let onboardingComplete = false;
    try {
      const profile = await api.auth.me();
      onboardingComplete = profile.accountType === 'seller' && profile.onboardingComplete === true;
    } catch {
      // The local checklist remains available if profile refresh is offline.
    }
    const state = await getSetupState(userId, { onboardingComplete });
    setSetupState(state);
    setLoading(false);
  }, [api, userId]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    void loadSetup();
  }, [loadSetup, userId]);

  if (loading) {
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <StripeConnectWarning />
        <View style={[styles.loadingRoot, { paddingTop: insets.top + SP.md }]}>
          <LoadingSkeleton height={16} style={{ width: 120 }} />
          <LoadingSkeleton height={52} style={{ width: 220, marginTop: SP.sm }} />
          <LoadingSkeleton height={168} style={{ marginTop: SP.lg, borderRadius: RADIUS.md }} />
          <View style={styles.loadingTiles}>
            <LoadingSkeleton height={92} style={{ flex: 1, borderRadius: RADIUS.lg }} />
            <LoadingSkeleton height={92} style={{ flex: 1, borderRadius: RADIUS.lg }} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StripeConnectWarning />
      <SellerHomeCommerceDashboard
        topInset={insets.top}
        userId={userId}
        setupState={setupState}
        onSetupStateChange={setSetupState}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Transparent: the Stack's own screenLayout already paints theme.background
  // behind every scene, so this screen root must not double-paint it.
  root: { flex: 1, backgroundColor: SCREEN_BG },
  loadingRoot: { flex: 1, paddingHorizontal: SP.md },
  loadingTiles: { flexDirection: 'row', gap: SP.sm, marginTop: SP.sm },
});
