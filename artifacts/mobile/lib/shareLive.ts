/**
 * Canonical live-room URL helper — mirrors lib/shareDrop.ts's convention.
 *
 * The only live route is app/live.tsx, which reads `?streamId=` / `?hostId=`
 * (there is no app/live/[id] segment), so a shared live link must use the
 * query form: https://brandthread.app/live?streamId={streamId}[&hostId={hostId}]
 * Legacy `/live/{id}` links are redirected to this form by server/serve.js.
 */
import { BRANDTHREAD_ORIGIN } from '@/lib/shareProfile';

export function buildCanonicalLiveUrl(
  streamId: string | null | undefined,
  hostId?: string | null,
): string {
  const params: string[] = [];
  const stream = typeof streamId === 'string' ? streamId.trim() : '';
  const host = typeof hostId === 'string' ? hostId.trim() : '';
  if (stream) params.push(`streamId=${encodeURIComponent(stream)}`);
  if (host) params.push(`hostId=${encodeURIComponent(host)}`);
  return `${BRANDTHREAD_ORIGIN}/live${params.length ? `?${params.join('&')}` : ''}`;
}
