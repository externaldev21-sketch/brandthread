import React from 'react';
import Head from 'expo-router/head';
import LegalDocument, { type LegalSection } from '@/components/legal/LegalDocument';

const EFFECTIVE_DATE = 'August 29, 2026';

const SECTIONS: LegalSection[] = [
  {
    title: 'Agreement and operator',
    paragraphs: [
      'These Terms govern your access to Brandthread’s mobile apps, brandthread.app, and related services. “Brandthread,” “we,” “us,” and “our” mean [LEGAL ENTITY NAME — REQUIRED BEFORE LAUNCH]. By creating an account, accessing the service, or placing or accepting an order, you agree to these Terms and the Privacy Policy.',
      'If you use Brandthread for an organization, you represent that you have authority to bind it. If you do not agree, do not use Brandthread.',
    ],
  },
  {
    title: 'Eligibility and accounts',
    bullets: [
      'You must be at least 13 and meet any higher minimum age required where you live. You must be legally able to form a binding contract—and at least 18—to sell, connect payouts, submit identity verification, or enter paid business transactions.',
      'Provide accurate information, protect your credentials, keep your sign-in methods current, and promptly report unauthorized use. You are responsible for activity under your account unless applicable law says otherwise.',
      'Choose the correct buyer or seller role. Team members may act only within permissions granted by the store owner. Store owners remain responsible for their team, catalog, orders, and account.',
      'We may require email, payment, business, identity, or payout verification. Verification does not endorse a person, product, manufacturer, freelancer, or business.',
    ],
  },
  {
    title: 'What Brandthread provides',
    paragraphs: [
      'Brandthread provides technology for social discovery, storefronts, physical-product commerce, messaging, live shopping, brand and product tools, AI-assisted design and photography, manufacturer and freelancer collaboration, analytics, subscriptions, and related services.',
      'Unless expressly stated, Brandthread is not the seller, manufacturer, carrier, employer, agent, or guarantor of user-provided goods or services. Sellers determine their products, descriptions, inventory, pricing, policies, and fulfillment. Brandthread may facilitate payments and platform rules but does not guarantee a transaction participant’s performance.',
    ],
  },
  {
    title: 'Marketplace orders, payments, and payouts',
    bullets: [
      'Buyers authorize the price, taxes, shipping, discounts, and other amounts shown at checkout. Stripe processes marketplace payments. Your bank or payment provider may impose separate terms.',
      'An order is subject to acceptance, availability, fraud review, and seller fulfillment. Product images and colors may vary by display and production process.',
      'Sellers authorize Brandthread and Stripe to collect platform fees, refunds, disputes, reserves, chargebacks, shipping amounts, manufacturer or freelancer allocations, and other amounts described at transaction time.',
      'Seller payouts require successful Stripe Connect onboarding and live payout eligibility. Stripe may request identity, business, tax, and bank information and may delay or restrict payments under its rules.',
      'Never use Brandthread for sham transactions, cash advances, payment laundering, sanctions evasion, or activity prohibited by Stripe or applicable law.',
    ],
  },
  {
    title: 'Returns, refunds, disputes, and delivery',
    paragraphs: [
      'The seller’s disclosed return, refund, pre-order, shipping, and product policies apply in addition to mandatory consumer rights. Brandthread may provide tools to request a return, refund, exchange, cancellation, or dispute but does not promise a particular result. Digital seller subscriptions and physical-product orders have different cancellation and refund rules.',
      'Shipping dates and tracking are estimates supplied by sellers, carriers, manufacturers, or fulfillment providers. Risk-of-loss and title rules vary by jurisdiction and seller arrangement. Sellers must honor applicable consumer, product-safety, labeling, recall, tax, and refund laws.',
    ],
  },
  {
    title: 'Seller subscriptions and paid platform features',
    paragraphs: [
      'Seller plans may provide storefront, catalog, design, analytics, manufacturer, live-shopping, team, support, or other limits and features. Current plan details, price, billing period, trial, platform commission, and renewal terms are shown before purchase.',
      'Subscriptions renew automatically until canceled unless checkout states otherwise. Billing may be handled by Stripe or the app-store provider shown at purchase. Manage or cancel through that provider. Cancellation ordinarily stops renewal and does not erase charges already due; access may continue through the paid period. Provider and mandatory-law refund rules apply.',
      'We may change future prices or plan features with notice required by law. A failed, reversed, expired, refunded, or revoked payment may suspend paid access.',
    ],
  },
  {
    title: 'Seller, manufacturer, and freelancer responsibilities',
    bullets: [
      'Provide truthful listings, capabilities, availability, turnaround times, materials, dimensions, pricing, intellectual-property rights, policies, and regulatory information.',
      'Do not offer counterfeit, unsafe, stolen, infringing, illegal, recalled, deceptive, or prohibited products or services.',
      'Maintain required registrations, licenses, insurance, records, tax treatment, product labeling, accessibility, export/import compliance, and consumer disclosures.',
      'Use samples, production approvals, milestones, messaging, and escrow or allocation tools carefully. Review specifications before authorizing production or releasing work.',
      'Resolve customer issues promptly and cooperate with payment disputes, safety investigations, recalls, legal requests, and Brandthread moderation.',
    ],
  },
  {
    title: 'Content, intellectual property, and AI tools',
    paragraphs: [
      'You retain ownership of content you own. You grant Brandthread a worldwide, non-exclusive, royalty-free license to host, store, reproduce, modify for formatting, display, distribute, and otherwise use your content as needed to operate, secure, promote within, and improve the service. Public content may be viewed, shared, or copied by others. Remove content or change visibility where the feature permits.',
      'You represent that you have all rights and permissions needed for uploaded designs, trademarks, music, images, likenesses, personal information, and other content. Do not ask AI tools to imitate or misuse protected work or identity.',
      'AI-generated text, images, designs, recommendations, analytics, and support responses may be inaccurate, incomplete, similar to another output, or unavailable for exclusive ownership. Review outputs for quality, safety, originality, non-infringement, manufacturability, labeling, and legal compliance before relying on them.',
      'Brandthread software, branding, and non-user content are owned by Brandthread or its licensors. These Terms grant only a limited, revocable, non-transferable right to use the service as intended.',
    ],
  },
  {
    title: 'Social features and acceptable use',
    bullets: [
      'Do not harass, threaten, exploit, impersonate, dox, discriminate against, or endanger others; distribute unlawful sexual or violent content; or target minors.',
      'Do not spam, manipulate engagement, scrape without permission, evade blocks, automate abusive activity, interfere with security, reverse engineer unlawfully, introduce malware, or overload the service.',
      'Do not misuse another person’s account, payment method, identity documents, confidential information, intellectual property, or personal data.',
      'Reports, blocks, moderation, and automated safeguards do not guarantee that harmful content will be detected. Use judgment and contact emergency services for immediate danger.',
    ],
  },
  {
    title: 'Third-party services and links',
    paragraphs: [
      'Brandthread relies on services such as Clerk, Stripe, hosting and storage providers, email and push providers, live-video infrastructure, AI providers, carriers, and user-linked websites. Their services may have separate terms and privacy policies. We are not responsible for third-party services outside our control, subject to applicable law.',
    ],
  },
  {
    title: 'Suspension, termination, and service changes',
    paragraphs: [
      'You may stop using Brandthread at any time, but outstanding orders, fees, disputes, confidentiality duties, and provisions that by nature survive remain effective. We may restrict, suspend, or terminate accounts or content to protect users, comply with law, enforce these Terms, address risk or nonpayment, or maintain the service. Where appropriate, we will provide notice or an opportunity to appeal.',
      'We may modify, interrupt, or discontinue features. We do not promise that Brandthread will always be available, error-free, or compatible with every device.',
    ],
  },
  {
    title: 'Disclaimers and limitation of liability',
    paragraphs: [
      'TO THE MAXIMUM EXTENT PERMITTED BY LAW, BRANDTHREAD IS PROVIDED “AS IS” AND “AS AVAILABLE.” WE DISCLAIM IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, AND WARRANTIES ARISING FROM COURSE OF DEALING. WE DO NOT GUARANTEE USERS, PRODUCTS, SERVICES, AI OUTPUTS, SALES, MANUFACTURING RESULTS, DELIVERY, EARNINGS, OR CONTINUOUS AVAILABILITY.',
      'TO THE MAXIMUM EXTENT PERMITTED BY LAW, BRANDTHREAD AND ITS AFFILIATES WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, LOST PROFITS, LOST DATA, BUSINESS INTERRUPTION, OR TRANSACTIONS BETWEEN USERS. [COUNSEL MUST SET AN ENFORCEABLE LIABILITY CAP AND REQUIRED CONSUMER-LAW CARVE-OUTS BEFORE LAUNCH.] Some jurisdictions do not allow certain exclusions, so they may not apply to you.',
    ],
  },
  {
    title: 'Indemnity and disputes',
    paragraphs: [
      'To the extent permitted by law, business users and sellers agree to defend, indemnify, and hold Brandthread harmless from third-party claims arising from their products, content, business, team, taxes, legal violations, or breach of these Terms. Consumer rights that cannot be waived remain unaffected.',
      '[GOVERNING LAW, VENUE, DISPUTE PROCESS, ARBITRATION DECISION, CLASS-ACTION LANGUAGE, AND REGIONAL CONSUMER CARVE-OUTS MUST BE SELECTED AND APPROVED BY COUNSEL BEFORE LAUNCH.] Nothing in this draft requires arbitration.',
    ],
  },
  {
    title: 'Changes and contact',
    paragraphs: [
      'We may update these Terms. We will revise the effective date and provide notice required by law before material changes take effect. Continued use after the effective date constitutes acceptance where permitted.',
      'Questions, legal notices, and support requests should be sent to [LEGAL/SUPPORT EMAIL AND POSTAL ADDRESS — REQUIRED BEFORE LAUNCH].',
    ],
  },
];

export default function TermsScreen() {
  return (
    <>
      <Head>
        <title>Terms of Service | Brandthread</title>
        <meta
          name="description"
          content="Terms governing Brandthread accounts, social commerce, marketplace orders, seller subscriptions, content, AI tools, and platform conduct."
        />
        <meta property="og:title" content="Terms of Service | Brandthread" />
        <meta
          property="og:description"
          content="Terms for using Brandthread’s social commerce and brand-building platform."
        />
      </Head>
      <LegalDocument
        eyebrow="Legal · Platform"
        title="Terms of Service"
        summary="The rules for Brandthread accounts, social commerce, marketplace orders, seller tools, subscriptions, content, and collaboration."
        effectiveDate={EFFECTIVE_DATE}
        reviewNotice="This is a product-specific first draft, not legal advice. Brandthread’s owner and qualified counsel must complete the operator, contact, liability, jurisdiction, and dispute terms and review all marketplace and subscription language before launch."
        sections={SECTIONS}
        companionRoute="/privacy"
        companionLabel="Privacy Policy"
      />
    </>
  );
}