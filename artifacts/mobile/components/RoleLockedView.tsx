/**
 * Shown when a staff team member opens an owner-only screen.
 * Renders a friendly explanation instead of an error or blank state.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';

interface Props {
  screenTitle: string;
  currentRole?: string;
}

function roleLabel(role?: string): string {
  if (role === 'manager') return 'Manager';
  if (role === 'staff')   return 'Staff';
  if (role === 'owner')   return 'Owner';
  return role ?? 'Team member';
}

export function RoleLockedView({ screenTitle, currentRole }: Props) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <View style={[styles.iconWrap, { backgroundColor: theme.accentDim }]}>
          <Feather name="lock" size={28} color={theme.accent} />
        </View>
        <Text style={styles.title}>Owner access required</Text>
        <Text style={styles.body}>
          Only the store owner can view {screenTitle}. Ask your store owner to grant you
          access or to check this section for you.
        </Text>
        {currentRole ? (
          <View style={styles.rolePill}>
            <Feather name="user" size={12} color={theme.muted} />
            <Text style={styles.roleText}>Your role: {roleLabel(currentRole)}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SP.xl,
  },
  card: {
    backgroundColor: theme.card,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: theme.border,
    padding: SP.xl,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SP.lg,
  },
  title: {
    color: theme.text,
    fontSize: FS.lg,
    fontFamily: FONT.semibold,
    marginBottom: SP.sm,
    textAlign: 'center',
  },
  body: {
    color: theme.muted,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SP.lg,
  },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: `${theme.subtle}22`,
    borderRadius: 20,
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
  },
  roleText: {
    color: theme.muted,
    fontSize: FS.xs,
    fontFamily: FONT.medium,
  },
});
