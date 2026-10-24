import type { IconName } from '@/components/ui/Icon';
import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { Feather } from '@expo/vector-icons';

import SwipeRow, { type SwipeRowAction, type SwipeTone } from '@/components/ui/SwipeRow';

// Only one row may be swiped open at a time (Instagram/TikTok inbox
// convention): opening a row closes whichever row was open before.
let closeOpenRow: (() => void) | null = null;

export interface InboxSwipeAction {
  key: string;
  label: string;
  icon: IconName;
  /** Kept for existing callers; the shared swipe row uses the palette's
   *  neutral greys and the destructive red instead (see `tone`). */
  color?: string;
  textColor?: string;
  tone?: SwipeTone;
  onPress: () => void | Promise<void>;
  accessibilityLabel?: string;
}

interface InboxSwipeRowProps {
  children: React.ReactNode;
  /** Trailing actions (swipe left), listed left-to-right; the last one is
   *  the full-swipe action. */
  actions: InboxSwipeAction[];
  /** Leading actions (swipe right), listed left-to-right; the first one is
   *  the full-swipe action. */
  leadingActions?: InboxSwipeAction[];
  rowId: string;
  disabled?: boolean;
}

const DESTRUCTIVE_KEYS = new Set(['delete', 'block', 'remove']);

function toSwipeAction(action: InboxSwipeAction, index: number, all: InboxSwipeAction[]): SwipeRowAction {
  return {
    key: action.key,
    label: action.label,
    icon: action.icon,
    tone: action.tone ?? (DESTRUCTIVE_KEYS.has(action.key) ? 'destructive' : index === all.length - 1 ? 'neutral' : 'muted'),
    onPress: action.onPress,
    accessibilityLabel: action.accessibilityLabel,
  };
}

/**
 * Screen-reader access to a row's swipe actions. The swipe container itself
 * isn't focusable (VoiceOver/TalkBack land on the row's own button), so the
 * row's button spreads these props to offer every swipe action — Block,
 * Delete, Archive, Mute, Mark as read — from the actions menu without
 * swiping. Derived from the same list passed to <InboxSwipeRow actions>.
 */
export function inboxSwipeAccessibilityProps(actions: InboxSwipeAction[]) {
  return {
    accessibilityActions: actions.map((a) => ({ name: a.key, label: a.accessibilityLabel ?? a.label })),
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
      const action = actions.find((a) => a.key === e.nativeEvent.actionName);
      if (action) void action.onPress();
    },
  };
}

/**
 * Inbox / requests row swipe actions — the shared Apple Mail / Instagram DMs
 * swipe row (components/ui/SwipeRow.tsx): leading actions on the left,
 * trailing on the right, full swipe runs the outermost one.
 */
export default function InboxSwipeRow({ children, actions, leadingActions = [], rowId, disabled = false }: InboxSwipeRowProps) {
  return (
    <SwipeRow
      rowId={rowId}
      disabled={disabled}
      testIDPrefix="inbox-swipe"
      leading={leadingActions.map((a, i, all) => toSwipeAction(a, all.length - 1 - i, all))}
      trailing={actions.map(toSwipeAction)}
    >
      {children}
    </SwipeRow>
  );
}
