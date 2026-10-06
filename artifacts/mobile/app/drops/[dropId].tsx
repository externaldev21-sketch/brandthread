/**
 * Universal/deep-link redirect target for shared drop links.
 *
 * Route: /drops/[dropId]  (maps to https://brandthread.app/drops/{dropId},
 * the canonical share URL built in lib/shareDrop.ts).
 *
 * Drops don't have their own screen at this path — the existing buyer drop
 * detail screen already renders from `?dropId=`, so this route just forwards
 * the path param into a `router.replace` and renders nothing (or a
 * not-found state when the id is missing).
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { UnavailableScreen, isMissingParam } from '@/components/ui/UnavailableScreen';

export default function DropLinkRedirect() {
  const router = useRouter();
  const { dropId } = useLocalSearchParams<{ dropId: string }>();

  useEffect(() => {
    if (isMissingParam(dropId)) return;
    router.replace((`/buyer-drop-detail?dropId=${encodeURIComponent(dropId)}`) as never);
  }, [dropId, router]);

  // Nothing to forward to — don't leave a blank screen.
  if (isMissingParam(dropId)) {
    return (
      <UnavailableScreen
        title="Drop"
        heading="Drop not found"
        message="This drop link is invalid or the drop was removed."
        icon="calendar"
        fallback="/buyer-drops"
      />
    );
  }
  return null;
}
