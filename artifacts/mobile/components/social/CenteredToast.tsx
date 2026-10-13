/**
 * "Removed" / "Unfollowed" confirmations for the Activity tab and the
 * Followers/Following lists. Same API as before; now drawn as the app's one
 * toast — a dark pill at the top (components/ui/TopToast.tsx). The caller
 * still owns timing (it clears `message`).
 */
import React from 'react';
import { TopToast } from '@/components/ui/TopToast';

export function CenteredToast({ message }: { message: string | null }) {
  if (!message) return null;
  return <TopToast message={message} />;
}

export default CenteredToast;
