/**
 * Brandthread content policy engine.
 *
 * One classifier backs two surface policies:
 *
 *   DMs ("dm")         Casual profanity and cussing are allowed. Slurs, threats,
 *                      doxxing, scams, and unsolicited sexual solicitation are
 *                      rejected before they are stored.
 *
 *   Public ("public")  Comments, captions and live chat. Slurs and threats are
 *                      rejected outright. Profanity, directed abuse, spam and
 *                      sexual solicitation are accepted but HELD: the author can
 *                      still see it, nobody else can, and it lands in the
 *                      moderation queue until a moderator approves or removes it.
 *
 * Matching runs against several normalized variants of the text so common
 * evasion (leetspeak, stretched letters, spaced-out letters, zero-width
 * characters, accents) does not slip through, while whole-word boundaries keep
 * innocent words ("class", "cocktail", "Scunthorpe", "flame retardant") clean.
 */

export type ModerationCategory =
  | 'spam_scam'
  | 'explicit_sexual'
  | 'harassment'
  | 'hate_speech'
  | 'profanity'
  | 'abuse';

export type ContentSurface = 'dm' | 'public';

export type ContentDecision =
  | { action: 'allow' }
  | { action: 'hold'; category: ModerationCategory; reason: string }
  | { action: 'reject'; category: ModerationCategory; reason: string };

/** Legacy DM result shape used by the conversations route. */
export interface ModerationResult {
  blocked:   boolean;
  category?: ModerationCategory;
  reason?:   string;
}

// ─── Normalization ────────────────────────────────────────────────────────────

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't',
  '@': 'a', '$': 's', '!': 'i', '|': 'i', '€': 'e',
};

