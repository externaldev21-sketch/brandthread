import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';
import { useApi } from '@/hooks/useApi';
import { isSellerDevPreview } from '@/lib/devPreview';
import {
  dashboardSuggestionsEnabled,
  selectDashboardSuggestions,
  suggestionAIBrainParams,
} from '@/lib/dashboardAISuggestions';
import { getAISettings, syncAISettingsFromServer } from '@/services/aiService';
import type { AISettings, AISuggestion, SuggestionCategory } from '@/services/aiTypes';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

const CATEGORY_ICON: Partial<Record<SuggestionCategory, React.ComponentProps<typeof Feather>['name']>> = {
  inventory: 'layers',
  orders: 'package',
  content: 'edit-3',
  marketing: 'zap',
  analytics: 'trending-up',
  customers: 'users',
  store: 'layout',
  production: 'clock',
};

/**
 * "Suggestions" on the seller dashboard: GET /api/ai/suggestions, computed
 * by the server from this seller's own inventory, orders and posts. Absent
 * when AI Settings has the assistant or "Dashboard suggestions" off (the
 * server returns nothing then too) and when there is nothing to suggest.
 * `refreshKey` follows the dashboard's own refresh / poll ticks.
 */
export function SellerDashboardAISuggestions({
  theme,
  refreshKey,
  style,
}: {
  theme: AppThemePreset;
  refreshKey: number;
  style?: object;
}) {
  const router = useRouter();
  const api = useApi();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [items, setItems] = useState<AISuggestion[]>([]);
  // A signed-out web preview has no account to compute suggestions from.
  const preview = isSellerDevPreview() && !(isLoaded && isSignedIn);

  // Device copy on every focus (a change made in AI Settings applies on
  // return), then the account's copy.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getAISettings().then((s) => { if (!cancelled) setSettings(s); });
      return () => { cancelled = true; };
    }, []),
  );
  useEffect(() => {
    if (preview || !isLoaded || !isSignedIn) return;
    let cancelled = false;
    (async () => {
      const token = await getToken().catch(() => null);
      const remote = await syncAISettingsFromServer(token);
      if (!cancelled && remote) setSettings(remote);
    })();
    return () => { cancelled = true; };
  }, [preview, isLoaded, isSignedIn, getToken]);

  const enabled = dashboardSuggestionsEnabled(settings);
  useEffect(() => {
    if (preview || !enabled) {
      setItems([]);
      return;
    }
    let cancelled = false;
    api.ai.suggestions()
      .then((body) => { if (!cancelled) setItems(selectDashboardSuggestions(body, settings)); })
      .catch(() => { /* keep the last real list; the card stays absent if there was none */ });
    return () => { cancelled = true; };
  }, [api, enabled, preview, refreshKey, settings]);

  if (!enabled || items.length === 0) return null;

  const askAI = (s: AISuggestion) => {
    router.push({ pathname: '/ai-brain', params: suggestionAIBrainParams(s) } as never);
  };
  const open = (s: AISuggestion) => {
    if (s.actionRoute) router.push(s.actionRoute as never);
    else askAI(s);
  };

  return (
    <View style={style} testID="seller-dashboard-ai-suggestions">
      <Text style={[styles.sectionHeader, { color: theme.muted }]}>Suggestions</Text>
      {items.map((s, index) => (
        <View
          key={s.id}
          style={[styles.row, index > 0 && { borderTopColor: theme.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth }]}
        >
          {/* PressableScale styles its inner view only, so the flex lives on this wrapper. */}
          <View style={styles.mainWrap}>
          <PressableScale
            onPress={() => open(s)}
            style={styles.main}
            accessibilityRole="button"
            accessibilityLabel={`${s.title}. ${s.actionLabel}`}
            testID={`seller-dashboard-ai-suggestion-${s.id}`}
          >
            <View style={[styles.iconWrap, { backgroundColor: theme.cardElevated }]}>
              <Feather name={CATEGORY_ICON[s.category] ?? 'star'} size={16} color={theme.text} />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{s.title}</Text>
              {!!s.reason && (
                <Text style={[styles.subtitle, { color: theme.muted }]} numberOfLines={2}>{s.reason}</Text>
              )}
              <Text style={[styles.action, { color: theme.text }]} numberOfLines={1}>{s.actionLabel}</Text>
            </View>
          </PressableScale>
          </View>
          <TouchableOpacity
            onPress={() => askAI(s)}
            style={[styles.askButton, { borderColor: theme.borderSubtle }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Ask Brandthread AI about: ${s.title}`}
            testID={`seller-dashboard-ai-suggestion-ask-${s.id}`}
          >
            <Text style={[styles.askText, { color: theme.text }]}>Ask AI</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: SP.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingVertical: SP.sm,
  },
  mainWrap: { flex: 1, minWidth: 0 },
  main: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: FONT.semibold, fontSize: FS.sm },
  subtitle: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  action: { fontFamily: FONT.semibold, fontSize: FS.xs, marginTop: 4, textDecorationLine: 'underline' },
  askButton: {
    minHeight: 32,
    paddingHorizontal: SP.sm,
    borderRadius: RADIUS.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askText: { fontFamily: FONT.semibold, fontSize: FS.xs },
});
