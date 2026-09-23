/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  BRANDTHREAD LEGAL DOCUMENTS — SINGLE SOURCE OF TRUTH
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Edit the Terms of Service, Privacy Policy and Community Guidelines here.
 *  The in-app screens (/terms, /privacy, /community-guidelines), the sign-up
 *  agreement and the "updated terms" prompt all read from this file.
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
}

export type LegalDocId = 'terms' | 'privacy' | 'guidelines';

export interface LegalDocumentContent {
  id: LegalDocId;
  route: '/terms' | '/privacy' | '/community-guidelines';
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

// ═════════════════════════════════════════════════════════════════════════════
// COMMUNITY GUIDELINES
// ═════════════════════════════════════════════════════════════════════════════

const GUIDELINES: LegalDocumentContent = {
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
  sections: [
    {
      title: 'Zero tolerance for abuse and objectionable content',
      paragraphs: [
        'Brandthread has no tolerance for objectionable content or abusive members. Content that breaks these Guidelines is removed, and people who post it can lose access to Brandthread permanently. These Guidelines are part of our Terms of Service, which you agree to when you create an account.',
        'They cover posts, videos, slideshows, captions, comments, stories, live streams and live chat, product listings, profiles, reviews, direct messages and anything you upload or generate with Brandthread tools.',
      ],
    },
    {
      title: 'Respect people',
      bullets: [
        'No harassment or bullying: targeted insults, degrading comments about someone’s body or identity, pile-ons, or repeatedly contacting someone who doesn’t want to hear from you.',
        'No hate speech: slurs, dehumanizing language, or attacks based on race, ethnicity, national origin, religion, caste, sexual orientation, sex, gender identity, disability or serious illness. Slurs are blocked everywhere on Brandthread, including private messages.',
        'No threats or incitement: threats of violence, wishing harm on someone, encouraging self-harm, or calling for violence against a person or group.',
        'No doxxing: never share someone’s home address, phone number, private documents or other personal information without permission, or threaten to.',
        'Casual swearing between people who are fine with it is allowed in direct messages. Public comments and captions with strong language are held for review before anyone else can see them.',
      ],
    },
    {
      title: 'Keep it safe',
      bullets: [
        'No sexual content involving minors, ever. We report child sexual exploitation to the relevant authorities.',
        'No nudity or sexually explicit content, and no sexual solicitation. Fashion, swimwear and lingerie are welcome when presented as fashion.',
        'No graphic violence, gore, or content that promotes self-harm or eating disorders. If someone is in danger, contact local emergency services right away.',
        'No dangerous or illegal goods: weapons, drugs, recalled or unsafe products, or anything illegal where it is sold or shipped.',
        'Protect young people: don’t target anyone under 18 with sexual, dangerous or exploitative content, and don’t use Brandthread if you’re under 13.',
      ],
    },
    {
      title: 'Sell honestly',
      bullets: [
        'Only sell what you have the right to sell. Counterfeits, knock-offs presented as the real thing, stolen designs and unauthorized use of trademarks, logos, artwork or music are not allowed.',
        'Describe products accurately: real photos or clearly labeled mockups, true materials, sizing, condition, origin and shipping times.',
        'Honor preorders and drops. Give realistic ship dates, keep buyers updated, and ship or refund. Buyer money for drops is held until you add tracking for each order, and refunded if the drop is cancelled.',
        'Keep payments on Brandthread. Asking buyers to pay by Zelle, Cash App, wire, crypto, gift cards or any off-platform method is a scam signal and is removed.',
        'No fake reviews, fake engagement, bought followers or misleading giveaways.',
        'Manufacturers and freelancers must represent their capabilities, pricing, timelines and samples truthfully and deliver what they agree to.',
      ],
    },
    {
      title: 'No spam, scams or manipulation',
      bullets: [
        'No repetitive, unsolicited or automated posts, comments or messages.',
        'No phishing, fake prize notices, “verify your account” links, investment or crypto schemes, or pyramid schemes.',
        'No impersonating another person, brand or Brandthread staff.',
        'Don’t evade blocks, suspensions or bans with new accounts.',
      ],
    },
    {
      title: 'Live shopping, comments and messages',
      bullets: [
        'Live streams must follow every rule here in real time. Live chat is filtered instantly: messages with slurs, threats, strong language or scams aren’t posted.',
        'Comments with slurs or threats are refused. Comments with strong language, personal attacks, spam or sexual solicitation are hidden until a moderator reviews them — only you can see them in the meantime.',
        'Direct messages are private, but they are not a loophole. Slurs, threats, scams and unsolicited sexual content are blocked in DMs too, and reported messages are reviewed.',
      ],
    },
    {
      title: 'Your safety tools',
      bullets: [
        'Report anything — a post, video, live stream, comment, story, product, profile or message — from its ⋯ menu. Reports are anonymous.',
        'Block anyone from their profile, a comment, a live chat or a conversation. You won’t see each other’s content or be able to message each other, and they aren’t notified.',
        'Mute words and phrases in Settings → Muted words to hide comments and posts that contain them.',
        'Manage everything in Settings → Blocked accounts and Settings → Muted words.',
      ],
    },
    {
      title: 'How we enforce these Guidelines',
      paragraphs: [
        'We use automated filters and human review. Our safety team reviews reports and filter holds, and aims to act on every report within 24 hours. Serious threats are escalated immediately.',
      ],
      bullets: [
        'Held content: flagged captions and comments stay hidden from others until approved or removed.',
        'Removal: content that breaks the rules is taken down. For listings, this can include delisting products.',
        'Suspension: accounts that break the rules can be suspended. Suspended accounts are signed out, can’t post, comment, sell or message, and their public content is hidden.',
        'Permanent ban: severe or repeated violations — including threats, hate, child safety violations, counterfeits and fraud — lead to permanent removal.',
        'Payments: for commerce violations we may pause payouts, refund buyers from held funds, and cooperate with Stripe and law enforcement.',
      ],
    },
    {
      title: 'Appeals and contact',
      paragraphs: [
        `If you think we made a mistake, reply to the notice you received or email ${LEGAL_CONTACT.safetyEmail} with your username and what you’d like us to review. We look at every appeal.`,
        `Rights holders can report intellectual-property infringement in the app (Report listing → Counterfeit or IP violation, or Report intellectual property infringement on the listing) or at ${LEGAL_CONTACT.legalEmail}.`,
        'Law enforcement requests: [LAW-ENFORCEMENT REQUEST PROCESS AND CONTACT].',
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════════════
// TERMS OF SERVICE
// ═════════════════════════════════════════════════════════════════════════════

const TERMS: LegalDocumentContent = {
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
  sections: [
    {
      title: 'Agreement',
      paragraphs: [
        `These Terms govern your use of the Brandthread mobile apps, brandthread.app and related services (“Brandthread”). “Brandthread,” “we,” “us” and “our” mean ${LEGAL_CONTACT.operator}. By creating an account, checking the agreement box at sign-up, or using Brandthread, you agree to these Terms, the Community Guidelines and our Privacy Policy. If you don’t agree, don’t use Brandthread.`,
        'If you use Brandthread for a business or organization, you confirm you have authority to bind it, and “you” includes that organization.',
      ],
    },
    {
      title: 'Accounts and eligibility',
      bullets: [
        'You must be at least 13 years old, and older where local law requires. To sell, connect payouts, complete identity verification or work with manufacturers, you must be at least 18 and able to form a binding contract.',
        'Choose the right account type. Buyer and seller accounts are separate experiences; sellers may add team members, who act only within the permissions the store owner grants. Store owners are responsible for their team’s activity.',
        'Keep your information accurate and your sign-in secure. You’re responsible for activity on your account unless the law says otherwise. Tell us promptly about unauthorized use.',
        'We may require email, payment, business, identity or payout verification. Verification doesn’t mean we endorse a person, product or business.',
      ],
    },
    {
      title: 'What Brandthread is — and isn’t',
      paragraphs: [
        'Brandthread provides technology for social discovery, storefronts, marketplace checkout, preorders and drops, live shopping, messaging, design and AI tools, analytics, and collaboration with manufacturers and freelancers.',
        'Sellers — not Brandthread — are the sellers of the products listed in their stores. Sellers decide what they sell, how it’s described and priced, and how it’s made and shipped. Brandthread facilitates payments and enforces platform rules but does not guarantee any member’s performance, except where these Terms or the law say otherwise.',
      ],
    },
    {
      title: 'Buying on Brandthread',
      bullets: [
        'When you check out, you authorize the total shown — item prices, shipping, taxes and any discounts. Payments are processed by Stripe; your card issuer’s terms also apply.',
        'Orders are subject to availability, fraud checks and seller acceptance. Colors and details can vary slightly between screens and production runs.',
        'Each seller’s return, exchange, cancellation and shipping policies apply in addition to your legal rights. You can request a cancellation, return or refund in the app; outcomes depend on the seller’s policy and the law.',
        'Contact the seller first about problems with an order. If you can’t resolve it, contact Brandthread support and we’ll help review it. Card disputes are handled through Stripe and your bank.',
      ],
    },
    {
      title: 'Preorders and drops',
      paragraphs: [
        'Some products are sold as preorders or limited drops before they are made or shipped. When you buy one, you’ll see an estimated ship date before you pay.',
      ],
      bullets: [
        'Buyer payments for a drop are held by Brandthread (through Stripe) in that drop’s wallet rather than paid straight to the seller.',
        'Funds are released to the seller one order at a time, when the seller adds shipment tracking for that order. The seller receives the order subtotal less the platform fee.',
        'A seller may use held funds only through Brandthread’s approved flows — for example, paying a Brandthread manufacturer for production — and those payments are recorded on the drop’s ledger.',
        'If a drop is cancelled, fails to reach production, or a seller can’t ship your order, you’ll receive a full refund to your original payment method. [OWNER/COUNSEL: set the maximum delay after the estimated ship date before an automatic refund is offered, and confirm regional preorder rules such as the FTC Mail Order Rule.]',
        'Sellers must give realistic ship dates, update buyers about delays, and offer the option to cancel for a refund where the law requires.',
      ],
    },
    {
      title: 'Selling on Brandthread',
      bullets: [
        'Platform fee: Brandthread charges sellers 5% of each marketplace order’s subtotal (item prices, excluding shipping and sales tax). The fee is deducted automatically when the payment is made or when held drop funds are released. [OWNER: confirm how Stripe processing fees are handled.]',
        'Payouts require a Stripe Connect account in good standing. Stripe may request identity, business, tax and bank details and may delay, hold or reverse payouts under its terms. You authorize Brandthread and Stripe to deduct refunds, chargebacks, disputes, platform fees and other amounts you owe from your balance.',
        'Seller subscriptions give access to plan features and limits shown before you subscribe. Subscriptions renew automatically until cancelled. Billing is handled by Stripe or the app store you subscribed through; cancel there. Cancelling stops future renewals; access continues to the end of the paid period. Refunds follow the billing provider’s rules and the law.',
        'You’re responsible for your listings, products, customer service, returns, taxes, product safety, labeling, recalls, licenses and legal compliance.',
        'Don’t list counterfeit, infringing, stolen, unsafe, recalled, illegal or misleading products, or take payment off Brandthread for sales started on Brandthread.',
        'You may not delete your account while you have paid orders to fulfill, funds held for drops, open returns or disputes, or a payout in progress. Settle them first — the app will show you what’s outstanding.',
      ],
    },
    {
      title: 'Manufacturers and freelancers',
      bullets: [
        'Sellers can find manufacturers and freelancers, request quotes and samples, message, share files and pay for work through Brandthread.',
        'Agreements for samples, production runs or creative work are between the seller and the manufacturer or freelancer. Review specifications, samples and milestones carefully before approving production or releasing payment.',
        'Manufacturer and freelancer payments are processed by Stripe and may be held and released at milestones. Brandthread may charge a service fee shown before you pay. [OWNER: confirm manufacturer/freelancer fee.]',
        'Manufacturers and freelancers must describe their capabilities, minimums, pricing and turnaround truthfully, protect the designs and information they receive, and deliver what they agree to.',
      ],
    },
    {
      title: 'Your content',
      paragraphs: [
        'You keep ownership of what you post. You give Brandthread a worldwide, non-exclusive, royalty-free license to host, store, reproduce, adapt (for formatting and display), publish and distribute your content to operate, improve and promote Brandthread. This license ends when you delete the content or your account, except for content others have shared or copies we must keep for legal, safety or dispute reasons.',
        'You confirm you have the rights to everything you upload — designs, logos, photos, music, likenesses and personal information — and that it follows the Community Guidelines.',
        'AI features may produce inaccurate or unoriginal results. Review AI output for accuracy, safety, originality and legal compliance before you use it; you’re responsible for what you publish or sell.',
      ],
    },
    {
      title: 'Community standards, moderation and reporting',
      paragraphs: [
        'Brandthread has zero tolerance for objectionable content and abusive members. You must follow the Community Guidelines, which are part of these Terms.',
      ],
      bullets: [
        'We filter content automatically. Slurs and threats are refused everywhere. Public comments and captions with strong language, abuse, spam or sexual solicitation are hidden until reviewed.',
        'You can report any post, video, live stream, comment, story, product, profile or message, block other members, and mute words. We review reports and aim to act within 24 hours.',
        'We may remove content, limit features, hold payouts where permitted, suspend or permanently terminate accounts, and ban people from returning when we believe it’s necessary to enforce these Terms, protect people or comply with law. You can appeal as described in the Community Guidelines.',
        'Filters, reports and moderation reduce but can’t eliminate harmful content. Use your judgment, and contact emergency services if anyone is in danger.',
      ],
    },
    {
      title: 'Acceptable use',
      bullets: [
        'Don’t break the law, infringe others’ rights or help anyone else do so.',
        'Don’t scrape, spam, manipulate engagement, create fake accounts, evade blocks or bans, or automate activity without permission.',
        'Don’t interfere with Brandthread’s security or operation, reverse engineer it except as the law allows, or introduce malware.',
        'Don’t misuse anyone’s account, payment details, identity documents or personal data.',
      ],
    },
    {
      title: 'Third-party services',
      paragraphs: [
        'Brandthread uses providers such as Clerk (sign-in), Stripe (payments, payouts and identity), cloud hosting and storage, email and push delivery, live-video infrastructure, AI providers and shipping carriers. Their terms and privacy policies may also apply. We aren’t responsible for services we don’t control, except as the law requires.',
      ],
    },
    {
      title: 'Ending your account',
      paragraphs: [
        'You can delete your account at any time in Settings → Delete account, after settling any open orders, held drop funds, returns, disputes and payouts. Deletion removes your profile and content and deletes your sign-in; we keep limited records as described in the Privacy Policy.',
        'We may suspend or terminate accounts as described above. Terms that by their nature should survive — such as payment obligations, content licenses for shared content, disclaimers, limits of liability and dispute terms — survive.',
      ],
    },
    {
      title: 'Disclaimers and limitation of liability',
      paragraphs: [
        'TO THE FULLEST EXTENT ALLOWED BY LAW, BRANDTHREAD IS PROVIDED “AS IS” AND “AS AVAILABLE,” WITHOUT WARRANTIES OF ANY KIND, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT. WE DON’T GUARANTEE MEMBERS, PRODUCTS, MANUFACTURING RESULTS, AI OUTPUT, SALES, DELIVERY OR UNINTERRUPTED SERVICE.',
        'TO THE FULLEST EXTENT ALLOWED BY LAW, BRANDTHREAD WON’T BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR LOST PROFITS, DATA OR BUSINESS OPPORTUNITIES. [COUNSEL: SET AN ENFORCEABLE LIABILITY CAP AND REQUIRED CONSUMER CARVE-OUTS.] Some places don’t allow these limits, so they may not apply to you, and nothing here limits rights you have as a consumer that can’t be waived.',
      ],
    },
    {
      title: 'Indemnity, disputes and governing law',
      paragraphs: [
        'Sellers, manufacturers, freelancers and other business users agree to defend and indemnify Brandthread against third-party claims arising from their products, services, content, taxes, legal violations or breach of these Terms, to the extent the law allows.',
        '[COUNSEL: GOVERNING LAW, VENUE, INFORMAL DISPUTE PROCESS, ARBITRATION DECISION, CLASS-ACTION TERMS AND REGIONAL CONSUMER CARVE-OUTS.] Nothing in this draft requires arbitration.',
      ],
    },
    {
      title: 'Changes and contact',
      paragraphs: [
        'We may update these Terms. We’ll change the effective date, give notice required by law, and ask you to review and agree in the app before material changes apply to you.',
        `Questions and legal notices: ${LEGAL_CONTACT.legalEmail} or ${LEGAL_CONTACT.address}. Support: ${LEGAL_CONTACT.supportEmail}.`,
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════════════
// PRIVACY POLICY
// ═════════════════════════════════════════════════════════════════════════════

const PRIVACY: LegalDocumentContent = {
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
  sections: [
    {
      title: 'Who we are',
      paragraphs: [
        `Brandthread is operated by ${LEGAL_CONTACT.operator}. This policy covers the Brandthread apps, brandthread.app and related services. Sellers who fulfill your orders may also use your order details under their own policies to ship, support and account for your purchase.`,
      ],
    },
    {
      title: 'Information you give us',
      bullets: [
        'Account and profile: sign-in identifier from Clerk, email, name, username, photo, bio, website, account type, brand details, style interests, and the version of these terms you agreed to and when.',
        'Commerce: carts, orders, preorders, returns, refunds, disputes, loyalty activity, shipping addresses, phone number and order tracking.',
        'Sellers, manufacturers and freelancers: business profile, products, inventory, pricing, tax and fulfillment settings, team members, quotes, samples, production records, and payout-readiness status.',
        'Content and communications: posts, videos, captions, comments, stories, live streams and live chat, reviews, reactions, follows, direct messages, support conversations, prompts, designs, images, audio, video and files you upload.',
        'Safety settings and reports: people you block, words you mute, and reports you submit (including the reason and any note).',
        'Identity verification: seller identity checks are handled by Stripe Identity. We keep the verification status and session reference, not your ID images.',
        'Payments and payouts: Stripe processes card, bank and payout details. We receive transaction references, status, card brand and last four digits, and payout-account status — never full card or bank numbers.',
      ],
    },
    {
      title: 'Information collected automatically',
      bullets: [
        'Device and log information: IP address, device and app version, operating system, request timestamps, pages and features used, crash and error reports, and security signals.',
        'Crash and performance reports: when the app, website or our servers hit an error, the error, stack trace, device model, operating system, app version, recent in-app actions and performance timings go to our error-monitoring provider (Sentry). These reports are used only to find and fix problems, are not linked to your name, email or account, and are not used for advertising.',
        'Sign-in sessions: Clerk records the device type, browser or app, approximate location (city and country, derived from IP address) and last-active time for each session. You can see and sign out these sessions in Settings → Login activity.',
        'Notifications: your notification permission, push token and preferences.',
        'Location: we use the addresses you enter and carrier tracking locations. We don’t request precise GPS location. If that changes, we’ll ask first and update this policy.',
        'Brandthread doesn’t use a device advertising identifier or track you across other companies’ apps. On our website, optional marketing pixels load only if you allow marketing cookies.',
      ],
    },
    {
      title: 'Device permissions',
      bullets: [
        'Camera, microphone and photos — only when you choose to capture or upload media, record a voice message, go live, or make a call.',
        'Face ID, Touch ID or fingerprint — only if you turn on App Lock. Your biometric data never leaves your device; the operating system only tells Brandthread whether unlocking succeeded.',
        'Notifications — only after you allow them.',
      ],
    },
    {
      title: 'How we use information',
      bullets: [
        'Run your account, keep you signed in securely, and remember your settings.',
        'Show profiles, posts, stories, live streams and listings according to their visibility; deliver messages and notifications.',
        'Process orders, preorders and drops, hold and release drop funds, handle returns, refunds and disputes, and pay sellers, manufacturers and freelancers.',
        'Provide AI design, photography, writing and store-building tools. Prompts and selected content are sent to our AI providers to produce the result you asked for.',
        'Keep Brandthread safe: filter public comments and captions for slurs, threats, abuse and scams; review reports; enforce blocks and muted words; investigate fraud; and suspend accounts that break our rules.',
        'Measure and improve features, provide sellers with analytics about their own stores, and comply with legal, tax and accounting obligations.',
      ],
    },
    {
      title: 'Content moderation',
      paragraphs: [
        'Public comments, captions and live chat are checked automatically when you post them. Content with slurs or threats is refused. Content with strong language, personal attacks, spam or sexual solicitation is held and shown only to you until a moderator reviews it. Direct messages are checked for slurs, threats, scams and unsolicited sexual content before they’re sent.',
        'When content is reported or held, our moderators see the content, a snapshot saved with the report, who posted it, the reason, any note, and prior enforcement on the account. Reporters are anonymous to the person reported.',
      ],
    },
    {
      title: 'When information is shared',
      bullets: [
        'With other members, as you choose: public profiles, posts, comments, stories, live streams and listings are visible to others and can be copied. Messages are shared with conversation participants.',
        'For transactions: buyers’ names and shipping details go to the seller who fulfills the order; sellers, manufacturers and freelancers share what’s needed to complete work.',
        'With service providers who process data for us: Clerk, Stripe, cloud hosting and storage, email and push delivery, live video, AI providers, analytics, error-monitoring (Sentry) and security tools, and carriers.',
        'For safety and legal reasons: to comply with law or valid legal requests, protect people, investigate fraud or abuse, or enforce our Terms.',
        'In a business transfer, such as a merger or acquisition, subject to this policy.',
        'We don’t sell your personal information or share it for cross-context behavioral advertising.',
      ],
    },
    {
      title: 'Deleting your account',
      paragraphs: [
        'You can delete your account in the app at any time: Settings → Delete account. The app first shows what will be deleted and anything that must be settled — for sellers, open orders, funds held for drops, returns, disputes or payouts in progress; for buyers, paid orders that haven’t shipped yet.',
      ],
      bullets: [
        'Deleted: your profile, username, photo and bio; posts, comments, stories, likes, reposts and follows; messages you sent; saved items, cart, addresses and notification settings; blocks and muted words; for sellers, your storefront, listings, discount codes and shipping settings; and your Clerk sign-in, which signs you out everywhere.',
        'Kept in anonymized form: order, payment, refund and tax records required by law, with your name, email and address removed; reports you filed about others, without your identity; and reviews on past orders, shown as from a deleted account.',
        'Backups are overwritten on a rolling schedule. Content others copied or shared outside Brandthread can’t be recalled.',
      ],
    },
    {
      title: 'Retention',
      paragraphs: [
        'We keep information while your account is active and as long as needed for the purposes above. Transaction and tax records are kept for the period the law requires. Moderation records are kept as long as needed to enforce our rules and prevent repeat abuse. [OWNER/COUNSEL: final retention schedule.]',
      ],
    },
    {
      title: 'Your choices and rights',
      bullets: [
        'Edit your profile and content, control who can message you, block people and mute words.',
        'Download a copy of your data in Settings → Download my data.',
        'Turn off notifications or device permissions in your phone’s settings.',
        'Manage cookie preferences on our website at any time.',
        `Depending on where you live, you may have rights to access, correct, delete, port, restrict or object to processing of your personal information, and to appeal our decision or complain to a regulator. Contact ${LEGAL_CONTACT.privacyEmail}; we may need to verify your identity.`,
      ],
    },
    {
      title: 'Security and international transfers',
      paragraphs: [
        'We use administrative, technical and organizational safeguards, including encryption in transit, access controls and optional App Lock, but no system is perfectly secure. Protect your sign-in and tell us if you suspect unauthorized access.',
        'Brandthread and its providers may process information outside your country. Where required, we use approved transfer safeguards. [COUNSEL: transfer mechanism and legal bases for each region.]',
      ],
    },
    {
      title: 'Children',
      paragraphs: [
        'Brandthread isn’t for children under 13, and we don’t knowingly collect their information. If you believe a child has an account, contact us and we’ll delete it. Selling, payouts and identity verification require users to be 18 or older.',
      ],
    },
    {
      title: 'Changes and contact',
      paragraphs: [
        'We’ll update the effective date when this policy changes and tell you in the app about material changes.',
        `Privacy questions and requests: ${LEGAL_CONTACT.privacyEmail}. Mail: ${LEGAL_CONTACT.operator}, ${LEGAL_CONTACT.address}.`,
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS: Record<LegalDocId, LegalDocumentContent> = {
  terms: TERMS,
  privacy: PRIVACY,
  guidelines: GUIDELINES,
};

/** Display order for the document switcher and agreement links. */
export const LEGAL_DOCUMENT_ORDER: LegalDocId[] = ['terms', 'guidelines', 'privacy'];
