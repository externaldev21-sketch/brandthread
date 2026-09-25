/**
 * Universal/deep-link redirect target for shared drop links.
 *
 * Route: /drops/[dropId]  (maps to https://brandthread.app/drops/{dropId},
 * the canonical share URL built in lib/shareDrop.ts).
 *
 * Drops don't have their own screen at this path — the existing buyer drop
 * detail screen already renders from `?dropId=`, so this route just forwards
 * the path param into a `router.replace` and renders nothing.
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

export default function DropLinkRedirect() {
  const router = useRouter();
  const { dropId } = useLocalSearchParams<{ dropId: string }>();

  useEffect(() => {
    if (!dropId) return;
    router.replace((`/buyer-drop-detail?dropId=${encodeURIComponent(dropId)}`) as never);
  }, [dropId, router]);

  return null;
}
