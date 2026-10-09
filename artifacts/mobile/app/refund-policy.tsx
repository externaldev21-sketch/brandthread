import React from 'react';
import Head from 'expo-router/head';
import LegalDocument from '@/components/legal/LegalDocument';
import { LEGAL_DOCUMENTS } from '@/content/legal';

/**
 * Refund Policy. The text lives in content/legal/refund-policy.md (draft of record) and
 * content/legal.ts (metadata) — edit it there.
 */
const doc = LEGAL_DOCUMENTS['refund-policy'];

export default function RefundPolicyScreen() {
  return (
    <>
      <Head>
        <title>Refund Policy | Brandthread</title>
        <meta name="description" content={doc.metaDescription} />
        <meta property="og:title" content="Refund Policy | Brandthread" />
        <meta property="og:description" content={doc.summary} />
      </Head>
      <LegalDocument docId="refund-policy" />
    </>
  );
}
