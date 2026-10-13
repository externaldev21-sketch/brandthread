/**
 * Onboarding taste quiz — client-side types and the style identity name.
 * Pure (no React Native), unit-tested in lib/tasteQuiz.test.ts.
 *
 * Style keys are the ranking vocabulary (see api-server lib/tasteQuiz.ts).
 */

export interface QuizProduct {
  id: string;
  name: string;
  brand: string;
  imageUrl: string;
  styleKeys: string[];
}

export interface QuizSwipe {
  productId: string;
  liked: boolean;
}

/** How a style reads as the first word ("Archive …") and as the last ("… Minimal"). */
const WORDS: Record<string, { lead: string; noun: string }> = {
  minimalist:    { lead: 'Clean',    noun: 'Minimal' },
  vintage:       { lead: 'Archive',  noun: 'Vintage' },
  streetwear:    { lead: 'Street',   noun: 'Streetwear' },
  y2k:           { lead: 'Y2K',      noun: 'Y2K' },
  athleisure:    { lead: 'Off-Duty', noun: 'Sport' },
  luxury:        { lead: 'Quiet',    noun: 'Luxury' },
  cottagecore:   { lead: 'Pastoral', noun: 'Romantic' },
  dark_academia: { lead: 'Academia', noun: 'Tailoring' },
  coastal:       { lead: 'Coastal',  noun: 'Linen' },
  preppy:        { lead: 'Prep',     noun: 'Classics' },
  gorpcore:      { lead: 'Trail',    noun: 'Utility' },
  boho:          { lead: 'Free',     noun: 'Boho' },
  grunge:        { lead: 'Worn',     noun: 'Grunge' },
  techwear:      { lead: 'Tech',     noun: 'Utility' },
  basics:        { lead: 'Everyday', noun: 'Essentials' },
};

export interface StyleIdentity {
  /** e.g. "Archive Minimal" */
  title: string;
  /** Ranked style keys behind the title (strongest first). */
  keys: string[];
}

/**
 * Names the buyer's style from the products they swiped right on. The top
 * style is the noun, the runner-up the leading word: liked mostly minimal
 * pieces plus some vintage → "Archive Minimal". Ties break by first liked.
 * Returns null when nothing liked carries a known style.
 */
export function styleIdentity(liked: Array<Pick<QuizProduct, 'styleKeys'>>): StyleIdentity | null {
  const score = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let i = 0;
  for (const p of liked) {
    p.styleKeys.forEach((k, rank) => {
      if (!WORDS[k]) return;
      // A product's primary style counts more than its secondary ones.
      score.set(k, (score.get(k) ?? 0) + (rank === 0 ? 2 : 1));
      if (!firstSeen.has(k)) firstSeen.set(k, i++);
    });
  }
  const keys = [...score.keys()].sort((a, b) => (score.get(b)! - score.get(a)!) || (firstSeen.get(a)! - firstSeen.get(b)!));
  if (keys.length === 0) return null;
  const top = WORDS[keys[0]];
  const second = keys[1] ? WORDS[keys[1]] : null;
  if (!second || second.lead === top.noun || second.noun === top.noun) return { title: top.noun, keys };
  return { title: `${second.lead} ${top.noun}`, keys };
}

export const QUIZ_MIN_PRODUCTS = 12;
