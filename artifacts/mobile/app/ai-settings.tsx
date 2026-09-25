/**
 * Brandthread AI Brain — AI Settings Screen
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { FONT, FS, SP } from '../lib/theme';
import { AISettings } from '../services/aiTypes';
import { getAISettings, saveAISettings, clearSession } from '../services/aiService';
import { clearAuditLog } from '../services/aiAuditLog';
import { useColors } from '@/hooks/useColors';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';

type Colors = ReturnType<typeof useColors>;

// ─── Local Helpers ─────────────────────────────────────────────────────────────

function SettingSection({
  title,
  subtitle,
  colors,
  children,
}: {
  title: string;
  subtitle?: string;
  colors: Colors;
  children: React.ReactNode;
}) {
  const s = React.useMemo(() => makeSectionStyles(colors), [colors]);
  return (
    <View style={s.wrapper}>
      <Text style={s.title}>{title}</Text>
      {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      <View style={s.card}>{children}</View>
    </View>
  );
}

function makeSectionStyles(colors: Colors) {
  return StyleSheet.create({
    wrapper: {
      marginBottom: SP.lg,
    },
    title: {
      fontFamily: FONT.semibold,
      fontSize: FS.xs,
      lineHeight: 14,
      color: colors.mutedForeground,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 4,
      paddingHorizontal: 2,
    },
    subtitle: {
      fontFamily: FONT.regular,
      fontSize: FS.xs,
      lineHeight: 15,
      color: colors.mutedForeground,
      marginBottom: SP.sm,
      paddingHorizontal: 2,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
  });
}

function RowDivider({ colors }: { colors: Colors }) {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: SP.md }} />;
}

function ToggleRow({
  label,
  subtitle,
  value,
  onValueChange,
  colors,
}: {
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  colors: Colors;
}) {
  const s = React.useMemo(() => makeRowStyles(colors), [colors]);
  return (
    <View style={s.row}>
      <View style={s.labelWrap}>
        <Text style={s.label}>{label}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
      <HapticSwitch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={colors.background}
      />
    </View>
  );
}

function NavRow({
  label,
  onPress,
  colors,
}: {
  label: string;
  onPress: () => void;
  colors: Colors;
}) {
  const s = React.useMemo(() => makeRowStyles(colors), [colors]);
  return (
    <Pressable style={s.row} onPress={onPress}>
      <Text style={s.label}>{label}</Text>
      <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
    </Pressable>
  );
}

function ActionRow({
  label,
  onPress,
  colors,
}: {
  label: string;
  onPress: () => void;
  colors: Colors;
}) {
  const s = React.useMemo(() => makeRowStyles(colors), [colors]);
  return (
    <Pressable style={s.row} onPress={onPress}>
      <Text style={s.actionLabel}>{label}</Text>
    </Pressable>
  );
}

function makeRowStyles(colors: Colors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: SP.md,
      paddingVertical: 13,
      minHeight: 52,
    },
    labelWrap: {
      flex: 1,
      paddingRight: SP.sm,
    },
    label: {
      fontFamily: FONT.regular,
      fontSize: FS.base,
      lineHeight: 19,
      color: colors.foreground,
    },
    subtitle: {
      fontFamily: FONT.regular,
      fontSize: FS.xs,
      lineHeight: 15,
      color: colors.mutedForeground,
      marginTop: 2,
    },
    actionLabel: {
      fontFamily: FONT.regular,
      fontSize: FS.base,
      lineHeight: 19,
      color: colors.mutedForeground,
    },
    infoValue: {
      fontFamily: FONT.regular,
      fontSize: FS.sm,
      lineHeight: 17,
      color: colors.mutedForeground,
      flex: 1,
      textAlign: 'right',
    },
  });
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function AiSettingsScreen() {
  const router = useRouter();
  const colors = useColors();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const [settings, setSettings] = useState<AISettings | null>(null);

  useEffect(() => {
    getAISettings().then(setSettings);
  }, []);

  const update = (fn: (s: AISettings) => AISettings) => {
    if (!settings) return;
    const updated = fn(settings);
    setSettings(updated);
    saveAISettings(updated);
  };

  const handleClearHistory = () => {
    Alert.alert(
      'Clear conversation history',
      'This will delete your entire AI conversation history. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearSession().then(() => Alert.alert('History cleared'));
          },
        },
      ],
    );
  };

  const handleClearAudit = () => {
    Alert.alert(
      'Clear audit log',
      'This will delete all AI action history. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearAuditLog().then(() => Alert.alert('Audit log cleared'));
          },
        },
      ],
    );
  };

  if (!settings) return null;

  const ds = settings.dataSources;

  return (
    <View style={styles.container}>
      <ScreenHeader title="AI Settings" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Section: Assistant */}
        <SettingSection title="Assistant" colors={colors}>
          <ToggleRow
            label="Enable AI assistant"
            value={settings.enabled}
            onValueChange={v => update(s => ({ ...s, enabled: v }))}
            colors={colors}
          />
          <RowDivider colors={colors} />
          <ToggleRow
            label="Dashboard suggestions"
            subtitle="Smart cards on your dashboard"
            value={settings.suggestionsEnabled}
            onValueChange={v => update(s => ({ ...s, suggestionsEnabled: v }))}
            colors={colors}
          />
          <RowDivider colors={colors} />
          <ToggleRow
            label="Session memory"
            subtitle="Remembers your current conversation"
            value={settings.sessionMemoryEnabled}
            onValueChange={v => update(s => ({ ...s, sessionMemoryEnabled: v }))}
            colors={colors}
          />
          <RowDivider colors={colors} />
          <ToggleRow
            label="Brand Memory"
            subtitle="Your brand voice, audience, and style"
            value={settings.brandMemoryEnabled}
            onValueChange={v => update(s => ({ ...s, brandMemoryEnabled: v }))}
            colors={colors}
          />
          <RowDivider colors={colors} />
          <NavRow
            label="Manage Brand Memory"
            onPress={() => router.push('/ai-brand-memory')}
            colors={colors}
          />
        </SettingSection>

        {/* Section: Data Sources */}
        <SettingSection
          title="Data Sources"
          subtitle="AI may reference data from these areas"
          colors={colors}
        >
          <ToggleRow
            label="Products"
            value={ds.products}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, products: v } }))}
            colors={colors}
          />
          <RowDivider colors={colors} />
          <ToggleRow
            label="Orders"
            value={ds.orders}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, orders: v } }))}
            colors={colors}
          />
          <RowDivider colors={colors} />
          <ToggleRow
            label="Inventory"
            value={ds.inventory}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, inventory: v } }))}
            colors={colors}
          />
          <RowDivider colors={colors} />
          <ToggleRow
            label="Analytics"
            value={ds.analytics}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, analytics: v } }))}
            colors={colors}
          />
          <RowDivider colors={colors} />
          <ToggleRow
            label="Customers"
            value={ds.customers}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, customers: v } }))}
            colors={colors}
          />
          <RowDivider colors={colors} />
          <ToggleRow
            label="Content"
            value={ds.content}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, content: v } }))}
            colors={colors}
          />
          <RowDivider colors={colors} />
          <ToggleRow
            label="Manufacturers"
            value={ds.manufacturers}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, manufacturers: v } }))}
            colors={colors}
          />
          <RowDivider colors={colors} />
          <ToggleRow
            label="Store"
            value={ds.store}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, store: v } }))}
            colors={colors}
          />
          <RowDivider colors={colors} />
          <ToggleRow
            label="Marketing"
            value={ds.marketing}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, marketing: v } }))}
            colors={colors}
          />
        </SettingSection>

        {/* Section: Confirmations */}
        <SettingSection title="Confirmations" colors={colors}>
          <ToggleRow
            label="Confirm sensitive actions"
            value={settings.confirmSensitiveActions}
            onValueChange={v => update(s => ({ ...s, confirmSensitiveActions: v }))}
            colors={colors}
          />
          <RowDivider colors={colors} />
          <ToggleRow
            label="Confirm destructive actions"
            value={settings.confirmDestructiveActions}
            onValueChange={v => update(s => ({ ...s, confirmDestructiveActions: v }))}
            colors={colors}
          />
          <RowDivider colors={colors} />
          <ToggleRow
            label="Confirm before publishing"
            value={settings.confirmPublishing}
            onValueChange={v => update(s => ({ ...s, confirmPublishing: v }))}
            colors={colors}
          />
          <RowDivider colors={colors} />
          <ToggleRow
            label="Confirm before sending"
            value={settings.confirmSending}
            onValueChange={v => update(s => ({ ...s, confirmSending: v }))}
            colors={colors}
          />
        </SettingSection>

        {/* Section: History */}
        <SettingSection title="History" colors={colors}>
          <ActionRow
            label="Clear conversation history"
            onPress={handleClearHistory}
            colors={colors}
          />
          <RowDivider colors={colors} />
          <ActionRow
            label="Clear audit log"
            onPress={handleClearAudit}
            colors={colors}
          />
        </SettingSection>

        {/* Privacy card */}
        <View style={styles.privacyCard}>
          <Text style={styles.privacyText}>
            Brandthread AI does not use your business data for model training. Data is processed
            per-request and not stored beyond the request lifecycle.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: SP.md,
      paddingTop: SP.lg,
      paddingBottom: 48,
    },
    privacyCard: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 14,
      marginTop: 8,
      marginBottom: SP.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    privacyText: {
      fontFamily: FONT.regular,
      fontSize: FS.xs,
      color: colors.mutedForeground,
      lineHeight: 18,
    },
  });
}
