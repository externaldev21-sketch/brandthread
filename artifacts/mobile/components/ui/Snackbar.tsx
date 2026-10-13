/**
 * Brandthread Design System — Snackbar / Toast
 *
 * Same props as before; now drawn as the app's one toast: a dark pill at the
 * top (components/ui/TopToast.tsx) with an icon or thumbnail, a few words,
 * an optional action ("Undo", "View bag"), auto-hide after 2s (4s with an
 * action) and swipe up to dismiss.
 */
import React from 'react';
import { TopToast } from './TopToast';

export interface SnackbarProps {
  visible: boolean;
  message: string;
  thumbnailUri?: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  /** @deprecated Toasts sit at the top now; kept so existing callers compile. */
  bottomOffset?: number;
  /** Anchor to the top instead, this far from the top edge (pass at least the
   *  safe-area/header inset). Used for the PDP "Reminder set" toast (Zalando). */
  topOffset?: number;
}

export function Snackbar({ visible, message, thumbnailUri, actionLabel, onAction, onDismiss, topOffset }: SnackbarProps) {
  if (!visible) return null;
  return (
    <TopToast
      topOffset={topOffset}
      message={message}
      thumbnailUri={thumbnailUri}
      actionLabel={actionLabel}
      onAction={onAction}
      onDismiss={onDismiss}
    />
  );
}
