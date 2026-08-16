/**
 * Content moderation for Brandthread DMs.
 *
 * Philosophy: free expression including casual profanity/cussing is allowed.
 * This module targets genuinely harmful content only:
 *   - Spam / scam patterns (phishing links, crypto solicitation, get-rich schemes)
 *   - Explicit sexual content or solicitation
 *   - Harassment (credible threats, doxxing threats)
 *   - Hate speech (targeted slurs / calls for violence against a group)
 *
 * NOT flagged: profanity, crude language, insults that don't constitute threats.
 */

export type ModerationCategory =
  | 'spam_scam'
  | 'explicit_sexual'
  | 'harassment'
  | 'hate_speech';

export interface ModerationResult {
  blocked:   boolean;
  category?: ModerationCategory;
  reason?:   string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function norm(text: string): string {
  // Lowercase, collapse whitespace, strip zero-width chars
  return text
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')   // zero-width
    .replace(/[*_~`|\\]/g, ' ')              // markdown-style obfuscation
    .replace(/\s+/g, ' ')
    .trim();
}

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}

// ─── Pattern lists ────────────────────────────────────────────────────────────

// Spam / scam — phishing, crypto solicitation, investment fraud, link spam
const SPAM_SCAM: RegExp[] = [
  // Crypto solicitation
  /\b(send|transfer|deposit)\b.{0,30}\b(bitcoin|btc|ethereum|eth|usdt|crypto|coin)\b/i,
  /\bwallet\s*address\b/i,
  /\b(btc|eth|usdt|crypto)\s*wallet\b/i,

  // Investment / get-rich fraud
  /\b(guarantee[d]?|guarant[eé]ed)\b.{0,20}\b(profit|return|earning|income|gain)\b/i,
  /\bdouble\s+your\s+(money|investment|bitcoin|crypto)\b/i,
  /\b(earn|make)\s+\$[\d,]+\s+(per|a)\s+(day|week|hour)\b/i,
  /\bmake\s+money\s+from\s+home\b/i,
  /\bpassive\s+income\b.{0,40}\b(click|join|sign\s*up|dm\s*me)\b/i,
  /\b(100|1000)%\s*(profit|returns?|guaranteed)\b/i,
  /\bpyramid\b|\bponzi\b/i,

  // Phishing / prize
  /\bverify\s+your\s+account\b.{0,30}\b(link|click|visit|go\s+to)\b/i,
  /\byou\s+(have\s+)?(won|been\s+selected|are\s+the\s+winner)\b/i,
  /\bclaim\s+your\s+(prize|reward|gift|bonus)\b/i,
  /\bact\s+now\b.{0,30}\b(link|click|limited)\b/i,
  /\byour\s+account\s+(has\s+been|will\s+be)\s+(suspended|closed|locked|terminated)\b/i,
  /\bconfirm\s+your\s+(account|identity|info|details)\b.{0,40}(link|http|www)\b/i,

  // Suspicious short-link + action combo
  /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|rb\.gy|short\.link)\b.{0,80}\b(click|visit|check|follow|go\s+to|join)\b/i,

  // Unsolicited "I can help you make money" DM openers
  /\bi\s+can\s+(help\s+you\s+)?(earn|make|get)\s+(a\s+)?(lot|lots|tons|plenty)?\s+of\s+money\b/i,

  // Wire transfer scam
  /\b(wire|send)\s+transfer\b.{0,20}\b(\$|money|funds|payment)\b/i,
];

// Explicit sexual — solicitation, explicit acts; NOT general crude language
const EXPLICIT_SEXUAL: RegExp[] = [
  /\bsend\s+(me\s+)?(your\s+)?(nudes?|naked\s+pics?|nude\s+photos?|xxx)\b/i,
  /\b(nude|nudes|naked)\s+(pic[ks]?|photo[s]?|video[s]?|content)\b/i,
  /\b(sex|sexting|fuck(ing)?)\s+for\s+(money|cash|\$|pay|payment)\b/i,
  /\b(pay|paid|paying)\s+(for\s+)?(sex|nudes?|content|hookup)\b/i,
  /\b(looking\s+for|want\s+to)\s+(hook\s*up|have\s+sex|get\s+laid)\b/i,
  /\bonly\s*fans?\s+(page|account|content|link)\b.{0,30}\b(click|visit|join|buy|sub)\b/i,
  /\b(explicit|adult|18\+)\s+(content|material|video[s]?|pic[ks]?)\b.{0,30}\b(send|share|click|buy)\b/i,
];

// Harassment — credible threats, doxxing
const HARASSMENT: RegExp[] = [
  // Violence / death threats
  /\bi('?l?l?|'?m\s+going\s+to|will|gonna|am\s+going\s+to)\s+(kill|murder|hurt|attack|beat(\s+you)?\s+(up)?|destroy|end)\s+(you|u|your)\b/i,
  /\byou('?re|r|re)?\s+(dead|going\s+to\s+die|gonna\s+die)\b/i,
  /\bkill\s+your\s*self\b|\bkys\b/i,
  /\bgo\s+kill\s+your\s*self\b/i,
  /\bi\s+know\s+where\s+you\s+live\b/i,
  /\bi\s+(have|got)\s+your\s+(address|location|info|dox)\b/i,
  /\bwill\s+(find|track|locate)\s+you\b/i,
  /\bi'm\s+coming\s+for\s+you\b/i,

  // Doxxing threat
  /\b(gonna|going\s+to|will)\s+(dox|expose)\s+you\b/i,
  /\bpost\s+your\s+(address|info|number|location)\b/i,
];

// Hate speech — targeted slurs and calls for group violence.
// Note: these are matched as whole words to reduce false positives.
// This list focuses on unambiguous slurs; context-dependent words are excluded.
const HATE_SPEECH: RegExp[] = [
  // Racial / ethnic slurs (most unambiguous; not exhaustive but covers common cases)
  /\bn[i1!|]gg[ae3@]r\b/i,
  /\bc[h!]ink\b/i,
  /\bsp[i!1]c\b/i,
  /\bk[i!1]ke\b/i,
  /\bw[e3]tb[a@]ck\b/i,
  /\bg[o0]ok\b/i,
  /\bcr[a@]ck[e3]r\b.{0,10}(white|cracker)/i,  // "cracker" only in specific contexts

  // Anti-LGBTQ+ slurs
  /\bf[a@4]gg[o0]t\b/i,
  /\bd[iy]ke\b.{0,5}(you|them|those)\b/i,      // targeted use

  // Calls for group violence
  /\b(all|every|those)\b.{0,20}\b(should|must|need\s+to|deserve\s+to)\b.{0,20}\b(die|be\s+killed|be\s+eliminated|be\s+exterminated)\b/i,
];

// ─── Public API ───────────────────────────────────────────────────────────────

export function moderateMessage(rawText: string): ModerationResult {
  const t = norm(rawText);

  if (anyMatch(t, HARASSMENT)) {
    return { blocked: true, category: 'harassment', reason: 'Message contains threats or doxxing.' };
  }
  if (anyMatch(t, SPAM_SCAM)) {
    return { blocked: true, category: 'spam_scam', reason: 'Message appears to be spam or a scam.' };
  }
  if (anyMatch(t, EXPLICIT_SEXUAL)) {
    return { blocked: true, category: 'explicit_sexual', reason: 'Message contains unsolicited explicit sexual content.' };
  }
  if (anyMatch(t, HATE_SPEECH)) {
    return { blocked: true, category: 'hate_speech', reason: 'Message contains hate speech.' };
  }

  return { blocked: false };
}
