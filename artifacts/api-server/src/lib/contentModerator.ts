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

// ─── Off-platform contact / payment steering (manufacturer chat) ─────────────
//
// Seller↔manufacturer messages are scanned for contact details (email, phone,
// messaging-app IDs, websites) and off-platform payment details or phrasing
// (IBAN/SWIFT/account numbers, PayPal/Wise/Zelle/…, "pay me directly", T/T).
// Before the pair's first paid order, identifier spans are masked; phrasing is
// flagged but left readable. See routes/manufacturers.ts.

export type OffPlatformKind =
  | 'email'
  | 'phone'
  | 'messaging_id'
  | 'link'
  | 'iban'
  | 'swift'
  | 'bank_account'
  | 'payment_handle'
  | 'payment_app'
  | 'off_platform_payment'
  | 'contact_request';

/** Kinds that describe moving payment off Brandthread (vs. sharing contact details). */
export const OFF_PLATFORM_PAYMENT_KINDS: ReadonlySet<OffPlatformKind> = new Set([
  'iban', 'swift', 'bank_account', 'payment_handle', 'payment_app', 'off_platform_payment',
]);

export const OFF_PLATFORM_MASK = '[hidden until first order]';

export interface OffPlatformMatch {
  kind: OffPlatformKind;
  /** Character range in the original text. Absent for phrasing-only flags. */
  start?: number;
  end?: number;
}

export interface OffPlatformDetection {
  kinds: OffPlatformKind[];
  matches: OffPlatformMatch[];
}

/**
 * Same-length normalization so match offsets map straight back onto the
 * original text: lowercase, full-width forms → ASCII, ideographic full stop →
 * ".", zero-width characters → spaces.
 */
function sameLengthNormalize(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    let mapped = ch;
    if (code >= 0xff01 && code <= 0xff5e) mapped = String.fromCharCode(code - 0xfee0);
    else if (code === 0x3002 || code === 0xff61) mapped = '.';
    else if (code === 0x3000) mapped = ' ';
    else if (/[​-‍⁠﻿]/.test(ch)) mapped = ' ';
    const lower = mapped.toLowerCase();
    // Keep offsets stable: only accept mappings that keep UTF-16 length.
    out += lower.length === ch.length ? lower : (mapped.length === ch.length ? mapped : ch);
  }
  return out;
}

const TLDS = 'com|net|org|cn|co|io|vn|in|pk|bd|tr|uk|de|it|pt|es|fr|hk|tw|kr|jp|me|biz|info|email|us|ca|au|id|th|ph|my|mx|br|ru|nl|pl|ae|sa|eg|ma|lk|kh|mm|so|store|shop|online|site|xyz';

// name@domain.tld, with optional spaces and (at)/[at]/{at} and (dot)/[dot] tokens.
const EMAIL_SYMBOLIC = new RegExp(
  String.raw`[a-z0-9][a-z0-9._%+\-]*\s*(?:@|\(\s*at\s*\)|\[\s*at\s*\]|\{\s*at\s*\}|<\s*at\s*>)\s*[a-z0-9\-]+(?:\s*(?:\.|\(\s*dot\s*\)|\[\s*dot\s*\]|\{\s*dot\s*\}|<\s*dot\s*>)\s*[a-z0-9\-]+)*\s*(?:\.|\(\s*dot\s*\)|\[\s*dot\s*\]|\{\s*dot\s*\}|<\s*dot\s*>)\s*[a-z]{2,10}\b`,
  'g',
);
// "john at gmail dot com" — spelled out, so require a known TLD to stay precise.
const EMAIL_SPELLED = new RegExp(
  String.raw`\b[a-z0-9][a-z0-9._%+\-]{1,}\s+at\s+[a-z0-9\-]+(?:\s+dot\s+[a-z0-9\-]+)*\s+dot\s+(?:${TLDS})\b`,
  'g',
);
// "my gmail is john.factory88"
const EMAIL_PROVIDER_HANDLE = /\b(?:gmail|g-mail|hotmail|outlook|yahoo|icloud|protonmail|proton\s*mail|qq\s*mail|163\s*mail|126\s*mail)\b\s*(?:id|address|account)?\s*(?:is|:|=|-|->)?\s*[a-z0-9][a-z0-9._\-]{3,}/g;

