import React from 'react';
import Head from 'expo-router/head';
import LegalDocument from '@/components/legal/LegalDocument';
import { LEGAL_DOCUMENTS } from '@/content/legal';

/**
 * Privacy Policy. The text lives in content/legal.ts (single source for all legal
 * documents) — edit it there.
 */
const doc = LEGAL_DOCUMENTS.privacy;

export default function PrivacyPolicyScreen() {
  return (
    <>
      <Head>
        <title>Privacy Policy | Brandthread</title>
        <meta name="description" content={doc.metaDescription} />
        <meta property="og:title" content="Privacy Policy | Brandthread" />
        <meta property="og:description" content={doc.summary} />
      </Head>
      <LegalDocument docId="privacy" />
    </>
  );
}
