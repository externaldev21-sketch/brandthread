/**
 * SSENSE's "ENABLE NOTIFICATIONS / THANK US LATER", 1:1: counter, caps
 * headline, one sentence, one CONTINUE button. CONTINUE raises the system
 * prompt (which is where someone says no), then moves on either way. On web
 * there is no prompt to raise, so it just moves on.
 */
import React, { useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Body, Headline, SquareButton, StepScreen } from './kit';

export async function askForNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status === 'granted' || !current.canAskAgain) return;
    await Notifications.requestPermissionsAsync();
  } catch {
    // Push is optional; the app asks again in context later.
  }
}

export function NotificationsStep({
  counter,
  body,
  onDone,
  busy,
}: {
  counter: { current: number; total: number } | null;
  body: string;
  onDone: () => void;
  busy?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <StepScreen
      counter={counter}
      scroll={false}
      testID="onboarding-notifications"
      footer={(
        <SquareButton
          testID="onboarding-notifications-continue"
          label="Continue"
          loading={asking || busy}
          onPress={() => {
            setAsking(true);
            void askForNotifications().finally(() => {
              setAsking(false);
              onDone();
            });
          }}
        />
      )}
    >
      <Headline>Enable notifications{'\n'}thank us later</Headline>
      <Body>{body}</Body>
    </StepScreen>
  );
}
