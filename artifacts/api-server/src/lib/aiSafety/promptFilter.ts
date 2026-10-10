/**
 * Prompt filter for AI tools.
 *
 *   1. checkPromptLocal  - deterministic, offline rules (denylist file).
 *   2. checkPrompt       - local rules first, then OpenAI's moderation endpoint
 *                          when a key is configured. Never throws: a missing
 *                          key, network error or timeout degrades to the local
 *                          verdict.
 *
 * Two rule sets:
 *   "media" - image/logo/design generation. Everything is checked, including
 *             celebrity likeness and other companies' brands/characters.
 *   "chat"  - assistants and text tools. Only safety rules (sexual, violent,
 *             hateful, minor-safety); people legitimately ask a chatbot about
 *             Nike or Taylor Swift.
 */
import { normalizeForMatching } from "../contentModerator";
import {
  AMBIGUOUS_BRAND_DENYLIST,
  BRAND_DENYLIST,
  CHARACTER_DENYLIST,
  GENERIC_TRADEMARK_PHRASES,
  HATE_TERMS,
  LIKENESS_PHRASES,
  MINOR_ABUSE_TERMS,
  MINOR_TERMS,
  PUBLIC_FIGURE_DENYLIST,
  SEXUALIZING_TERMS,
  SEXUAL_TERMS,
  TRADEMARK_CONTEXT_WORDS,
  VIOLENCE_TERMS,
} from "./denylist";
import { logger } from "../logger";

export type PromptCategory =
  | "minor_safety"
  | "sexual"
  | "violence"
  | "hate"
  | "public_figure"
  | "trademark"
  | "character";

export type PromptMode = "media" | "chat";

export type PromptVerdict =
  | { allowed: true }
  | { allowed: false; category: PromptCategory; source: "local" | "openai"; matched?: string };

/** Copy shown to the user, per category. Calm, no accusation, no term echo. */
export const PROMPT_BLOCK_MESSAGES: Record<PromptCategory, string> = {
  minor_safety: "This request can't be completed. Brandthread doesn't create content that sexualizes minors.",
  sexual: "This request can't be completed. Brandthread doesn't create sexual or nude content.",
  violence: "This request can't be completed. Brandthread doesn't create graphic violence or self-harm content.",
  hate: "This request can't be completed. Brandthread doesn't create hateful content or symbols.",
  public_figure: "This request can't be completed. Brandthread doesn't create images of real people or their likeness. Describe an original model instead.",
  trademark: "This request can't be completed. Brandthread can't reproduce other companies' names, logos or trademarks. Describe your own original design instead.",
  character: "This request can't be completed. Brandthread can't reproduce copyrighted characters. Describe your own original artwork instead.",
};

// ─── Normalization ────────────────────────────────────────────────────────────

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

