/**
 * Brandthread AI Brain — AI Settings Screen
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Switch,
  TouchableOpacity,
  Pressable,
  Alert,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, PURPLE,
  FONT, FS, SP, RADIUS,
} from '../lib/theme';
import { AISettings } from '../services/aiTypes';
import { getAISettings, saveAISettings, clearSession } from '../services/aiService';
import { clearAuditLog } from '../services/aiAuditLog';

const BORDER_COLOR = 'rgba(255,255,255,0.07)';
const TRACK_FALSE  = 'rgba(255,255,255,0.07)';
const TRACK_TRUE   = '#8B5CF6';

// ─── Local Helpers ─────────────────────────────────────────────────────────────

function SettingSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={sectionStyles.wrapper}>
      <Text style={sectionStyles.title}>{title}</Text>
      {subtitle ? <Text style={sectionStyles.subtitle}>{subtitle}</Text> : null}
      <View style={sectionStyles.card}>{children}</View>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  wrapper: {
    marginBottom: SP.lg,
  },
  title: {
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  subtitle: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: SUBTLE,
    marginBottom: SP.sm,
    paddingHorizontal: 2,
  },
  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    overflow: 'hidden',
  },
});

function RowDivider() {
  return <View style={{ height: 1, backgroundColor: BORDER_COLOR, marginHorizontal: SP.md }} />;
}

function ToggleRow({
  label,
  subtitle,
  value,
  onValueChange,
}: {
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={rowStyles.row}>
      <View style={rowStyles.labelWrap}>
        <Text style={rowStyles.label}>{label}</Text>
        {subtitle ? <Text style={rowStyles.subtitle}>{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: TRACK_FALSE, true: TRACK_TRUE }}
        thumbColor={FG}
      />
    </View>
  );
}

function NavRow({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={rowStyles.row} onPress={onPress}>
      <Text style={rowStyles.label}>{label}</Text>
      <Feather name="chevron-right" size={18} color={MUTED} />
    </Pressable>
  );
}

function ActionRow({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={rowStyles.row} onPress={onPress}>
      <Text style={rowStyles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={rowStyles.row}>
      <Text style={rowStyles.label}>{label}</Text>
      <Text style={rowStyles.infoValue}>{value}</Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
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
    color: FG,
  },
  subtitle: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: SUBTLE,
    marginTop: 2,
  },
  actionLabel: {
    fontFamily: FONT.regular,
    fontSize: FS.base,
    color: MUTED,
  },
  infoValue: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: SUBTLE,
    flex: 1,
    textAlign: 'right',
  },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function AiSettingsScreen() {
  const router = useRouter();
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
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
          <Feather name="chevron-left" size={24} color={FG} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>AI Settings</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Section: Assistant */}
        <SettingSection title="Assistant">
          <ToggleRow
            label="Enable AI assistant"
            value={settings.enabled}
            onValueChange={v => update(s => ({ ...s, enabled: v }))}
          />
          <RowDivider />
          <ToggleRow
            label="Home suggestions"
            subtitle="Smart cards on your dashboard"
            value={settings.suggestionsEnabled}
            onValueChange={v => update(s => ({ ...s, suggestionsEnabled: v }))}
          />
          <RowDivider />
          <ToggleRow
            label="Session memory"
            subtitle="Remembers your current conversation"
            value={settings.sessionMemoryEnabled}
            onValueChange={v => update(s => ({ ...s, sessionMemoryEnabled: v }))}
          />
          <RowDivider />
          <ToggleRow
            label="Brand Memory"
            subtitle="Your brand voice, audience, and style"
            value={settings.brandMemoryEnabled}
            onValueChange={v => update(s => ({ ...s, brandMemoryEnabled: v }))}
          />
          <RowDivider />
          <NavRow
            label="Manage Brand Memory"
            onPress={() => router.push('/ai-brand-memory')}
          />
        </SettingSection>

        {/* Section: Data Sources */}
        <SettingSection
          title="Data Sources"
          subtitle="AI may reference data from these areas"
        >
          <ToggleRow
            label="Products"
            value={ds.products}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, products: v } }))}
          />
          <RowDivider />
          <ToggleRow
            label="Orders"
            value={ds.orders}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, orders: v } }))}
          />
          <RowDivider />
          <ToggleRow
            label="Inventory"
            value={ds.inventory}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, inventory: v } }))}
          />
          <RowDivider />
          <ToggleRow
            label="Analytics"
            value={ds.analytics}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, analytics: v } }))}
          />
          <RowDivider />
          <ToggleRow
            label="Customers"
            value={ds.customers}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, customers: v } }))}
          />
          <RowDivider />
          <ToggleRow
            label="Content"
            value={ds.content}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, content: v } }))}
          />
          <RowDivider />
          <ToggleRow
            label="Manufacturers"
            value={ds.manufacturers}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, manufacturers: v } }))}
          />
          <RowDivider />
          <ToggleRow
            label="Store"
            value={ds.store}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, store: v } }))}
          />
          <RowDivider />
          <ToggleRow
            label="Marketing"
            value={ds.marketing}
            onValueChange={v => update(s => ({ ...s, dataSources: { ...s.dataSources, marketing: v } }))}
          />
        </SettingSection>

        {/* Section: Confirmations */}
        <SettingSection title="Confirmations">
          <ToggleRow
            label="Confirm sensitive actions"
            value={settings.confirmSensitiveActions}
            onValueChange={v => update(s => ({ ...s, confirmSensitiveActions: v }))}
          />
          <RowDivider />
          <ToggleRow
            label="Confirm destructive actions"
            value={settings.confirmDestructiveActions}
            onValueChange={v => update(s => ({ ...s, confirmDestructiveActions: v }))}
          />
          <RowDivider />
          <ToggleRow
            label="Confirm before publishing"
            value={settings.confirmPublishing}
            onValueChange={v => update(s => ({ ...s, confirmPublishing: v }))}
          />
          <RowDivider />
          <ToggleRow
            label="Confirm before sending"
            value={settings.confirmSending}
            onValueChange={v => update(s => ({ ...s, confirmSending: v }))}
          />
        </SettingSection>

        {/* Section: History */}
        <SettingSection title="History">
          <ActionRow
            label="Clear conversation history"
            onPress={handleClearHistory}
          />
          <RowDivider />
          <ActionRow
            label="Clear audit log"
            onPress={handleClearAudit}
          />
        </SettingSection>

        {/* Section: Status */}
        <SettingSection title="Status">
          <InfoRow
            label="AI Provider"
            value="Brandthread OpenAI · Secure server"
          />
          <RowDivider />
          <InfoRow
            label="Mode"
            value="Demo — connect your store for live insights"
          />
          <RowDivider />
          <InfoRow
            label="Version"
            value="AI Brain 1.0"
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingTop: 56,
    paddingBottom: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_COLOR,
    backgroundColor: BG,
  },
  headerBack: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    color: FG,
  },
  headerPlaceholder: {
    width: 40,
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
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    marginBottom: SP.lg,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
  },
  privacyText: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: SUBTLE,
    lineHeight: 18,
  },
});
