/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  BRANDTHREAD LEGAL DOCUMENTS — SINGLE SOURCE OF TRUTH
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  The TEXT of each document lives in content/legal/*.md (the drafts of
 *  record: terms, privacy, community-guidelines, seller-agreement,
 *  refund-policy). After editing one, run
 *  `pnpm --filter @workspace/mobile run legal:generate` to rebuild
 *  content/legal/generated.ts (a test fails if you forget). Lines marked
 *  [LAWYER REVIEW] in the .md files are notes for counsel; they are stripped
 *  and never shown in the app.
 *
 *  This file holds the version, contact details and per-document metadata. The
 *  in-app screens, the sign-up agreement and the "updated terms" prompt all
 *  read from here.
 *
 *  STATUS: FIRST DRAFTS PENDING LEGAL REVIEW. These are product-specific
 *  drafts, not legal advice. Every [BRACKETED] item must be completed and the
 *  full text approved by qualified counsel before launch.
 *
 *  When you make a material change:
 *   1. Update the text below.
 *   2. Update EFFECTIVE_DATE.
 *   3. Bump LEGAL_VERSION (YYYY-MM-DD, add .2, .3 for same-day revisions).
 *      Bumping the version asks every signed-in member to review and agree
 *      again, and records the new version on their account.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { LEGAL_MARKDOWN } from './legal/generated';
import { parseLegalMarkdown, type LegalBlock } from './legal/parse';

export const LEGAL_VERSION = '2026-09-23';
export const EFFECTIVE_DATE = 'September 23, 2026';
export const IS_DRAFT = true;

export const LEGAL_CONTACT = {
  operator: '[LEGAL ENTITY NAME]',
  address: '[REGISTERED POSTAL ADDRESS]',
  supportEmail: 'support@brandthread.app',
  safetyEmail: 'safety@brandthread.app',
  privacyEmail: 'privacy@brandthread.app',
  legalEmail: 'legal@brandthread.app',
} as const;

/** Facts the owner and counsel must supply or confirm before launch. */
export const LEGAL_OPEN_ITEMS = [
  'Legal entity name, registered address and the contact mailboxes listed above',
  'Governing law, venue and dispute process (including whether to use arbitration)',
  'Enforceable liability cap and consumer-law carve-outs for each launch region',
  'Final data-retention schedule and international transfer mechanism',
  'Whether Stripe processing fees are absorbed by Brandthread or passed to sellers',
  'Drop refund deadlines and any regional preorder/consumer rules (e.g. FTC Mail Order Rule)',
] as const;

export interface LegalSection {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  /** Ordered blocks with inline markdown (headings, numbered lists, bold, links). */
  blocks?: LegalBlock[];
}

export type LegalDocId = 'terms' | 'privacy' | 'guidelines' | 'seller-agreement' | 'refund-policy';

export interface LegalDocumentContent {
  id: LegalDocId;
  route: '/terms' | '/privacy' | '/community-guidelines' | '/seller-agreement' | '/refund-policy';
  shortTitle: string;
  title: string;
  eyebrow: string;
  summary: string;
  metaDescription: string;
  reviewNotice: string;
  sections: LegalSection[];
}

const DRAFT_NOTICE =
  'This is a Brandthread-specific first draft, not legal advice. It is pending review by qualified counsel. Bracketed items must be completed before launch.';

function sectionsOf(id: keyof typeof LEGAL_MARKDOWN): LegalSection[] {
  return parseLegalMarkdown(LEGAL_MARKDOWN[id]).sections.map((section) => ({
    title: section.title,
    paragraphs: section.paragraphs,
    bullets: section.bullets,
    blocks: section.blocks,
  }));
}

export const LEGAL_DOCUMENTS: Record<LegalDocId, LegalDocumentContent> = {
  guidelines: {
    id: 'guidelines',
    route: '/community-guidelines',
    shortTitle: 'Guidelines',
    title: 'Community Guidelines',
    eyebrow: 'Legal · Community',
    summary:
      'Brandthread is where independent brands and the people who love them meet. These rules keep it safe, honest and worth showing up for. They apply to everything you post, sell, say and send.',
    metaDescription:
      'The rules for posting, selling, commenting, live shopping and messaging on Brandthread, and how we enforce them.',
    reviewNotice: DRAFT_NOTICE,
    sections: sectionsOf('guidelines'),
  },
  terms: {
    id: 'terms',
    route: '/terms',
    shortTitle: 'Terms',
    title: 'Terms of Service',
    eyebrow: 'Legal · Platform',
    summary:
      'The agreement between you and Brandthread for buying, selling, posting, live shopping, messaging and working with manufacturers on Brandthread.',
    metaDescription:
      'Terms governing Brandthread accounts, the marketplace, the 5% platform fee, preorders and drops, seller subscriptions, manufacturers, content and conduct.',
    reviewNotice: DRAFT_NOTICE,
    sections: sectionsOf('terms'),
  },
  privacy: {
    id: 'privacy',
    route: '/privacy',
    shortTitle: 'Privacy',
    title: 'Privacy Policy',
    eyebrow: 'Legal · Privacy',
    summary:
      'What information Brandthread collects, how it’s used and shared across buying, selling, social, live, messaging, design and payment features, and the choices and rights you have.',
    metaDescription:
      'How Brandthread collects, uses, shares, retains and protects information, and how to access or delete your data.',
    reviewNotice: DRAFT_NOTICE,
    sections: sectionsOf('privacy'),
  },
  'seller-agreement': {
    id: 'seller-agreement',
    route: '/seller-agreement',
    shortTitle: 'Sellers',
    title: 'Seller Agreement',
    eyebrow: 'Legal · Selling',
    summary:
      'The terms for selling on Brandthread: fees, payouts and held drop funds, orders and returns, prohibited items, your content, and how accounts are closed.',
    metaDescription:
      'The Brandthread Seller Agreement: the 5% platform fee, Stripe payouts, preorder and drop funds, prohibited items, intellectual property and account termination.',
    reviewNotice: DRAFT_NOTICE,
    sections: sectionsOf('seller-agreement'),
  },
  'refund-policy': {
    id: 'refund-policy',
    route: '/refund-policy',
    shortTitle: 'Refunds',
    title: 'Refund Policy',
    eyebrow: 'Legal · Buying',
    summary:
      'How cancellations, returns and refunds work on Brandthread, including purchase protection, preorders and drops, and payment disputes.',
    metaDescription:
      'Brandthread’s refund policy: cancelling orders, requesting returns, automatic refunds for failed drops, and payment disputes.',
    reviewNotice: DRAFT_NOTICE,
    sections: sectionsOf('refund-policy'),
  },
};

/** Display order for the document switcher and the update prompt (the original three). */
export const LEGAL_DOCUMENT_ORDER: LegalDocId[] = ['terms', 'guidelines', 'privacy'];

/** Every legal document, in the order the About / Legal lists show them. */
export const LEGAL_ALL_DOCUMENT_ORDER: LegalDocId[] = [
  'terms', 'privacy', 'refund-policy', 'seller-agreement', 'guidelines',
];