/** Apostrophes vanish ("Levi's" -> "levis"), everything else non-alphanumeric becomes a space. */
function squash(text: string): string {
  return normalizeForMatching(text)
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Text variants to test: plain, leetspeak-decoded (letters only touched inside words), letters-joined. */
export function promptVariants(text: string): string[] {
  const base = normalizeForMatching(text).replace(/['’`]/g, "");
  const decoded = base.replace(/[0134578@$!]/g, (ch, i: number, whole: string) => {
    const prev = whole[i - 1] ?? " ";
    const next = whole[i + 1] ?? " ";
    return /[a-z]/.test(prev) || /[a-z]/.test(next) ? (LEET[ch] ?? ch) : ch;
  });
  const stretched = decoded.replace(/([a-z])\1{2,}/g, "$1");
  const joined = base.replace(/\b(?:[a-z][\s.\-_]+){2,}[a-z]\b/g, (run) => run.replace(/[\s.\-_]+/g, ""));
  const out = new Set([squash(base), squash(decoded), squash(stretched), squash(joined)]);
  out.delete("");
  return [...out];
}

// ─── Matchers (built once) ────────────────────────────────────────────────────

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word alternation over squashed phrases. */
function phraseRegex(phrases: readonly string[]): RegExp {
  const alts = [...new Set(phrases.map(squash).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map((p) => escapeRe(p).replace(/ /g, "\\s+"));
  return new RegExp(`(?:^|\\s)(${alts.join("|")})(?=\\s|$)`);
}

const RE = {
  minorAbuse: phraseRegex(MINOR_ABUSE_TERMS),
  minor: phraseRegex(MINOR_TERMS),
  sexualizing: phraseRegex(SEXUALIZING_TERMS),
  sexual: phraseRegex(SEXUAL_TERMS),
  violence: phraseRegex(VIOLENCE_TERMS),
  hate: phraseRegex(HATE_TERMS),
  figure: phraseRegex(PUBLIC_FIGURE_DENYLIST),
  likeness: phraseRegex(LIKENESS_PHRASES),
  brand: phraseRegex(BRAND_DENYLIST),
  genericTm: phraseRegex(GENERIC_TRADEMARK_PHRASES),
  character: phraseRegex(CHARACTER_DENYLIST),
  ambiguous: phraseRegex(AMBIGUOUS_BRAND_DENYLIST),
  tmContext: phraseRegex(TRADEMARK_CONTEXT_WORDS),
};

const MINOR_AGE_RE = /(?:^|\s)(\d{1,2}) ?(?:yo|y o|yr old|years? old|year olds?)(?=\s|$)/g;

function mentionsMinorAge(text: string): boolean {
  for (const m of text.matchAll(MINOR_AGE_RE)) {
    const age = Number(m[1]);
    if (age >= 1 && age < 18) return true;
  }
  return false;
}

/** True when an ambiguous brand word sits within 3 words of a trademark-context word. */
function ambiguousBrandInContext(text: string): string | null {
  const words = text.split(" ");
  for (let i = 0; i < words.length; i += 1) {
    // Try 1- and 2-word brand windows.
    for (const len of [2, 1]) {
      const cand = words.slice(i, i + len).join(" ");
      if (cand && RE.ambiguous.test(` ${cand} `) && squash(cand) === cand) {
        const from = Math.max(0, i - 3);
        const to = Math.min(words.length, i + len + 3);
        const around = ` ${[...words.slice(from, i), ...words.slice(i + len, to)].join(" ")} `;
        if (RE.tmContext.test(around)) return cand;
      }
    }
  }
  return null;
}

// ─── Local check ──────────────────────────────────────────────────────────────

export function checkPromptLocal(text: string, mode: PromptMode = "media"): PromptVerdict {
  if (!text || !text.trim()) return { allowed: true };
  for (const v of promptVariants(text)) {
    // Safety rules, both modes. Minor safety first so it wins the category.
    let m = RE.minorAbuse.exec(v);
    if (m) return { allowed: false, category: "minor_safety", source: "local", matched: m[1] };
    if (RE.minor.test(v) || mentionsMinorAge(v)) {
      m = RE.sexualizing.exec(v) ?? RE.sexual.exec(v);
      if (m) return { allowed: false, category: "minor_safety", source: "local", matched: m[1] };
    }
    m = RE.sexual.exec(v);
    if (m) return { allowed: false, category: "sexual", source: "local", matched: m[1] };
    m = RE.violence.exec(v);
    if (m) return { allowed: false, category: "violence", source: "local", matched: m[1] };
    m = RE.hate.exec(v);
    if (m) return { allowed: false, category: "hate", source: "local", matched: m[1] };

    if (mode !== "media") continue;

    m = RE.figure.exec(v) ?? RE.likeness.exec(v);
    if (m) return { allowed: false, category: "public_figure", source: "local", matched: m[1] };
    m = RE.brand.exec(v) ?? RE.genericTm.exec(v);
    if (m) return { allowed: false, category: "trademark", source: "local", matched: m[1] };
    const amb = ambiguousBrandInContext(v);
    if (amb) return { allowed: false, category: "trademark", source: "local", matched: amb };
    m = RE.character.exec(v);
    if (m) return { allowed: false, category: "character", source: "local", matched: m[1] };
  }
  return { allowed: true };
}

// ─── OpenAI text moderation (optional) ────────────────────────────────────────

export type TextModerationProvider = (text: string) => Promise<PromptVerdict | null>;

const OPENAI_BLOCKED: Record<string, PromptCategory> = {
  "sexual/minors": "minor_safety",
  sexual: "sexual",
  "violence/graphic": "violence",
  "self-harm/intent": "violence",
  "self-harm/instructions": "violence",
  "hate/threatening": "hate",
  "harassment/threatening": "hate",
};

function openAiKey(): string | null {
  return process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || null;
}

function openAiBase(): string {
  return (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
}

/** Returns null when unavailable (no key, network error, bad response). */
export const openAiTextModeration: TextModerationProvider = async (text) => {
  const key = openAiKey();
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${openAiBase()}/moderations`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "omni-moderation-latest", input: text.slice(0, 4000) }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { results?: Array<{ categories?: Record<string, boolean> }> };
    const flags = json.results?.[0]?.categories;
    if (!flags) return null;
    for (const [openAiCategory, category] of Object.entries(OPENAI_BLOCKED)) {
      if (flags[openAiCategory]) return { allowed: false, category, source: "openai", matched: openAiCategory };
    }
    return { allowed: true };
  } catch (err) {
    logger.warn({ err }, "AI prompt moderation unavailable; using local rules only");
    return null;
  } finally {
    clearTimeout(timer);
  }
};

let textProvider: TextModerationProvider = openAiTextModeration;

/** Test seam. Pass nothing to restore the default. */
export function setTextModerationProvider(next?: TextModerationProvider): void {
  textProvider = next ?? openAiTextModeration;
}

/** Local rules, then OpenAI when configured. Never throws. */
export async function checkPrompt(text: string, mode: PromptMode = "media"): Promise<PromptVerdict> {
  try {
    const local = checkPromptLocal(text, mode);
    if (!local.allowed) return local;
    if (!text.trim()) return local;
    const remote = await textProvider(text);
    return remote ?? local;
  } catch (err) {
    logger.warn({ err }, "AI prompt check failed; allowing on local verdict");
    return { allowed: true };
  }
}
