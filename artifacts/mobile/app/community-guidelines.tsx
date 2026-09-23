import React from 'react';
import Head from 'expo-router/head';
import LegalDocument from '@/components/legal/LegalDocument';
import { LEGAL_DOCUMENTS } from '@/content/legal';

/**
 * Community Guidelines. The text lives in content/legal.ts (single source for all legal
 * documents) — edit it there.
 */
const doc = LEGAL_DOCUMENTS.guidelines;

export default function CommunityGuidelinesScreen() {
  return (
    <>
      <Head>
        <title>Community Guidelines | Brandthread</title>
        <meta name="description" content={doc.metaDescription} />
        <meta property="og:title" content="Community Guidelines | Brandthread" />
        <meta property="og:description" content={doc.summary} />
      </Head>
      <LegalDocument docId="guidelines" />
    </>
  );
}
