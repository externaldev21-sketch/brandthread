import React from 'react';
import { StyleProp, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale, PrimaryButton, SecondaryButton } from '@/components/BrandthreadUI';
import {
  BORDER_SUBTLE,
  FG,
  FONT,
  FS,
  MUTED,
  RADIUS,
  RED,
  SELLER_DASHBOARD_GLASS,
  SP,
  SUBTLE,
} from '@/lib/theme';

export function SellerDashboardSectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeaderRow} testID={`seller-dashboard-section-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <Text style={styles.sectionHeaderTitle} maxFontSizeMultiplier={2}>{title}</Text>
      {action && onAction ? (
        <TouchableOpacity onPress={onAction} style={styles.sectionHeaderActionButton}>
          <Text style={styles.sectionHeaderAction} maxFontSizeMultiplier={2}>{action}</Text>
        </TouchableOpacity>
      ) : action ? <Text style={styles.sectionHeaderAction} maxFontSizeMultiplier={2}>{action}</Text> : null}
    </View>
  );
}

export function SellerDashboardTrendHeader() {
  return (
    <View style={styles.trendHeader} testID="seller-dashboard-trend-header">
      <Text style={styles.trendTitle} maxFontSizeMultiplier={2}>Revenue Trend</Text>
      <Text style={styles.trendPeriod} maxFontSizeMultiplier={2}>Last 7 days</Text>
    </View>
  );
}

export function SellerDashboardActionRow({
  actions,
  testID,
}: {
  actions: Array<{
    label: string;
    onPress: () => void;
    variant: 'primary' | 'secondary';
    icon?: React.ComponentProps<typeof Feather>['name'];
  }>;
  testID: string;
}) {
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 402 || fontScale >= 1.3;

  return (
    <View style={[styles.actionRow, stacked && styles.actionRowStacked]} testID={testID}>
      {actions.map(action => {
        const buttonStyle = [styles.actionButton, stacked && styles.actionButtonStacked];
        return action.variant === 'primary'
          ? <PrimaryButton key={action.label} label={action.label} icon={action.icon} onPress={action.onPress} small style={buttonStyle} />
          : <SecondaryButton key={action.label} label={action.label} icon={action.icon} onPress={action.onPress} small style={buttonStyle} />;
      })}
    </View>
  );
}

export function SellerDashboardListGroup({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.listGroup, style]}>{children}</View>;
}

export function SellerDashboardListItem({
  icon,
  title,
  subtitle,
  value,
  onPress,
  isLast,
  iconColor = FG,
  rightElement,
  badge,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  isLast?: boolean;
  iconColor?: string;
  rightElement?: React.ReactNode;
  badge?: number;
}) {
  const content = (
    <View style={styles.listItem} testID={`seller-dashboard-row-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <View style={[styles.listIconWrap, { backgroundColor: `${iconColor}1A` }]}>
        <Feather name={icon as React.ComponentProps<typeof Feather>['name']} size={16} color={iconColor} />
      </View>
      <View style={styles.listBody}>
        <View style={styles.listTitleRow}>
          <Text style={[styles.listTitle, subtitle && styles.listTitleWithSubtitle]} numberOfLines={2} maxFontSizeMultiplier={2}>
            {title}
          </Text>
          {badge !== undefined && badge > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText} maxFontSizeMultiplier={2}>{badge > 9 ? '9+' : badge}</Text>
            </View>
          ) : null}
        </View>
        {subtitle ? (
          <Text style={styles.listSubtitle} numberOfLines={2} maxFontSizeMultiplier={2}>{subtitle}</Text>
        ) : null}
      </View>
      <View style={styles.listRight}>
        {value ? (
          <Text style={styles.listValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={2}>
            {value}
          </Text>
        ) : null}
        {rightElement}
        {onPress ? <Feather name="chevron-right" size={16} color={SUBTLE} /> : null}
      </View>
    </View>
  );

  return (
    <>
      {onPress ? <PressableScale onPress={onPress}>{content}</PressableScale> : content}
      {!isLast ? <View style={styles.listDivider} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  trendHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: SP.sm,
    paddingHorizontal: 6,
    marginBottom: SP.sm,
  },
  trendTitle: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 120,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  trendPeriod: {
    flexShrink: 0,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionRowStacked: {
    flexDirection: 'column',
  },
  actionButton: {
    flex: 1,
    minWidth: 0,
  },
  actionButtonStacked: {
    flexBasis: 'auto',
    width: '100%',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SP.sm,
    marginBottom: SP.sm,
    paddingHorizontal: 4,
  },
  sectionHeaderTitle: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT.bold,
    color: MUTED,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionHeaderActionButton: {
    flexShrink: 0,
    paddingVertical: 1,
  },
  sectionHeaderAction: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT.medium,
    color: SUBTLE,
  },
  listGroup: {
    backgroundColor: SELLER_DASHBOARD_GLASS,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER_SUBTLE,
    overflow: 'hidden',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: SP.md,
    gap: SP.sm,
  },
  listIconWrap: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  listBody: {
    flex: 1,
    minWidth: 0,
  },
  listTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    minWidth: 0,
  },
  listTitle: {
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: FONT.semibold,
    color: FG,
    letterSpacing: -0.2,
  },
  listTitleWithSubtitle: {
    marginBottom: 2,
  },
  listSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  badge: {
    flexShrink: 0,
    backgroundColor: RED,
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 14,
    fontFamily: FONT.bold,
    color: '#FFF',
  },
  listRight: {
    maxWidth: '38%',
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 4,
    minHeight: 34,
  },
  listValue: {
    flexShrink: 1,
    fontSize: 15,
    fontFamily: FONT.semibold,
    color: FG,
  },
  listDivider: {
    position: 'absolute',
    bottom: 0,
    left: SP.md + 34 + SP.sm,
    right: 0,
    height: 1,
    backgroundColor: BORDER_SUBTLE,
  },
});