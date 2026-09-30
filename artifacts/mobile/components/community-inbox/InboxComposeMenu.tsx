import { showActionSheet } from '@/components/ui/ActionSheet';

type Router = { push: (href: never) => void };

/**
 * The inbox header '+' menu (own inbox only). `onNewMessage` is omitted where
 * the inbox has no compose flow of its own (seller inbox).
 */
export function openInboxComposeMenu(router: Router, onNewMessage?: () => void): void {
  showActionSheet('Messages', undefined, [
    ...(onNewMessage ? [{ text: 'New message', onPress: onNewMessage }] : []),
    { text: 'Create group', onPress: () => router.push('/community-create' as never) },
    { text: 'Join a group', onPress: () => router.push('/community' as never) },
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}
