/**
 * Chat themes (chat details > Theme) — 8 original themes for a fashion
 * brand, each a background gradient + sent/received bubble color pair.
 * Mirrors Instagram DM's "Changing theme" flow structurally (grid → preview
 * with sample bubbles → Cancel/Apply → applied + system line) but every
 * asset here is original, not Instagram's actual gradients/stickers.
 *
 * `null`/undefined themeId (DEFAULT_THEME) is Brandthread's existing
 * monochrome look and is intentionally NOT in this catalog — applying it
 * back is just clearing the conversation's themeId, so un-themed chats never
 * change.
 */

export interface ConversationTheme {
  id: string;
  name: string;
  /** 2-stop gradient for the chat background. */
  gradient: readonly [string, string];
  /** Sent (own) bubble background + text color. */
  sentBubble: string;
  sentText: string;
  /** Received (other participant's) bubble background + text color. */
  receivedBubble: string;
  receivedText: string;
  /** Small solid swatch for the grid tile (usually the gradient's darker stop). */
  swatch: string;
}

export const CONVERSATION_THEMES: readonly ConversationTheme[] = [
  {
    id: 'runway', name: 'Runway',
    gradient: ['#1A1A1D', '#3A3A40'],
    sentBubble: '#FAFAFA', sentText: '#0A0A0B',
    receivedBubble: '#2E2E33', receivedText: '#FAFAFA',
    swatch: '#3A3A40',
  },
  {
    id: 'denim', name: 'Denim',
    gradient: ['#1B2A3D', '#33526F'],
    sentBubble: '#DCE8F5', sentText: '#0F2338',
    receivedBubble: '#22384F', receivedText: '#EAF2FA',
    swatch: '#33526F',
  },
  {
    id: 'satin', name: 'Satin',
    gradient: ['#2B1220', '#6B1F3B'],
    sentBubble: '#F7D8E4', sentText: '#3A0E1D',
    receivedBubble: '#4A1B2E', receivedText: '#F9E4EC',
    swatch: '#6B1F3B',
  },
  {
    id: 'noir', name: 'Noir',
    gradient: ['#000000', '#1C1C1F'],
    sentBubble: '#1F1F22', sentText: '#FFFFFF',
    receivedBubble: '#0A0A0B', receivedText: '#E4E4E7',
    swatch: '#1C1C1F',
  },
  {
    id: 'chrome', name: 'Chrome',
    gradient: ['#8E8E93', '#D1D1D6'],
    sentBubble: '#FFFFFF', sentText: '#1C1C1E',
    receivedBubble: '#AEAEB2', receivedText: '#1C1C1E',
    swatch: '#AEAEB2',
  },
  {
    id: 'linen', name: 'Linen',
    gradient: ['#EDE6DA', '#F8F4EC'],
    sentBubble: '#2B2620', sentText: '#F8F4EC',
    receivedBubble: '#FFFFFF', receivedText: '#2B2620',
    swatch: '#EDE6DA',
  },
  {
    id: 'street', name: 'Street',
    gradient: ['#101010', '#E8FF3C'],
    sentBubble: '#E8FF3C', sentText: '#101010',
    receivedBubble: '#232323', receivedText: '#F5F5F0',
    swatch: '#E8FF3C',
  },
  {
    id: 'archive', name: 'Archive',
    gradient: ['#3A2E24', '#8A7355'],
    sentBubble: '#EFE6D6', sentText: '#3A2E24',
    receivedBubble: '#5C4A38', receivedText: '#EFE6D6',
    swatch: '#8A7355',
  },
] as const;

export function getConversationTheme(themeId: string | null | undefined): ConversationTheme | null {
  if (!themeId) return null;
  return CONVERSATION_THEMES.find((t) => t.id === themeId) ?? null;
}