const MESSAGING_APPS = String.raw`we\s*chat|weixin|wei\s*xin|wx|vx|whats\s*app|whatsapp|wa\.me|telegram|t\.me|skype|viber|kakao\s*talk|kakao|zalo|line\s*id|imo|signal\s*(?:app|number|id)`;
// App name followed by an ID / handle / number.
const MESSAGING_ID = new RegExp(
  String.raw`\b(?:${MESSAGING_APPS})\b\s*(?:id|number|no\.?|#|account|handle|username)?\s*(?:is|:|=|-|->|@|\/)?\s*@?[a-z0-9+][a-z0-9_.\-+]{3,}`,
  'g',
);
// App mentioned as a place to talk ("add me on WhatsApp", "let's move to WeChat").
const MESSAGING_MENTION = new RegExp(
  String.raw`\b(?:add|message|text|ping|dm|contact|reach|find|call|chat\s+with|talk\s+(?:to|with))\s+(?:me|us)\s+(?:on|via|in|through|at)\s+(?:${MESSAGING_APPS})\b|\b(?:move|continue|talk|chat|switch)\s+(?:this\s+)?(?:to|on|over\s+to)\s+(?:${MESSAGING_APPS})\b|\b(?:my|our)\s+(?:${MESSAGING_APPS})\b`,
  'g',
);

// Links. File-sharing links (tech packs, artwork) stay readable.
const LINK = new RegExp(
  String.raw`\b(?:https?:\/\/|www\.)[^\s<>()]+|(?<![@\w.\-])[a-z0-9][a-z0-9\-]{1,62}(?:\.[a-z0-9\-]{2,62})*\.(?:${TLDS})(?:\/[^\s<>()]*)?(?![a-z0-9@])`,
  'g',
);
const ALLOWED_LINK_HOSTS = /(?:^|\.)(?:brandthread\.app|drive\.google\.com|docs\.google\.com|dropbox\.com|wetransfer\.com|we\.tl|figma\.com|canva\.com|onedrive\.live\.com|1drv\.ms|box\.com|icloud\.com)$/;

