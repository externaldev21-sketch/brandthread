import React from 'react';
import Head from 'expo-router/head';
import LegalDocument from '@/components/legal/LegalDocument';
import { LEGAL_DOCUMENTS } from '@/content/legal';

/**
 * Terms of Service. The text lives in content/legal.ts (single source for all legal
 * documents) — edit it there.
 */
const doc = LEGAL_DOCUMENTS.terms;

export default function TermsScreen() {
  return (
    <>
      <Head>
        <title>Terms of Service | Brandthread</title>
        <meta name="description" content={doc.metaDescription} />
        <meta property="og:title" content="Terms of Service | Brandthread" />
        <meta property="og:description" content={doc.summary} />
      </Head>
      <LegalDocument docId="terms" />
    </>
  );
}
