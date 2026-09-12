import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Switch, Alert, StyleSheet,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, ON_DARK,
  SUCCESS, SUCCESS_DIM,
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { submitReport } from '@/services/socialService';
import { serviceRequest } from '@/lib/serviceConfig';
import { ReportReason, ReportTargetType, REPORT_REASON_LABELS } from '@/services/socialTypes';

const { width: W } = Dimensions.get('window');

const REASONS = Object.entries(REPORT_REASON_LABELS) as [ReportReason, string][];

function targetTypeIcon(targetType: string): string {
  switch (targetType) {
    case 'profile': return 'user';
    case 'post': return 'image';
    case 'story': return 'circle';
    case 'message': return 'message-circle';
    case 'seller': return 'home';
    case 'product': return 'shopping-bag';
    default: return 'flag';
  }
}

export default function BuyerReport() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const PURPLE_DIM = theme.accentDim;
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    targetType: string;
    targetId: string;
    targetLabel: string;
    targetUserId?: string;
  }>();

  const [reason, setReason] = useState<ReportReason | null>(null);
  const [description, setDescription] = useState('');
  const [blockAfter, setBlockAfter] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  async function handleSubmit() {
    if (isSubmitting || !reason) return;
    setIsSubmitting(true);
    try {
      await submitReport({
        targetType: params.targetType as ReportTargetType,
        targetId: params.targetId,
        targetLabel: params.targetLabel,
        reason,
        description,
        blockAfterReport: blockAfter,
        blockParams: params.targetUserId
          ? {
              userId: params.targetUserId,
              name: params.targetLabel,
              handle: '',
              initials: params.targetLabel?.[0] || '?',
              color: PURPLE,
            }
          : undefined,
      });

      // Also persist to API
      try {
        await serviceRequest('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetType: params.targetType,
            targetId: params.targetId,
            targetLabel: params.targetLabel,
            reason,
            description,
          }),
        });
      } catch {
        // API persistence failure is non-blocking — local report still succeeded
      }

      setIsSuccess(true);
    } catch {
      Alert.alert('Error', 'Failed to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isSuccess) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <Feather name="check" size={40} color={SUCCESS} />
          </View>
          <Text style={styles.successTitle}>Report Submitted</Text>
          <Text style={styles.successDesc}>
            {'Thank you for keeping Brandthread safe.\nWe\'ll review this within 24 hours.'}
          </Text>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.85} style={styles.doneWrap}>
            <LinearGradient
               colors={theme.primaryGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.doneBtn}
            >
               <Text style={[styles.doneBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Done</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const minReasonWidth = (W - SP.md * 2 - SP.sm * 2) / 3;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.closeBtn}>×</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Report</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + SP.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        {/* CONTEXT CARD */}
        <View style={styles.contextCard}>
          <Feather
            name={targetTypeIcon(params.targetType) as any}
            size={ICON.md}
            color={PURPLE}
          />
          <View style={{ marginLeft: SP.sm }}>
            <Text style={styles.contextType}>
              Reporting {params.targetType?.replace(/_/g, ' ')}
            </Text>
            <Text style={styles.contextLabel}>{params.targetLabel}</Text>
          </View>
        </View>

        {/* REASON SECTION */}
        <View style={styles.reasonSection}>
          <Text style={styles.sectionTitle}>Why are you reporting this?</Text>
          <View style={styles.reasonGrid}>
            {REASONS.map(([r, label]) => (
              <TouchableOpacity
                key={r}
                style={[
                  styles.reasonChip,
                  { minWidth: minReasonWidth },
                  reason === r && styles.reasonChipActive,
                ]}
                onPress={() => setReason(r)}
                activeOpacity={0.7}
              >
                <Text style={[styles.reasonLabel, reason === r && styles.reasonLabelActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* DESCRIPTION */}
        <View style={styles.descSection}>
          <Text style={styles.descLabel}>Additional details (optional)</Text>
          <TextInput
            style={styles.descInput}
            value={description}
            onChangeText={setDescription}
            placeholder="Describe what happened..."
            placeholderTextColor={SUBTLE}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* BLOCK TOGGLE */}
        {params.targetUserId ? (
          <View style={styles.blockRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.blockTitle}>Block this account</Text>
              <Text style={styles.blockDesc}>
                They won't be able to see your profile or contact you.
              </Text>
            </View>
            <Switch
              value={blockAfter}
              onValueChange={setBlockAfter}
              trackColor={{ false: BORDER, true: PURPLE }}
              thumbColor={ON_DARK}
            />
          </View>
        ) : null}

        {/* SUBMIT BUTTON */}
        <TouchableOpacity
          style={[styles.submitWrap, { opacity: reason ? 1 : 0.4 }]}
          onPress={handleSubmit}
          disabled={!reason || isSubmitting}
          activeOpacity={0.85}
        >
          <LinearGradient
             colors={theme.primaryGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.submitBtn}
          >
             <Text style={[styles.submitBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>
              {isSubmitting ? 'Submitting...' : 'Submit Report'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: { accent: string; accentLight: string; accentDim: string }) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  closeBtn: {
    color: MUTED,
    fontSize: FS.xl,
    lineHeight: 28,
    width: 40,
    textAlign: 'left',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: FS.md,
    fontFamily: FONT.semibold,
    color: FG,
  },
  contextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    marginHorizontal: SP.md,
    marginTop: SP.md,
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
  },
  contextType: {
    color: MUTED,
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  contextLabel: {
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    marginTop: 2,
  },
  reasonSection: {
    paddingHorizontal: SP.md,
    marginTop: SP.lg,
  },
  sectionTitle: {
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    marginBottom: SP.md,
  },
  reasonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
  },
  reasonChip: {
    flex: 1,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    padding: SP.sm,
    alignItems: 'center',
  },
  reasonChipActive: {
    backgroundColor: theme.accentDim,
    borderColor: theme.accent,
  },
  reasonLabel: {
    color: MUTED,
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    textAlign: 'center',
  },
  reasonLabelActive: {
    color: theme.accent,
  },
  descSection: {
    paddingHorizontal: SP.md,
    marginTop: SP.lg,
  },
  descLabel: {
    color: MUTED,
    fontSize: FS.sm,
    marginBottom: SP.xs,
  },
  descInput: {
    minHeight: 100,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    padding: SP.md,
    color: FG,
    fontFamily: FONT.regular,
    fontSize: FS.base,
  },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    marginHorizontal: SP.md,
    marginTop: SP.md,
  },
  blockTitle: {
    color: FG,
    fontFamily: FONT.medium,
    fontSize: FS.base,
  },
  blockDesc: {
    color: MUTED,
    fontSize: FS.xs,
    marginTop: 2,
  },
  submitWrap: {
    paddingHorizontal: SP.md,
    marginTop: SP.xl,
  },
  submitBtn: {
    height: COMP.buttonH,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: {
    color: ON_DARK,
    fontFamily: FONT.semibold,
    fontSize: FS.base,
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: SP.xxl,
    paddingHorizontal: SP.lg,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: SUCCESS_DIM,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    color: FG,
    fontFamily: FONT.bold,
    fontSize: FS.lg,
    textAlign: 'center',
    marginTop: SP.lg,
  },
  successDesc: {
    color: MUTED,
    fontSize: FS.base,
    textAlign: 'center',
    marginTop: SP.sm,
    lineHeight: 22,
  },
  doneWrap: {
    marginTop: SP.xl,
    width: '100%',
  },
  doneBtn: {
    height: COMP.buttonH,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    color: ON_DARK,
    fontFamily: FONT.semibold,
    fontSize: FS.base,
  },
});
