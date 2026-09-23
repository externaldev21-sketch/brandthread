import React from 'react';
import Head from 'expo-router/head';
import LegalDocument, { type LegalSection } from '@/components/legal/LegalDocument';

const EFFECTIVE_DATE = 'August 29, 2026';

const SECTIONS: LegalSection[] = [
  {
    title: 'Who operates Brandthread and what this policy covers',
    paragraphs: [
      'Brandthread is a social commerce and brand-building platform for buyers, independent clothing sellers, and manufacturers. In this draft, “Brandthread,” “we,” “us,” and “our” mean [LEGAL ENTITY NAME — REQUIRED BEFORE LAUNCH]. This policy covers the Brandthread mobile apps, brandthread.app, and the services that link to it.',
      'A seller’s own storefront may have additional policies for that seller’s products. When a seller independently decides how to use buyer information to fulfill an order, that seller may also have its own privacy responsibilities.',
    ],
  },
  {
    title: 'Information you provide',
    bullets: [
      'Account and profile information, such as your Clerk account identifier, email address, name, username, avatar, buyer or seller role, biography, website, brand name, brand stage, selling model, style interests, and goals.',
      'Commerce information, including cart contents, purchases, returns, disputes, loyalty activity, shipping and billing contact details, delivery addresses, phone number, order status, shipment tracking, and saved-address choices.',
      'Seller and manufacturer information, including business profile details, products, variants, inventory, pricing, tax and fulfillment information, team relationships, manufacturer relationships, production records, and payout-readiness status.',
      'Content and communications, including posts, stories, comments, reactions, follows, blocks, reports, support requests, private messages, live-stream activity, prompts, designs, product images, photos, video, audio, documents, and other files you choose to upload.',
      'Verification information. Seller identity verification is hosted and processed by Stripe Identity and may involve a government ID, live camera capture, selfie, and identity-match results. Brandthread stores the Stripe verification session identifier and status, not the underlying identity-document images.',
      'Payment and payout information. Stripe processes card, bank, subscription, checkout, refund, and payout details. Brandthread may receive transaction identifiers, payment status, card brand and last four digits, expiration metadata, connected-account status, and bank-account last four digits; Brandthread does not receive or store complete card or bank-account numbers.',
    ],
  },
  {
    title: 'Device permissions and automatically generated information',
    bullets: [
      'Camera, microphone, and photo library: only when you grant permission and use capture, posting, story, design, product, reporting, live-video, or export tools. Media-library location metadata access is disabled.',
      'Notifications: your device permission state, push token, platform, and notification preferences so we can deliver account, order, message, verification, and other notifications you request.',
      'Technical and service information: IP address, request and event timestamps, app/browser type, route and feature interactions, request identifiers, errors, security signals, and similar operational logs needed to run, secure, and troubleshoot the service.',
      'Crash and performance reports: when the app, website, or our servers hit an error, a report with the error, stack trace, device model, operating system, app version, recent in-app actions, and performance timings is sent to our error-monitoring provider. These reports are used only to find and fix problems. They are not linked to your name, email address, or account, and are not used for advertising.',
      'Location: Brandthread currently uses addresses you enter, shipment tracking locations, business locations, customer-region summaries, and optional location text you add to content. The app does not include a device-location library, and our audit found no active request for GPS-derived precise or coarse device location. We will update this policy and request permission before collecting device location.',
      'Brandthread does not currently request your address book, use a native advertising identifier, or request App Tracking Transparency permission. The native app does not track your activity across other companies’ apps and websites for advertising. On the public website, optional Meta and TikTok measurement scripts load only when Brandthread has a real provider ID configured and you explicitly allow Marketing cookies; otherwise they remain disabled.',
    ],
  },
  {
    title: 'How we use information',
    bullets: [
      'Create, authenticate, synchronize, and protect accounts; remember settings; and route people to buyer, seller, manufacturer, or team experiences.',
      'Publish profiles and content according to their visibility settings; operate social, messaging, support, live-video, search, notification, and moderation features.',
      'Build storefronts, generate designs and media, manage products and inventory, process orders, support shipping and returns, prevent duplicate transactions, and maintain transaction records.',
      'Process subscriptions, checkout, refunds, seller verification, connected-account onboarding, transfers, and payouts through Stripe and applicable app-store billing providers.',
      'Provide AI-assisted design, photography, copy, store-building, brand-memory, and support features. Prompts and selected uploads may be sent to our AI service providers to generate the requested result. Do not submit information you do not have the right to use.',
      'Measure first-party product and storefront interactions, prepare seller business analytics, diagnose failures, prevent fraud and abuse, enforce our Terms, and comply with law.',
    ],
  },
  {
    title: 'When information is visible or shared',
    paragraphs: [
      'Public profiles, storefronts, products, posts, stories, comments, follower information, live streams, and other content you mark public can be seen and copied by others. Private messages are visible to conversation participants and may be reviewed when necessary to investigate reports, safety issues, fraud, or legal obligations.',
    ],
    bullets: [
      'Clerk provides authentication and account infrastructure.',
      'Stripe processes payments, subscriptions, Stripe Connect onboarding and payouts, fraud checks, and Stripe Identity verification.',
      'Cloud hosting, database, object-storage, email, push-notification, live-video, error-monitoring (Sentry), and security providers process data to operate Brandthread.',
      'AI providers process prompts and selected content to return requested AI features. We configure integrations for app functionality, not cross-app advertising.',
      'Buyers, sellers, manufacturers, freelancers, team members, carriers, and fulfillment participants receive the information needed for transactions or collaboration.',
      'We may disclose information to comply with law, protect people and the service, investigate abuse, complete a corporate transaction, or with your direction.',
    ],
  },
  {
    title: 'Retention and deletion',
    paragraphs: [
      'We retain information for as long as reasonably needed to provide Brandthread, maintain transaction and tax records, resolve disputes, prevent fraud, enforce agreements, and meet legal obligations. Different records require different periods. [A FINAL RETENTION SCHEDULE MUST BE APPROVED BEFORE LAUNCH.] Backups and provider systems may retain residual copies for a limited period.',
      'The app supports deletion of certain conversations, addresses, payment methods, integrations, and other records. To request account deletion or a broader data request, contact Brandthread Support at support@brandthread.app. Deleting an account may not remove public content copied by others or records we must retain for legal, payment, safety, or dispute purposes.',
    ],
  },
  {
    title: 'Your choices and privacy rights',
    bullets: [
      'Edit profile information and content, adjust social and notification preferences, revoke device permissions in system settings, or deregister push notifications by signing out.',
      'Manage payment methods and applicable subscriptions through Stripe or the app-store provider shown at purchase.',
      'Change cookie and similar-storage preferences at any time using “Change cookie preferences.” Necessary storage remains on because it supports security, consent records, and core service functions; optional analytics and marketing storage can be turned off.',
      'Request access, correction, deletion, portability, restriction, or objection where applicable law provides those rights. We may need to verify your identity before responding.',
      'Appeal or complain to an applicable privacy regulator where local law provides that right.',
    ],
  },
  {
    title: 'Intellectual-property reports and rights cases',
    paragraphs: [
      'If you believe content on Brandthread infringes your copyright, trademark, or other rights, submit a report through the in-app IP reporting form or email support@brandthread.app. A report should identify the listing or content, describe the rights you own or represent, explain why it is infringing, include supporting evidence, and provide your full name and a working contact email.',
      'By submitting a report, you certify that you are the rights holder or authorized to act for the rights holder, that the information is accurate, and that you have a good-faith belief the use is unauthorized. We may request additional information, notify the affected user, restrict or remove content, or close a case without action. We may retain case information and share it with affected users, service providers, professional advisers, law enforcement, or other parties when needed to review the claim, prevent abuse, or comply with law. Knowingly false or misleading reports may lead to account action.',
    ],
  },
  {
    title: 'Security, international processing, and legal bases',
    paragraphs: [
      'We use administrative, technical, and organizational safeguards designed to protect information, but no system is completely secure. Protect your credentials and notify us if you suspect unauthorized access.',
      'Brandthread and its providers may process information in countries other than your own. Where required, we will use an approved transfer mechanism. Depending on applicable law, processing may rely on performance of a contract, legitimate interests, consent, and compliance with legal obligations.',
    ],
  },
  {
    title: 'Children',
    paragraphs: [
      'Brandthread is not directed to children under 13, and we do not knowingly collect their personal information. A higher minimum age or parental consent may apply where local law requires it. You must be legally able to form a binding contract—and at least 18—to operate a seller account, submit seller identity verification, connect a payout account, or enter a paid business transaction.',
    ],
  },
  {
    title: 'Changes and contact',
    paragraphs: [
      'We may update this policy as Brandthread changes. We will revise the effective date and provide additional notice when required. Questions, privacy requests, and questions about intellectual-property reports should be sent to Brandthread Support at support@brandthread.app.',
    ],
  },
];

export default function PrivacyPolicyScreen() {
  return (
    <>
      <Head>
        <title>Privacy Policy | Brandthread</title>
        <meta
          name="description"
          content="How Brandthread collects, uses, shares, and protects information across its buyer, seller, social commerce, design, payment, and verification features."
        />
        <meta property="og:title" content="Privacy Policy | Brandthread" />
        <meta
          property="og:description"
          content="How Brandthread handles information across its marketplace and brand-building platform."
        />
      </Head>
      <LegalDocument
        eyebrow="Legal · Privacy"
        title="Privacy Policy"
        summary="How information moves through Brandthread’s social commerce, marketplace, design, payment, and seller-verification features."
        effectiveDate={EFFECTIVE_DATE}
        reviewNotice="This is a functionality-based first draft, not legal advice. Brandthread’s owner and a qualified lawyer must complete the highlighted operator, contact, jurisdiction, and retention details and review the entire policy before launch."
        sections={SECTIONS}
        companionRoute="/terms"
        companionLabel="Terms of Service"
      />
    </>
  );
}
