/**
 * Buyer 1:1 chat thread. The screen itself lives in
 * components/chat/ConversationThread.tsx, shared with the seller side
 * (app/seller-conversation.tsx) so both sides of a DM look and behave the
 * same; this route renders it unchanged as the buyer variant.
 */
import React from 'react';

import { ConversationThread } from '@/components/chat/ConversationThread';

export default function BuyerConversationScreen() {
  return <ConversationThread variant="buyer" />;
import { goBackOr } from '@/lib/navigation/goBackOr';
import { View, Text, FlatList, TextInput, Alert, Platform, StyleSheet, Dimensions, ListRenderItemInfo, Modal, ScrollView, ActivityIndicator, Animated, Keyboard, Linking } from 'react-native';
import { KeyboardAvoidingView, KeyboardGestureArea } from '@/components/KeyboardProviderCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { TypingBubble } from '@/components/chat/TypingBubble';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale, StatusBadge, useUndoToast } from '@/components/BrandthreadUI';
import { dbStatusToOrderStatus, orderStatusBadgeLabel, orderStatusBadgeVariant, carrierTrackingUrl } from '@/lib/orderStatusAdapter';
import { CachedImage } from '@/components/CachedImage';
import { Chip } from '@/components/ui/Chip';
import { Snackbar } from '@/components/ui/Snackbar';
import { haptics } from '@/lib/haptics';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { getConversation, createOrGetConversation, getMessages, sendMessage, retryMessage, addReaction, deleteMessageForMe, markConversationRead, subscribeSocial, setConversationTheme, setConversationDisappearing, MY_USER_ID, MY_NAME, MY_INITIALS, MY_COLOR } from '@/services/socialService';
import { pickAvatarColor } from '@/lib/avatarColors';
import { useCallSession, useCallLog } from '@/lib/calls/CallSessionContext';
import { CallLogBubble } from '@/components/calls/CallLogBubble';
import { useApi } from '@/lib/api';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { VoiceRecordingBar } from '@/components/chat/VoiceRecordingBar';
import { KeyboardAccessoryBar, keyboardAccessoryID } from '@/components/ui/KeyboardAccessoryBar';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { VoiceMessageBubble, TRANSCRIPTION_STUB } from '@/components/chat/VoiceMessageBubble';
import { ALLOW_DEV_TOOLS } from '@/lib/buildFlags';
import { useAuth } from '@clerk/expo';
import { apiErrorMessage, confirmBlock, confirmUnblock, reportHref } from '@/lib/safety';
import { BlockedComposer, type DmMessagingState } from '@/components/safety/DmSafety';
import { acceptConversationRequest, scheduleDeleteConversationRequest, undoDeleteConversationRequest, blockConversationRequestUser } from '@/lib/requestActions';
import { DELETE_GRACE_MS } from '@/lib/pendingRequestDeletes';
import { confirmDestructiveActionSheet } from '@/lib/actionSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useCelebrateThreadCash } from '@/components/thread-cash/CelebrationHost';
import { ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import { formatCents } from '@/lib/money';
import { SheetRise } from '@/components/motion/SheetRise';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { ThreadCashAttachButton, ThreadCashMessageCard, ThreadCashBillMark } from '@/components/thread-cash/ChatAttachThreadCash';
import { ReactionGlyph, reactionAuthorName } from '@/components/chat/ReactionBar';
import { ReactionOverlay, type ReactionOverlayAnchor, type ReactionOverlayMenuItem } from '@/components/chat/ReactionOverlay';
import { applyOptimisticReaction, myReactionIn, groupReactionCounts } from '@/lib/reactionMutations';
import { SystemLine } from '@/components/chat/SystemLine';
import { SwipeToReplyBubble } from '@/components/chat/SwipeToReplyBubble';
import { ReplyBanner } from '@/components/chat/ReplyBanner';
import { ChatAttachmentCard } from '@/components/chat/ChatAttachmentCard';
import { getConversationTheme } from '@/lib/conversationThemes';
import { LinearGradient } from 'expo-linear-gradient';
import { isPreviewConversationId, getPreviewConversation, getPreviewMessages, setPreviewConversationDisappearing, appendPreviewMessage, reactToPreviewMessage, isPreviewInboxEnabled, posterUri, previewAutoReplyText, previewAutoReplyDelayMs } from '@/lib/previewInbox';
import { parseQuickReplies, cannedAgentReply, hasWelcomePlayed, markWelcomePlayed, type AgentQuickReply } from '@/lib/agentChat';
import { EMOJI_FONT_STACK } from '@/lib/appleEmoji';
import { formatDate as sharedFormatDate, formatTime as sharedFormatTime, sameSenderClose, groupCornerRadii, lastOwnMessageId, messagePreviewText } from '@/lib/chatGrouping';
import { radius } from '@/constants/radii';
import { menuItemsFromButtons, openPullDownMenu } from '@/lib/contextMenu';
}
