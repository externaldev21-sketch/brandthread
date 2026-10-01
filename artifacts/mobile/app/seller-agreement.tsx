import React from 'react';
import Head from 'expo-router/head';
import LegalDocument from '@/components/legal/LegalDocument';
import { LEGAL_DOCUMENTS } from '@/content/legal';

/**
 * Seller Agreement. The text lives in content/legal/seller-agreement.md (draft of record) and
 * content/legal.ts (metadata) — edit it there.
 */
const doc = LEGAL_DOCUMENTS['seller-agreement'];

export default function SellerAgreementScreen() {
  return (
    <>
      <Head>
        <title>Seller Agreement | Brandthread</title>
        <meta name="description" content={doc.metaDescription} />
        <meta property="og:title" content="Seller Agreement | Brandthread" />
        <meta property="og:description" content={doc.summary} />
      </Head>
      <LegalDocument docId="seller-agreement" />
    </>
  );
}