/** Lowercase, NFKC, strip zero-width chars, accents and markdown obfuscation. */
export function normalizeForMatching(text: string): string {
  return text
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')              // combining accents
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')  // zero-width
    .toLowerCase()
    .replace(/[*_~`\\]/g, ' ')                 // markdown-style obfuscation
    .replace(/\s+/g, ' ')
    .trim();
}

/** Undo leetspeak and collapse stretched letters ("fuuuuck" → "fuck"). */
function deobfuscate(text: string): string {
  return text
    .replace(/[0134573@$!|€]/g, (ch, index: number, whole: string) => {
      // Only translate symbols that sit inside a word so prices and counts
      // ("$20", "100%") are not rewritten into letters.
      const prev = whole[index - 1] ?? ' ';
      const next = whole[index + 1] ?? ' ';
      const touchesLetter = /[a-z]/.test(prev) || /[a-z]/.test(next);
      return touchesLetter ? (LEET[ch] ?? ch) : ch;
    })
    .replace(/([a-z])\1{2,}/g, '$1');
}

/** Join runs of single letters separated by spaces/dots ("f u c k" → "fuck"). */
function despace(text: string): string {
  return text.replace(/\b(?:[a-z][\s.\-_]+){2,}[a-z]\b/g, (run) => run.replace(/[\s.\-_]+/g, ''));
}

function variants(raw: string): string[] {
  const base = normalizeForMatching(raw);
  const clean = deobfuscate(base);
  const joined = despace(clean);
  return [...new Set([base, clean, joined])];
}

function anyMatch(texts: string[], patterns: RegExp[]): boolean {
  return texts.some((t) => patterns.some((p) => p.test(t)));
}

// ─── Pattern lists ────────────────────────────────────────────────────────────

// Spam / scam — phishing, crypto solicitation, investment fraud, link spam.
const SPAM_SCAM: RegExp[] = [
  /\b(send|transfer|deposit)\b.{0,30}\b(bitcoin|btc|ethereum|eth|usdt|crypto|coin)\b/i,
  /\bwallet\s*address\b/i,
  /\b(btc|eth|usdt|crypto)\s*wallet\b/i,
  /\b(guarantee[d]?|guarant[eé]ed)\b.{0,20}\b(profit|return|earning|income|gain)\b/i,
  /\bdouble\s+your\s+(money|investment|bitcoin|crypto)\b/i,
  /\b(earn|make)\s+\$[\d,]+\s+(per|a)\s+(day|week|hour)\b/i,
  /\bmake\s+money\s+from\s+home\b/i,
  /\bpassive\s+income\b.{0,40}\b(click|join|sign\s*up|dm\s*me)\b/i,
  /\b(100|1000)%\s*(profit|returns?|guaranteed)\b/i,
  /\bpyramid\b|\bponzi\b/i,
  /\bverify\s+your\s+account\b.{0,30}\b(link|click|visit|go\s+to)\b/i,
  /\byou\s+(have\s+)?(won|been\s+selected|are\s+the\s+winner)\b/i,
  /\bclaim\s+your\s+(prize|reward|gift|bonus)\b/i,
  /\bact\s+now\b.{0,30}\b(link|click|limited)\b/i,
  /\byour\s+account\s+(has\s+been|will\s+be)\s+(suspended|closed|locked|terminated)\b/i,
  /\bconfirm\s+your\s+(account|identity|info|details)\b.{0,40}(link|http|www)\b/i,
  /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|rb\.gy|short\.link)\b.{0,80}\b(click|visit|check|follow|go\s+to|join)\b/i,
  /\bi\s+can\s+(help\s+you\s+)?(earn|make|get)\s+(a\s+)?(lot|lots|tons|plenty)?\s+of\s+money\b/i,
  /\b(wire|send)\s+transfer\b.{0,20}\b(\$|money|funds|payment)\b/i,
  // Off-platform payment steering — a common marketplace scam.
  /\b(pay|payment|send)\b.{0,25}\b(zelle|cash\s*app|venmo|wire|gift\s*cards?)\b.{0,25}\b(instead|outside|off\s+(the\s+)?app|directly)\b/i,
];

// Explicit sexual — solicitation and explicit acts; not general crude language.
const EXPLICIT_SEXUAL: RegExp[] = [
  /\bsend\s+(me\s+)?(your\s+)?(nudes?|naked\s+pics?|nude\s+photos?|xxx)\b/i,
  /\b(nude|nudes|naked)\s+(pic[ks]?|photo[s]?|video[s]?|content)\b/i,
  /\b(sex|sexting|fuck(ing)?)\s+for\s+(money|cash|\$|pay|payment)\b/i,
  /\b(pay|paid|paying)\s+(for\s+)?(sex|nudes?|hookup)\b/i,
  /\b(looking\s+for|want\s+to)\s+(hook\s*up|have\s+sex|get\s+laid)\b/i,
  /\bonly\s*fans?\s+(page|account|content|link)\b.{0,30}\b(click|visit|join|buy|sub)\b/i,
  /\b(explicit|adult|18\+)\s+(content|material|video[s]?|pic[ks]?)\b.{0,30}\b(send|share|click|buy)\b/i,
];

// Threats of violence, self-harm encouragement, doxxing. Filtered everywhere.
const THREATS: RegExp[] = [
  /\bi('?l?l?|'?m\s+going\s+to|\s+will|\s+am\s+going\s+to|\s+gonna)\s+(kill|murder|hurt|attack|shoot|stab|rape|beat(\s+you)?(\s+up)?|destroy|end)\s+(you|u|ur|your)\b/i,
  /\b(gonna|going\s+to|will|i'?ll)\s+(kill|murder|shoot|stab|rape)\s+(you|u|ur|your)\b/i,
  /\byou('?re|r|re)?\s+(dead|going\s+to\s+die|gonna\s+die)\b/i,
  /\bkill\s+your\s*self\b|\bkys\b/i,
  /\bgo\s+(kill\s+your\s*self|die)\b/i,
  /\bhope\s+you\s+(die|get\s+(raped|killed|shot))\b/i,
  /\bi\s+know\s+where\s+you\s+live\b/i,
  /\bi\s+(have|got)\s+your\s+(address|location|info|dox)\b/i,
  /\bwill\s+(find|track|locate)\s+you\b/i,
  /\bi'?m\s+coming\s+for\s+you\b/i,
  /\b(burn|shoot\s+up|bomb)\s+(your|ur)\s+(house|home|store|shop|school)\b/i,
  /\b(gonna|going\s+to|will)\s+(dox|expose)\s+you\b/i,
  /\bpost\s+your\s+(address|info|number|location)\b/i,
];

// Hate speech — unambiguous slurs and calls for group violence. Whole words
// only; context-dependent words are excluded to avoid false positives.
const HATE_SPEECH: RegExp[] = [
  /\bn[i1!|]gg(?:[e3]r|[a@]h?|uh)s?\b/i,
  /\bnigg?(?:er|ers)\b/i,
  /\bch[i1!]nks?\b/i,
  /\bsp[i1!]cs?\b/i,
  /\bk[i1!]kes?\b/i,
  /\bw[e3]tb[a@]cks?\b/i,
  /\bg[o0][o0]ks?\b/i,
  /\bbeaners?\b/i,
  /\b(rag|towel)\s*heads?\b/i,
  /\bpakis?\b/i,
  /\bf[a@4]gg?[o0]ts?\b/i,
  /\bf[a@4]gs?\b/i,
  /\btrann(y|ies)\b/i,
  /\bretard(s|ed)?\b/i,
  /\bd[iy]kes?\b.{0,5}\b(you|them|those)\b/i,
  /\b(all|every|those)\b.{0,20}\b(should|must|need\s+to|deserve\s+to)\b.{0,20}\b(die|be\s+killed|be\s+eliminated|be\s+exterminated|be\s+gassed)\b/i,
  /\bgas\s+the\s+\w+\b/i,
];

// Profanity — fine in DMs, held for review on public surfaces. Mild words
// ("damn", "hell", "crap") are intentionally not listed.
const PROFANITY: RegExp[] = [
  /\b(mother)?fuck(s|ed|er|ers|ing|in|face|wit|boy)?\b/i,
  /\bf+u+c+k+\b/i,
  /\b(bull)?shit(s|ty|ter|head|show)?\b/i,
  /\bbitch(es|y|ing|ass)?\b/i,
  /\bcunts?\b/i,
  /\bass\s*holes?\b/i,
  /\b(dumb|jack|smart)\s*ass(es)?\b/i,
  /\bdick(s|head|heads)?\b/i,
  /\bcocks?(sucker)?\b/i,
  /\bpuss(y|ies)\b/i,
  /\bwhores?\b/i,
  /\bsluts?\b/i,
  /\bbastards?\b/i,
  /\btwats?\b/i,
  /\bwank(er|ers)?\b/i,
  /\bpricks?\b/i,
  /\bdouche(bag|bags)?\b/i,
  /\bstfu\b|\bgtfo\b/i,
];

// Directed abuse and insults aimed at a person.
const ABUSE: RegExp[] = [
  /\b(you('?re|\s+are)?|ur|u\s+r|youre)\s+(such\s+)?(an?\s+)?(fucking\s+)?(idiot|moron|stupid|ugly|worthless|pathetic|trash|garbage|loser|disgusting|fat\s+pig|pig|clown|joke|waste\s+of\s+space)\b/i,
  /\bnobody\s+(likes|cares\s+about|wants)\s+you\b/i,
  /\byou\s+should\s+be\s+ashamed\b.{0,30}\b(ugly|fat|disgusting)\b/i,
  /\bkill\s+it\s+with\s+fire\b.{0,20}\b(you|her|him)\b/i,
];

// ─── Classification ───────────────────────────────────────────────────────────

export interface Classification {
  categories: ModerationCategory[];
}

export function classifyText(rawText: string): Classification {
  const texts = variants(rawText);
  const categories: ModerationCategory[] = [];
  if (anyMatch(texts, THREATS)) categories.push('harassment');
  if (anyMatch(texts, HATE_SPEECH)) categories.push('hate_speech');
  // Spam patterns rely on literal `$` amounts, so they only see the base text.
  if (anyMatch([texts[0]], SPAM_SCAM)) categories.push('spam_scam');
  if (anyMatch(texts, EXPLICIT_SEXUAL)) categories.push('explicit_sexual');
  if (anyMatch(texts, ABUSE)) categories.push('abuse');
  if (anyMatch(texts, PROFANITY)) categories.push('profanity');
  return { categories };
}

const SEVERE: ModerationCategory[] = ['harassment', 'hate_speech'];

const REASONS: Record<ModerationCategory, string> = {
  harassment:      'Threats, doxxing and encouraging self-harm are not allowed on Brandthread.',
  hate_speech:     'Slurs and hateful content are not allowed on Brandthread.',
  spam_scam:       'This looks like spam or a scam.',
  explicit_sexual: 'Unsolicited sexual content is not allowed.',
  abuse:           'This reads as a personal attack.',
  profanity:       'This contains strong language.',
};

/** Human-readable explanation for a category, safe to show to the author. */
export function moderationReason(category: ModerationCategory): string {
  return REASONS[category];
}

/**
 * Decide what happens to a piece of text on a given surface.
 * The first matching category in severity order wins.
 */
export function evaluateContent(rawText: string, surface: ContentSurface): ContentDecision {
  if (!rawText || !rawText.trim()) return { action: 'allow' };
  const { categories } = classifyText(rawText);
  if (categories.length === 0) return { action: 'allow' };

  const severe = categories.find((c) => SEVERE.includes(c));
  if (severe) return { action: 'reject', category: severe, reason: REASONS[severe] };

  if (surface === 'dm') {
    // Cussing and blunt language are fine in private messages.
    const blocked = categories.find((c) => c === 'spam_scam' || c === 'explicit_sexual');
    return blocked
      ? { action: 'reject', category: blocked, reason: REASONS[blocked] }
      : { action: 'allow' };
  }

  const held = categories[0];
  return { action: 'hold', category: held, reason: REASONS[held] };
}

/** DM moderation (legacy result shape). Casual profanity passes freely. */
export function moderateMessage(rawText: string): ModerationResult {
  const decision = evaluateContent(rawText, 'dm');
  if (decision.action === 'reject') {
    return { blocked: true, category: decision.category, reason: decision.reason };
  }
  return { blocked: false };
}

// ─── Muted words ──────────────────────────────────────────────────────────────

export const MAX_MUTED_WORDS = 200;
export const MAX_MUTED_WORD_LENGTH = 60;

/** Canonical stored form of a muted phrase, or null when it is unusable. */
export function normalizeMutedPhrase(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Leading # / @ are kept so people can mute a hashtag or a handle.
  const phrase = normalizeForMatching(raw);
  if (phrase.length < 1 || phrase.length > MAX_MUTED_WORD_LENGTH) return null;
  if (!/[\p{L}\p{N}]/u.test(phrase)) return null;
  return phrase;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when `text` contains any muted phrase as a whole word/phrase.
 * "art" mutes "art drop" but not "party"; "#fyp" mutes the hashtag.
 */
export function matchesMutedWords(text: string | null | undefined, phrases: readonly string[]): boolean {
  if (!text || phrases.length === 0) return false;
  const haystack = normalizeForMatching(text);
  return phrases.some((phrase) => {
    if (!phrase) return false;
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(phrase)}(?=$|[^\\p{L}\\p{N}_])`, 'u');
    return pattern.test(haystack);
  });
}
