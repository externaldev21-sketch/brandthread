import React from 'react';
import { Feather } from '@expo/vector-icons';

import SwipeRow, { type SwipeRowAction, type SwipeTone } from '@/components/ui/SwipeRow';

export interface InboxSwipeAction {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
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
