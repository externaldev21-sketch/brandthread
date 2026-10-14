/**
 * Seller onboarding — payouts. The existing Stripe Connect flow, unchanged:
 * GET /api/seller/connect/link gives a single-use hosted onboarding link,
 * opened in the in-app browser exactly as Settings > Payout setup does.
 * Whether or not they finish at Stripe, the seller moves on; "Do it later"
 * skips, and Payout setup stays in the dashboard's setup list.
 */
import React, { useState } from 'react';
import { Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useApi } from '@/lib/api';
import { Body, Headline, SquareButton, StepScreen, TextAction } from './kit';

export function PayoutsStep({
  counter,
  onDone,
  busy,
}: {
  counter: { current: number; total: number } | null;
  onDone: () => void;
  busy?: boolean;
}) {
  const api = useApi();
  const [opening, setOpening] = useState(false);

  async function openStripe() {
    if (opening) return;
    setOpening(true);
    try {
      const link = await api.seller.connect.link();
      if (!link || typeof link.url !== 'string' || !/^https:\/\//i.test(link.url)) {
        throw new Error('Stripe did not provide a valid link.');
      }
      await WebBrowser.openBrowserAsync(link.url);
      onDone();
    } catch (error: any) {
      Alert.alert('Could not open Stripe', typeof error?.message === 'string' && error.message ? error.message : 'Try again, or set it up later in Settings.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <StepScreen
      counter={counter}
      scroll={false}
      testID="onboarding-payouts"
      footer={(
        <>
          <SquareButton testID="onboarding-payouts-setup" label="Set up payouts" onPress={() => { void openStripe(); }} loading={opening || busy} />
          <TextAction label="Do it later" onPress={onDone} testID="onboarding-payouts-later" />
        </>
      )}
    >
      <Headline>Get paid</Headline>
      <Body>Connect a bank account with Stripe so sales land with you. It takes about five minutes.</Body>
    </StepScreen>
  );
}