const IBAN = /\b[a-z]{2}\d{2}(?:\s?[a-z0-9]{4}){2,7}(?:\s?[a-z0-9]{1,4})?\b/g;
const SWIFT = /\b(?:swift|bic)(?:\s*(?:\/\s*bic|code|no\.?|number))?\s*(?:is|:|=|-|#)?\s*[a-z]{4}[a-z]{2}[a-z0-9]{2}(?:[a-z0-9]{3})?\b/g;
const BANK_ACCOUNT = /\b(?:iban|account\s*(?:number|no\.?|#)|acct\s*(?:number|no\.?|#)?|a\/c\s*(?:no\.?)?|routing\s*(?:number|no\.?|#)?|aba|sort\s*code|bsb|ifsc|clabe)\s*(?:is|:|=|-|#)?\s*[a-z0-9][a-z0-9\s\-]{5,40}[a-z0-9]/g;

const PAYMENT_HANDLE = /\b(?:paypal\.me|venmo\.com|cash\.app|wise\.com\/pay)\/[^\s]+|\b(?:venmo|cash\s*app|cashapp)\s*(?:is|:|=|-)?\s*[@$][a-z0-9_\-]{2,}|\$[a-z][a-z0-9_\-]{2,}\b/g;
const PAYMENT_APP = /\b(?:pay\s*pal|paypal|zelle|cash\s*app|cashapp|venmo|western\s+union|moneygram|alipay|wechat\s*pay|weixin\s*pay|payoneer|revolut|transferwise|skrill|remitly|world\s*remit)\b|\b(?:via|through|by|with|use|using|on|over)\s+wise\b|\bwise\s+(?:transfer|account|payment|invoice)\b/g;
const OFF_PLATFORM_PAYMENT = [
  /\bpay(?:ing|ment)?\s+(?:me|us|you|him|her|them)?\s*(?:directly|direct|outside|off\s*(?:the\s+)?(?:app|platform|brandthread|site))\b/g,
  /\b(?:direct|bank|wire|telegraphic)\s+(?:bank\s+)?(?:transfer|payment|deposit)\b/g,
  /\bwire\s+(?:the\s+)?(?:money|funds|payment|deposit|balance)\b/g,
  /\bt\s*\/\s*t\b/g,
  /\b(?:outside|off)\s+(?:of\s+)?(?:brandthread|the\s+app|the\s+platform|this\s+app|this\s+platform|the\s+site)\b/g,
  /\b(?:avoid|save|skip|split|dodge|cut)\s+(?:the\s+)?(?:brandthread\s+|platform\s+|app\s+|stripe\s+)?(?:fees?|commission|cut)\b/g,
  /\b(?:skip|bypass|go\s+around)\s+(?:brandthread|the\s+platform|the\s+app|this\s+app)\b/g,
  /\b(?:send|invoice)\s+(?:you|u)\s+(?:an?\s+|my\s+|our\s+)?(?:invoice|payment\s+link)\s+(?:directly|by\s+email|via\s+email|outside)\b/g,
  /\b(?:i'?ll|we'?ll|let\s+me|we\s+can)\s+invoice\s+(?:you|u)\s+(?:directly|by\s+email|via\s+email|outside)\b/g,
];
const CONTACT_REQUEST = [
  /\b(?:send|give|share|drop|dm)\s+(?:me|us)\s+(?:your|ur)\s+(?:e-?mail|email\s+address|phone|phone\s+number|number|cell|mobile|whats\s*app|we\s*chat|contact(?:\s+info|\s+details)?)\b/g,
  /\b(?:what'?s|what\s+is)\s+(?:your|ur)\s+(?:e-?mail|phone\s+number|number|whats\s*app|we\s*chat|contact)\b/g,
  /\b(?:e-?mail|call|text|phone|ring)\s+(?:me|us)\s+(?:at|on)\b/g,
  /\b(?:my|our)\s+(?:e-?mail|phone|phone\s+number|number|cell|mobile)\s+(?:is|:)/g,
];

// ── Phone numbers ──
const NUMBER_WORD = String.raw`zero|oh|one|two|three|four|five|six|seven|eight|nine`;
const NUMBER_WORDS: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};
// Runs of digits / number words separated by spaces, dots, dashes, parens or slashes.
const PHONE_CANDIDATE = new RegExp(
  String.raw`(?:\+|\b00)?\s*(?:\(\s*)?(?:\d|\b(?:${NUMBER_WORD})\b)(?:[\s().\-\/_]{0,3}(?:\d|\b(?:${NUMBER_WORD})\b)){6,}`,
  'g',
);
const PHONE_KEYWORD_BEFORE = /(?:phone|tel|telephone|call|text|sms|whats\s*app|whatsapp|wa|we\s*chat|wechat|viber|mobile|cell|number|contact|reach\s+me|hotline|landline|fax)\s*(?:is|:|=|-|#|at|on|no\.?)?\s*$/;
const NOT_PHONE_BEFORE = /(?:\$|usd|us\$|eur|€|£|¥|rmb|cny|price|cost|total|budget|moq|qtys?|quantit(?:y|ies)|lots?|batch(?:es)?|tiers?|pcs|pieces|units|order\s*(?:#|no\.?|number|id)?|po\s*(?:#|no\.?)?|invoice\s*(?:#|no\.?)?|tracking\s*(?:#|no\.?|number)?|awb|sku|style\s*(?:#|no\.?)?|item\s*(?:#|no\.?)?|ref\s*(?:#|no\.?)?|size[sd]?|sizes?:|#)\s*:?\s*$/;
const NOT_PHONE_AFTER = /^\s*(?:pcs|pieces|units|pc|sets|yards|yds|meters|metres|m\b|cm|mm|in\b|inch|inches|kg|kgs|g\b|gsm|lbs?|oz|usd|dollars|eur|rmb|cny|%|x\b|days|weeks|colors|colours|styles|skus)/;
const DATE_LIKE = /^\(?\s*(?:\d{4}[\s.\-\/]\d{1,2}[\s.\-\/]\d{1,2}|\d{1,2}[\s.\-\/]\d{1,2}[\s.\-\/]\d{2,4})\s*\)?$/;
const TIME_RANGE_LIKE = /^\d{1,2}[:.]\d{2}\s*-\s*\d{1,2}[:.]\d{2}$/;

function phoneDigits(candidate: string): { digits: string; groups: string[] } {
  const converted = candidate.replace(new RegExp(String.raw`\b(?:${NUMBER_WORD})\b`, 'g'), (word) => NUMBER_WORDS[word] ?? word);
  const groups = converted.split(/[^\d]+/).filter(Boolean);
  return { digits: groups.join(''), groups };
}

function isPhoneCandidate(norm: string, start: number, end: number): boolean {
  const candidate = norm.slice(start, end).trim();
  const { digits, groups } = phoneDigits(candidate);
  if (digits.length < 7 || digits.length > 15) return false;
  const before = norm.slice(Math.max(0, start - 24), start);
  const after = norm.slice(end, end + 12);
  const international = /^\s*(?:\+|00)/.test(norm.slice(start, end));
  // Order / PO / tracking / style numbers and prices win over a generic "number" keyword.
  if (NOT_PHONE_BEFORE.test(before) && !international) return false;
  const keyword = PHONE_KEYWORD_BEFORE.test(before);
  if (!keyword && NOT_PHONE_AFTER.test(after)) return false;
  if (/^[\d\s]*$/.test(candidate) === false && DATE_LIKE.test(candidate)) return false;
  if (DATE_LIKE.test(candidate) && !keyword && !international) return false;
  if (TIME_RANGE_LIKE.test(candidate)) return false;
  // Lists of sizes / quantities ("36 38 40 42 44", "100 200 300"): same-length,
  // strictly increasing groups that don't start with 0.
  if (!international && !keyword && groups.length >= 3) {
    const sameLength = groups.every((g) => g.length === groups[0].length && g.length <= 4);
    const increasing = groups.every((g, i) => i === 0 || Number(g) > Number(groups[i - 1]));
    if (sameLength && increasing && !groups[0].startsWith('0') && groups[0].length >= 2) return false;
  }
  if (international || keyword) return digits.length >= 7;
  return digits.length >= 9 || (digits.length >= 8 && groups.length >= 2 && groups.every((g) => g.length <= 4));
}

function collect(pattern: RegExp, text: string, kind: OffPlatformKind, out: OffPlatformMatch[], keepSpan = true,
  accept?: (start: number, end: number, value: string) => boolean) {
  pattern.lastIndex = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m[0].length === 0) { pattern.lastIndex += 1; continue; }
    let start = m.index;
    let end = m.index + m[0].length;
    // Trim surrounding whitespace / trailing punctuation from the span.
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /[\s.,;:!?)]/.test(text[end - 1])) end--;
    if (accept && !accept(start, end, text.slice(start, end))) continue;
    out.push(keepSpan ? { kind, start, end } : { kind });
  }
}

/** Find off-platform contact details and payment steering in a message. */
export function detectOffPlatformContact(raw: string | null | undefined): OffPlatformDetection {
  if (!raw || !raw.trim()) return { kinds: [], matches: [] };
  const norm = sameLengthNormalize(raw);
  const matches: OffPlatformMatch[] = [];

  collect(EMAIL_SYMBOLIC, norm, 'email', matches);
  collect(EMAIL_SPELLED, norm, 'email', matches);
  collect(EMAIL_PROVIDER_HANDLE, norm, 'email', matches);
  // Spaced-out letters: "j o h n @ g m a i l . c o m".
  {
    const indexMap: number[] = [];
    let compact = '';
    for (let i = 0; i < norm.length; i++) {
      if (!/\s/.test(norm[i])) { compact += norm[i]; indexMap.push(i); }
    }
    const compactEmail = /[a-z0-9][a-z0-9._%+\-]*@[a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.[a-z]{2,10}/g;
    for (let m = compactEmail.exec(compact); m; m = compactEmail.exec(compact)) {
      const start = indexMap[m.index];
      const end = indexMap[m.index + m[0].length - 1] + 1;
      // Only for genuinely spaced-out text; ordinary emails are found above.
      const tokens = norm.slice(start, end).split(/\s+/).filter(Boolean);
      const singles = tokens.filter((token) => token.length === 1).length;
      if (tokens.length >= 6 && singles / tokens.length >= 0.6) matches.push({ kind: 'email', start, end });
    }
  }
  collect(MESSAGING_ID, norm, 'messaging_id', matches, true, (_s, _e, value) => {
    // The handle must look like an ID: contain a digit, an underscore, or
    // follow an explicit "id"/":"/"@" marker.
    return /\d|_/.test(value) || /(?:\bid\b|:|@|=)/.test(value);
  });
  collect(MESSAGING_MENTION, norm, 'messaging_id', matches, false);
  collect(LINK, norm, 'link', matches, true, (_s, _e, value) => {
    if (value.includes('@')) return false;
    const host = value.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[\/?#]/)[0];
    if (ALLOWED_LINK_HOSTS.test(host)) return false;
    // Ignore things like "2.5cm", "v1.0" and file names ("techpack.pdf").
    if (/\.(?:pdf|png|jpe?g|ai|psd|zip|xlsx?|docx?|csv)$/.test(host)) return false;
    return /[a-z]/.test(host.split('.')[0] ?? '');
  });
  collect(IBAN, norm, 'iban', matches, true, (_s, _e, value) => {
    const compact = value.replace(/\s/g, '');
    return compact.length >= 15 && compact.length <= 34 && /\d{6,}/.test(compact.replace(/[a-z]/g, '')) && /^[a-z]{2}\d{2}/.test(compact);
  });
  collect(SWIFT, norm, 'swift', matches);
  collect(BANK_ACCOUNT, norm, 'bank_account', matches, true, (_s, _e, value) => /\d{4,}/.test(value.replace(/[\s\-]/g, '')));
  collect(PAYMENT_HANDLE, norm, 'payment_handle', matches, true, (start) => {
    // "$20" etc. are prices: the $handle form must start with a letter (enforced by the pattern).
    return start >= 0;
  });
  collect(PAYMENT_APP, norm, 'payment_app', matches, false);
  for (const pattern of OFF_PLATFORM_PAYMENT) collect(pattern, norm, 'off_platform_payment', matches, false);
  for (const pattern of CONTACT_REQUEST) collect(pattern, norm, 'contact_request', matches, false);

  PHONE_CANDIDATE.lastIndex = 0;
  for (let m = PHONE_CANDIDATE.exec(norm); m; m = PHONE_CANDIDATE.exec(norm)) {
    let start = m.index;
    let end = m.index + m[0].length;
    while (start < end && /[\s(]/.test(norm[start])) start++;
    while (end > start && /[\s.\-\/_(]/.test(norm[end - 1])) end--;
    if (norm[start - 1] && /[a-z0-9]/.test(norm[start - 1]) && !/\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)$/.test(norm.slice(0, start))) {
      // Part of a longer token (an SKU like "AB12345678"): not a phone.
      if (/[a-z]/.test(norm[start - 1])) continue;
    }
    if (norm[end] && /[a-z]/.test(norm[end]) && !/\s/.test(norm[end])) continue;
    if (isPhoneCandidate(norm, start, end)) matches.push({ kind: 'phone', start, end });
  }

  const kinds = [...new Set(matches.map((m) => m.kind))];
  return { kinds, matches };
}

/** Replace detected identifier spans with OFF_PLATFORM_MASK. Phrasing-only flags are left as written. */
export function maskOffPlatformContact(raw: string, detection = detectOffPlatformContact(raw)): string {
  const spans = detection.matches
    .filter((m): m is Required<OffPlatformMatch> => typeof m.start === 'number' && typeof m.end === 'number' && m.end > m.start)
    .sort((a, b) => a.start - b.start);
  if (spans.length === 0) return raw;
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ start: span.start, end: span.end });
  }
  let out = '';
  let cursor = 0;
  for (const span of merged) {
    out += raw.slice(cursor, span.start) + OFF_PLATFORM_MASK;
    cursor = span.end;
  }
  return out + raw.slice(cursor);
}
