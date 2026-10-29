import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@clerk/expo';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useAppTheme, AppThemePreset } from '@/contexts/AppThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { RetryRow } from '@/components/ui/RetryRow';
import { RoleLockedView } from '@/components/RoleLockedView';
import { LoadingSkeleton } from '@/components/BrandthreadUI';
import { useApi } from '@/lib/api';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { hasPayoutsAccess, isManagerRole } from '@/lib/roleError';
import { useTeamRole } from '@/hooks/useTeamRole';
import {
  PayoutSetup,
  SetupState,
  SetupStep,
  completedCount,
  demoPayoutSetup,
  formatDeadline,
  idleSteps,
  normalizePayoutSetup,
  setupCtaLabel,
  setupHeadline,
} from '@/lib/payoutSetupSteps';
import { crispPx } from '@/lib/crispPixel';

const DEMO_STATES: SetupState[] = ['not_started', 'in_progress', 'in_review', 'complete', 'restricted'];

const STATUS_LABEL: Record<SetupStep['status'], string> = {
  complete: 'Done',
  needed: 'Needed',
  in_review: 'In review',
};

export default function PayoutSetupScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const api = useApi();
  const params = useLocalSearchParams<{ returned?: string; refresh?: string; state?: string }>();
  const { isLoaded, isSignedIn } = useAuth();
  // Any seller web preview skips the API (lib/api.ts rejects it signed in or not).
  const sellerPreview = isSellerDevPreview();
  const demoActive = isPreviewDemoMode();
  const skipApi = sellerPreview || demoActive;
  // Same gate as Payouts: staff without payout access get the role lock, not
  // a generic load error. Managers can look but not start Stripe onboarding.
  const { currentRole, isLoadingRole, roleError, retryRole } = useTeamRole();
  const isReadOnly = isManagerRole(currentRole);
  const demoState = demoActive
    ? (DEMO_STATES.includes(params.state as SetupState) ? (params.state as SetupState) : 'not_started')
    : null;

  const [setup, setSetup] = useState<PayoutSetup | null>(null);
  const [loading, setLoading] = useState(!skipApi);
  const [loadError, setLoadError] = useState(false);
  const [opening, setOpening] = useState(false);
  const busy = useRef(false);
  const fetching = useRef(false);

  const refresh = useCallback(async () => {
    if (skipApi || !isLoaded || !isSignedIn || fetching.current) return;
    fetching.current = true;
    try {
      setSetup(normalizePayoutSetup(await api.seller.connect.status()));
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      fetching.current = false;
      setLoading(false);
    }
  }, [api, isLoaded, isSignedIn, skipApi]);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void refresh(); });
    return () => sub.remove();
  }, [refresh]);

  const openHostedLink = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setOpening(true);
    try {
      const link = await api.seller.connect.link();
      if (!link || typeof link.url !== 'string' || !/^https:\/\//i.test(link.url)) {
        throw new Error('Stripe did not provide a valid link.');
      }
      await WebBrowser.openBrowserAsync(link.url);
      await refresh();
    } catch (error: any) {
      Alert.alert("Couldn't open Stripe", typeof error?.message === 'string' && error.message ? error.message : 'Try again.');
    } finally {
      busy.current = false;
      setOpening(false);
    }
  }, [api, refresh]);

  // Stripe sends an expired link back here with ?refresh=1; mint a new one.
  const autoResumed = useRef(false);
  useEffect(() => {
    if (params.refresh === '1' && !autoResumed.current && !skipApi && isLoaded && isSignedIn) {
      autoResumed.current = true;
      void openHostedLink();
    }
  }, [params.refresh, skipApi, isLoaded, isSignedIn, openHostedLink]);

  const view: PayoutSetup | null = demoState
    ? demoPayoutSetup(demoState)
    : sellerPreview
      ? { state: 'not_started', steps: idleSteps(), deadline: null, bankLast4: null, providerConfigured: true }
      : setup;

  const onCta = () => {
    if (!view || skipApi) return;
    if (view.state === 'in_review') { void refresh(); return; }
    void openHostedLink();
  };

  const headline = view ? setupHeadline(view.state) : null;
  const cta = view ? setupCtaLabel(view.state) : null;
  const deadline = view ? formatDeadline(view.deadline) : null;
  const done = view ? completedCount(view.steps) : 0;
  const complete = view?.state === 'complete';

  const goBack = () => goBackOr(router, '/payouts');

  if (!skipApi && isLoadingRole) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Payout setup" onBack={goBack} />
        <View style={styles.skeleton}>
          <LoadingSkeleton height={96} />
          <LoadingSkeleton height={210} />
        </View>
      </View>
    );
  }

  // A failed role lookup is not "no access": retry instead of the lock.
  if (!skipApi && roleError) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Payout setup" onBack={goBack} />
        <View style={{ padding: SP.md }}>
          <RetryRow label="Couldn't load payout setup" onRetry={retryRole} />
        </View>
      </View>
    );
  }

  if (!skipApi && !hasPayoutsAccess(currentRole) && !isReadOnly) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Payout setup" onBack={goBack} />
        <RoleLockedView screenTitle="payout setup" currentRole={currentRole ?? undefined} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Payout setup" onBack={goBack} />
      {loading ? (
        <View style={styles.skeleton}>
          <LoadingSkeleton height={96} />
          <LoadingSkeleton height={210} />
        </View>
      ) : !view ? (
        <ErrorState
          message="Couldn't load your payout setup."
          onRetry={() => { setLoading(true); void refresh(); }}
        />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.content} testID="payout-setup-scroll">
            {complete && (
              <View style={styles.readyBadge}><Icon name="check" size={28} color={theme.onAccent} /></View>
            )}
            <Text style={styles.headTitle} testID="payout-setup-title">{headline?.title}</Text>
            <Text style={styles.headBody}>{headline?.body}</Text>
            {deadline && !complete && (
              <Text style={styles.deadline} testID="payout-setup-deadline">Stripe needs this by {deadline}</Text>
            )}

            {!complete && (
              <View style={styles.progress} accessibilityLabel={`${done} of 3 steps done`}>
                {view.steps.map((s) => (
                  <View key={s.id} style={[styles.progressSeg, s.status === 'complete' && styles.progressSegOn]} />
                ))}
              </View>
            )}

            <View style={styles.list}>
              {view.steps.map((step, i) => (
                <View key={step.id} style={[styles.row, i > 0 && styles.rowDivider]} testID={`payout-step-${step.id}`}>
                  <StepIcon status={step.status} theme={theme} />
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{step.label}</Text>
                    <Text style={styles.rowDetail}>
                      {step.pastDue ? `Overdue. ${step.detail}` : step.detail}
                    </Text>
                  </View>
                  <Text style={[styles.rowStatus, step.status === 'needed' && styles.rowStatusNeeded]}>
                    {STATUS_LABEL[step.status]}
                  </Text>
                </View>
              ))}
            </View>

            {complete && view.bankLast4 && (
              <Text style={styles.footnote}>Payouts go to bank account ···{view.bankLast4}</Text>
            )}
            {loadError && <Text style={styles.footnote}>Could not refresh. Showing the last known status.</Text>}
          </ScrollView>

          {cta && view.providerConfigured && !isReadOnly && (
            <View style={styles.footer}>
              <TouchableOpacity
                testID="payout-setup-cta"
                style={[styles.primaryBtn, (opening || skipApi) && styles.btnDisabled]}
                onPress={onCta}
                disabled={opening || skipApi}
                accessibilityRole="button"
                accessibilityLabel={cta}
              >
                {opening
                  ? <ActivityIndicator color={theme.onAccent} />
                  : <Text style={styles.primaryText}>{cta}</Text>}
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </View>
  );
}

function StepIcon({ status, theme }: { status: SetupStep['status']; theme: AppThemePreset }) {
  if (status === 'complete') {
    return (
      <View style={[iconStyles.circle, { backgroundColor: theme.text, borderColor: theme.text }]}>
        <Icon name="check" size={14} color={theme.background} />
      </View>
    );
  }
  return (
    <View style={[iconStyles.circle, { borderColor: theme.muted }]}>
      {status === 'in_review' && <Icon name="clock" size={13} color={theme.muted} />}
    </View>
  );
}

const iconStyles = StyleSheet.create({
  circle: { width: 26, height: 26, borderRadius: 13, borderWidth: crispPx(1.5), alignItems: 'center', justifyContent: 'center' },
});

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  skeleton: { padding: SP.md, gap: SP.sm },
  content: { paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: SP.xl },
  readyBadge: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.text, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md },
  headTitle: { color: theme.text, fontSize: 28, lineHeight: 34, fontFamily: FONT.bold, letterSpacing: -0.4 },
  headBody: { color: theme.muted, fontSize: FS.base, lineHeight: 22, fontFamily: FONT.regular, marginTop: SP.sm },
  deadline: { color: theme.text, fontSize: FS.sm, fontFamily: FONT.semibold, marginTop: SP.sm },
  progress: { flexDirection: 'row', gap: SP.sm, marginTop: SP.lg },
  progressSeg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: theme.border },
  progressSegOn: { backgroundColor: theme.text },
  list: { marginTop: SP.lg, borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.lg, backgroundColor: theme.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, padding: SP.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: theme.border },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { color: theme.text, fontSize: FS.base, fontFamily: FONT.semibold },
  rowDetail: { color: theme.muted, fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 2 },
  rowStatus: { color: theme.muted, fontSize: FS.sm, fontFamily: FONT.medium },
  rowStatusNeeded: { color: theme.text, fontFamily: FONT.semibold },
  footnote: { color: theme.muted, fontSize: FS.sm, fontFamily: FONT.regular, marginTop: SP.md, textAlign: 'center' },
  footer: { paddingHorizontal: SP.md, paddingVertical: SP.sm, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.background },
  primaryBtn: { height: 52, borderRadius: RADIUS.lg, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: theme.onAccent, fontSize: FS.base, fontFamily: FONT.semibold },
  btnDisabled: { opacity: 0.5 },
});
