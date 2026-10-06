/**
 * Pure link helpers for real 1:1 DM calls (see lib/calls/dmCalls.ts) — kept
 * free of React Native imports so lib/notificationNavigation.ts can use them.
 */
import type { CallMode } from './types';

export type DmCallRoute = 'simulated' | 'agora' | 'hidden';

export function resolveDmCallRoute(input: {
  demo: boolean;
  preview: boolean;
  platform: string;
  configured: boolean;
}): DmCallRoute {
  if (input.demo) return 'simulated';
  if (input.preview || input.platform === 'web') return 'hidden';
  return input.configured ? 'agora' : 'hidden';
}

/** Deep link into the real Agora call screen for a DM. `answer` = the callee joining from the ring notification. */
export function dmCallScreenHref(input: {
  conversationId: string;
  mode: CallMode;
  participantName: string;
  participantInitials?: string;
  participantColor?: string;
  myInitials?: string;
  answer?: boolean;
}): string {
  const query = new URLSearchParams({
    conversationId: input.conversationId,
    mode: input.mode,
    participantName: input.participantName,
    dmCall: '1',
  });
  if (input.participantInitials) query.set('participantInitials', input.participantInitials);
  if (input.participantColor) query.set('participantColor', input.participantColor);
  if (input.myInitials) query.set('myInitials', input.myInitials);
  if (input.answer) query.set('answer', '1');
  return `/call-screen?${query.toString()}`;
}

/** Mode encoded in the ring notification's type (`dm_call_voice` / `dm_call_video`). */
export function dmCallModeFromType(type: unknown): CallMode {
  return type === 'dm_call_video' ? 'video' : 'voice';
}
