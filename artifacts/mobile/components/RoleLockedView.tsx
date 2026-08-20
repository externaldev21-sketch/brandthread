/**
 * Shown when a staff team member opens an owner-only screen.
 * Renders a friendly explanation instead of an error or blank state.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BG, CARD, BORDER, FG, MUTED, SUBTLE, PURPLE, FONT, FS, SP, RADIUS } from '@/lib/theme';

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
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Feather name="lock" size={28} color={PURPLE} />
        </View>
        <Text style={styles.title}>Owner access required</Text>
        <Text style={styles.body}>
          Only the store owner can view {screenTitle}. Ask your store owner to grant you
          access or to check this section for you.
        </Text>
        {currentRole ? (
          <View style={styles.rolePill}>
            <Feather name="user" size={12} color={MUTED} />
            <Text style={styles.roleText}>Your role: {roleLabel(currentRole)}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SP.xl,
  },
  card: {
    backgroundColor: CARD,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.xl,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${PURPLE}18`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SP.lg,
  },
  title: {
    color: FG,
    fontSize: FS.lg,
    fontFamily: FONT.semibold,
    marginBottom: SP.sm,
    textAlign: 'center',
  },
  body: {
    color: MUTED,
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
    backgroundColor: `${SUBTLE}22`,
    borderRadius: 20,
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
  },
  roleText: {
    color: MUTED,
    fontSize: FS.xs,
    fontFamily: FONT.medium,
  },
});
