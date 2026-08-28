import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetworkNotice } from '@/hooks/useNetworkNotice';
import {
  dismissNetworkNotice,
  retryNetworkNotice,
} from '@/lib/networkNotice';
import {
  BG,
  BORDER,
  CARD_ELEVATED,
  FG,
  FONT,
  FS,
  MUTED,
  SP,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';

export default function NetworkNoticeBanner() {
  const notice = useNetworkNotice();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();

  if (!notice) return null;

  return (
    <View style={[styles.safeArea, { paddingTop: insets.top }]}>
      <View style={[styles.root, { borderColor: theme.accent }]}>
        <View style={[styles.iconWrap, { backgroundColor: theme.accentDim }]}>
          <Feather
            name={notice.kind === 'offline' ? 'wifi-off' : 'alert-triangle'}
            size={15}
            color={theme.accentLight}
          />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>{notice.title}</Text>
          <Text style={styles.message} numberOfLines={1}>{notice.message}</Text>
        </View>
        {notice.retry ? (
          <TouchableOpacity
            onPress={() => void retryNetworkNotice()}
            disabled={notice.retrying}
            style={[styles.action, { borderColor: theme.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Retry request"
          >
            {notice.retrying
              ? <ActivityIndicator size="small" color={theme.accentLight} />
              : <Text style={[styles.actionText, { color: theme.accentLight }]}>Retry</Text>}
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={dismissNetworkNotice}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Dismiss network message"
        >
          <Feather name="x" size={17} color={MUTED} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: BG,
    zIndex: 30,
  },
  root: {
    minHeight: 48,
    marginHorizontal: SP.md,
    marginBottom: SP.xs,
    paddingHorizontal: SP.sm,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: CARD_ELEVATED,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
  },
  message: {
    color: MUTED,
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    marginTop: 1,
  },
  action: {
    minWidth: 54,
    minHeight: 30,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
  },
});