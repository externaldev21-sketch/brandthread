import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { FONT, FS } from '@/lib/theme';
import type { MessageAttachmentType } from '@/services/socialTypes';
import { ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';

const ATTACHMENT_META: Record<MessageAttachmentType, { icon: keyof typeof Feather.glyphMap; label: string }> = {
  image: { icon: 'image', label: 'Photo' },
  video: { icon: 'video', label: 'Video' },
  voice: { icon: 'mic', label: 'Voice message' },
  product: { icon: 'shopping-bag', label: 'Product' },
  post: { icon: 'file-text', label: 'Post' },
  order: { icon: 'package', label: 'Order' },
  profile: { icon: 'user', label: 'Profile' },
  thread_cash: { icon: 'dollar-sign', label: 'Thread Cash' },
  agent_card: { icon: 'square', label: 'Card' },
  quick_replies: { icon: 'message-circle', label: 'Quick replies' },
};

interface ConversationPreviewProps {
  text?: string;
  attachmentType?: MessageAttachmentType;
  isFromMe: boolean;
  color: string;
  bold: boolean;
}

/** Renders a conversation's last-message preview: plain text, or a small
 *  vector icon + label for non-text attachments (photo, voice, product…). */
export function ConversationPreview({ text, attachmentType, isFromMe, color, bold }: ConversationPreviewProps) {
  const prefix = isFromMe ? 'You: ' : '';
  const meta = attachmentType ? ATTACHMENT_META[attachmentType] : undefined;
  const fontFamily = bold ? FONT.bold : FONT.regular;

  if (meta) {
    return (
      <View style={styles.row}>
        {prefix ? <Text style={[styles.text, { color, fontFamily }]}>{prefix}</Text> : null}
        {attachmentType === 'thread_cash' ? (
          <ThreadCashBillIcon size={13} style={styles.icon} />
        ) : (
          <Feather name={meta.icon} size={13} color={color} style={styles.icon} />
        )}
        <Text style={[styles.text, { color, fontFamily }]} numberOfLines={1}>{meta.label}</Text>
      </View>
    );
  }

  return (
    <Text style={[styles.text, { color, fontFamily }]} numberOfLines={1}>
      {prefix}{text ?? ''}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { marginRight: 4 },
  text: { fontSize: FS.sm },
});
