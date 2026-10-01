/**
 * Privacy & safety — chat details > Privacy & safety. Real, functioning
 * actions: Block/Unblock (reuses lib/safety.ts's confirmBlock/confirmUnblock,
 * the same flow used everywhere else in the app) and Report. Brandthread has
 * no "Restrict" (limited-visibility) concept in its backend — only a hard
 * block — so this screen doesn't fabricate a non-functional Restrict row;
 * see docs/dm-flows.md for this documented scope decision.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, ICON } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';
import { hapticPrimaryAction, hapticSelection } from '@/lib/haptics';
import { confirmBlock, confirmUnblock } from '@/lib/safety';
import { useApi } from '@/lib/api';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useReportSheet } from '@/components/safety/ReportSheet';

export default function ConversationPrivacySafetyScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(), []);
  const router = useRouter();
  const api = useApi();
  const params = useLocalSearchParams<{ id: string; participantUserId: string; participantName: string }>();
  const { openReport } = useReportSheet();
  const [isBlocked, setIsBlocked] = useState(false);

  // The switch reflects the server, not a guess: load whether I already blocked them.
  useEffect(() => {
    if (!params.participantUserId) return;
    let cancelled = false;
    api.trust.blockStatus(params.participantUserId)
      .then((status) => { if (!cancelled) setIsBlocked(status.blockedByMe); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, params.participantUserId]);

  async function toggleBlock() {
    hapticSelection();
    const subject = { userId: params.participantUserId, name: params.participantName };
    const ok = isBlocked
      ? await confirmUnblock(subject, api.social.unblock)
      : await confirmBlock(subject, api.social.block);
    if (ok) setIsBlocked((v) => !v);
  }

  function report() {
    hapticSelection();
    openReport({
      targetType: 'profile',
      targetId: params.participantUserId,
      ownerId: params.participantUserId,
      ownerName: params.participantName,
    });
  }

  return (
    <View style={[s.root, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title="Privacy & safety"
        onBack={() => { hapticPrimaryAction(); goBackOr(router); }}
        backTestID="privacy-safety-back"
      />

      <View style={[s.list, { borderColor: theme.border }]}>
        <PressableScale rippleEnabled={false} onPress={toggleBlock} testID="privacy-safety-block">
          <View style={[s.row, { borderBottomColor: theme.border }]}>
            <Feather name="slash" size={ICON.md} color={theme.error} style={{ width: 28 }} />
            <Text style={[s.rowTitle, { color: theme.error }]}>{isBlocked ? `Unblock ${params.participantName}` : `Block ${params.participantName}`}</Text>
          </View>
        </PressableScale>
        <PressableScale rippleEnabled={false} onPress={report} testID="privacy-safety-report">
          <View style={s.row}>
            <Feather name="alert-circle" size={ICON.md} color={theme.text} style={{ width: 28 }} />
            <Text style={[s.rowTitle, { color: theme.text }]}>Report {params.participantName}</Text>
          </View>
        </PressableScale>
      </View>

      <Text style={[s.explainer, { color: theme.muted }]}>
        Blocking stops {params.participantName} from finding your profile, seeing your posts, comments or
        stories, or messaging you. You won’t see theirs either. They aren’t notified.
      </Text>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  root: { flex: 1 },
  list: { marginTop: SP.md, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.md, paddingVertical: SP.md, borderBottomWidth: StyleSheet.hairlineWidth },
  rowTitle: { fontSize: FS.base, fontFamily: FONT.medium },
  explainer: { fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 16, paddingHorizontal: SP.md, marginTop: SP.md },
});
