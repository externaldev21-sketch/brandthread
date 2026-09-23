/**
 * Shared client-side trust & safety helpers: the report reason catalog, target
 * labels, report-screen routing, API error presentation, and block flows.
 *
 * Every surface that lets someone report or block content goes through these
 * so the wording, reasons and behavior are identical across the app.
 */
import { Alert } from 'react-native';
import type { Feather } from '@expo/vector-icons';
import { ApiError } from './networkNotice';
import type { ReportReasonId, ReportTargetType } from './safetyTypes';

type IconName = keyof typeof Feather.glyphMap;

export interface ReportReasonOption {
  id: ReportReasonId;
  label: string;
  description: string;
  icon: IconName;
}

/** The fixed report reasons, in the order people see them. */
export const REPORT_REASONS: readonly ReportReasonOption[] = [
  { id: 'spam', label: 'Spam', description: 'Repetitive, misleading or unwanted promotion', icon: 'repeat' },
  { id: 'harassment', label: 'Harassment or bullying', description: 'Insults, threats or targeting someone', icon: 'user-x' },
  { id: 'nudity', label: 'Nudity or sexual content', description: 'Explicit images, solicitation or sexualized content', icon: 'eye-off' },
  { id: 'hate', label: 'Hate speech', description: 'Slurs or attacks on protected groups', icon: 'slash' },
  { id: 'violence', label: 'Violence or dangerous acts', description: 'Threats, self-harm, weapons or dangerous goods', icon: 'alert-octagon' },
  { id: 'ip_counterfeit', label: 'Counterfeit or IP violation', description: 'Fakes, stolen designs or trademark misuse', icon: 'copy' },
  { id: 'scam', label: 'Scam or fraud', description: 'Fake listings, off-app payments or phishing', icon: 'alert-triangle' },
  { id: 'other', label: 'Something else', description: 'Tell us what’s wrong', icon: 'more-horizontal' },
] as const;

export const TARGET_LABELS: Record<ReportTargetType, string> = {
  post: 'post',
  video: 'video',
  live: 'live stream',
  live_comment: 'live chat message',
  comment: 'comment',
  story: 'story',
  product: 'product',
  profile: 'account',
  message: 'message',
};

export const TARGET_ICONS: Record<ReportTargetType, IconName> = {
  post: 'image',
  video: 'film',
  live: 'radio',
  live_comment: 'message-square',
  comment: 'message-square',
  story: 'circle',
  product: 'shopping-bag',
  profile: 'user',
  message: 'message-circle',
};

/** Accept legacy and alias target names used by older routes. */
export function normalizeReportTarget(raw: string | null | undefined): ReportTargetType {
  switch (raw) {
    case 'seller':
    case 'user':
      return 'profile';
    case 'dm':
      return 'message';
    case 'post': case 'video': case 'live': case 'live_comment': case 'comment':
    case 'story': case 'product': case 'profile': case 'message':
      return raw;
    default:
      return 'post';
  }
}

export interface ReportTarget {
  targetType: ReportTargetType | 'seller';
  targetId: string;
  /** What the person sees in the report header, e.g. "@maya's comment". */
  label?: string;
  /** Owner of the content — enables "Also block" after reporting. */
  ownerId?: string;
  ownerName?: string;
}

/** Route to the full report flow (presented as a modal). */
export function reportHref(target: ReportTarget): string {
  const params = new URLSearchParams({
    targetType: target.targetType,
    targetId: target.targetId,
  });
  if (target.label) params.set('targetLabel', target.label);
  if (target.ownerId) params.set('targetUserId', target.ownerId);
  if (target.ownerName) params.set('targetUserName', target.ownerName);
  return `/buyer-report?${params.toString()}`;
}

/** Human message from an API error, without the "API 4xx:" prefix. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const message = error.message.replace(/^API \d{3}:\s*/, '').trim();
    if (error.status >= 500 || !message) return fallback;
    return message;
  }
  return fallback;
}

export function apiErrorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

export function apiErrorDetails<T = Record<string, unknown>>(error: unknown): T | undefined {
  return error instanceof ApiError ? error.details as T | undefined : undefined;
}

export interface BlockSubject {
  userId: string;
  name: string;
}

export const BLOCK_EXPLAINER =
  'They won’t be able to find your profile, see your posts, comments or stories, or message you. ' +
  'You won’t see theirs either. They aren’t notified.';

/**
 * Ask for confirmation, then block. Resolves true only when the block was
 * saved on the server.
 */
export function confirmBlock(
  subject: BlockSubject,
  block: (userId: string) => Promise<unknown>,
): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      `Block ${subject.name}?`,
      BLOCK_EXPLAINER,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await block(subject.userId);
              resolve(true);
            } catch (error) {
              Alert.alert('Couldn’t block', apiErrorMessage(error, 'Check your connection and try again.'));
              resolve(false);
            }
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function confirmUnblock(
  subject: BlockSubject,
  unblock: (userId: string) => Promise<unknown>,
): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      `Unblock ${subject.name}?`,
      'They’ll be able to see your profile and content and message you again. You can block them again at any time.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Unblock',
          onPress: async () => {
            try {
              await unblock(subject.userId);
              resolve(true);
            } catch (error) {
              Alert.alert('Couldn’t unblock', apiErrorMessage(error, 'Check your connection and try again.'));
              resolve(false);
            }
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** "2m", "3h", "4d", then a short date. */
export function shortRelativeTime(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
