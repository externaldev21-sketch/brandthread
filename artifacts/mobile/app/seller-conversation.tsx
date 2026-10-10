/**
 * Seller 1:1 chat thread. Dev's direction: identical to the buyer thread,
 * so this route renders the same shared screen
 * (components/chat/ConversationThread.tsx) as the seller variant — only the
 * seller's own data (buyer, orders, own store, seller preview threads and
 * request actions) is swapped in.
 */
import React from 'react';

import { ConversationThread } from '@/components/chat/ConversationThread';

export default function SellerConversationScreen() {
  return <ConversationThread variant="seller" />;
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { View, Text, FlatList, TextInput, Alert, Platform, StyleSheet, Dimensions, ActivityIndicator, ListRenderItemInfo, Modal, ScrollView, Linking } from 'react-native';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { useUser } from '@clerk/expo';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi, type SellerQuickReply } from '@/lib/api';
import { PressableScale, StatusBadge, useUndoToast } from '@/components/BrandthreadUI';
import { Glass } from '@/components/ui/Glass';
import { dbStatusToOrderStatus, orderStatusBadgeLabel, orderStatusBadgeVariant, carrierTrackingUrl } from '@/lib/orderStatusAdapter';
import { CachedImage } from '@/components/CachedImage';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { haptics } from '@/lib/haptics';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { acceptSellerConversationRequest, scheduleDeleteSellerConversationRequest, undoDeleteSellerConversationRequest, blockSellerConversationRequestUser } from '@/lib/sellerRequestActions';
import { DELETE_GRACE_MS } from '@/lib/pendingRequestDeletes';
import { confirmDestructiveActionSheet } from '@/lib/actionSheet';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { VoiceRecordingBar } from '@/components/chat/VoiceRecordingBar';
import { KeyboardAccessoryBar, keyboardAccessoryID } from '@/components/ui/KeyboardAccessoryBar';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { VoiceMessageBubble, TRANSCRIPTION_STUB } from '@/components/chat/VoiceMessageBubble';
import { ALLOW_DEV_TOOLS } from '@/lib/buildFlags';
import { formatCents } from '@/lib/money';
import { notifyConversationReadFailure } from '@/lib/conversationReadEvents';
import { confirmUnblock, apiErrorMessage, apiErrorCode, BLOCK_EXPLAINER } from '@/lib/safety';
import { BlockedComposer, openConversationOptions, openMessageOptions, REMOVED_MESSAGE_TEXT, type DmMessagingState } from '@/components/safety/DmSafety';
import { SheetRise } from '@/components/motion/SheetRise';
import { useCallSession, useCallLog } from '@/lib/calls/CallSessionContext';
import { CallLogBubble } from '@/components/calls/CallLogBubble';
import { isSellerDevPreview } from '@/lib/devPreview';
import { isSellerPreviewConversationId, getSellerPreviewConversation, getSellerPreviewMessages, getSellerPreviewBuyerOrders, isPreviewInboxEnabled, posterUri, previewAutoReplyText, previewAutoReplyDelayMs } from '@/lib/previewInbox';
import { SystemLine } from '@/components/chat/SystemLine';
import { getConversationTheme } from '@/lib/conversationThemes';
import { LinearGradient } from 'expo-linear-gradient';
import { formatDate as sharedFormatDate, formatTime, groupFlags, groupCornerRadii, lastOwnMessageId, messagePreviewText } from '@/lib/chatGrouping';
import { SwipeToReplyBubble } from '@/components/chat/SwipeToReplyBubble';
import { ReplyBanner } from '@/components/chat/ReplyBanner';
import { TypingBubble } from '@/components/chat/TypingBubble';
import { ChatAttachmentCard } from '@/components/chat/ChatAttachmentCard';
import { ReactionOverlay, type ReactionOverlayAnchor, type ReactionOverlayMenuItem } from '@/components/chat/ReactionOverlay';
import { ReactionGlyph } from '@/components/chat/ReactionBar';
import { applyOptimisticReaction, myReactionIn, groupReactionCounts } from '@/lib/reactionMutations';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { ThreadCashAttachButton, ThreadCashMessageCard, ThreadCashBillMark } from '@/components/thread-cash/ChatAttachThreadCash';
import { useCelebrateThreadCash } from '@/components/thread-cash/CelebrationHost';
import { Snackbar } from '@/components/ui/Snackbar';
import { radius } from '@/constants/radii';
}
