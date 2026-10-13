/**
 * Shows the "What's new" sheet once per account after an update
 * (lib/whatsNew.ts decides). It waits for a signed-in account to land on a
 * home tab, and takes the first-run tips slot while open so a tip never
 * stacks on top of it.
 */
import React, { useEffect, useState } from 'react';
import { useSegments } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { WHATS_NEW } from '@/content/whatsNew';
import { markWhatsNewSeen, readLastSeenWhatsNew, whatsNewDecision } from '@/lib/whatsNew';
import { useFirstRunTipsController } from '@/contexts/FirstRunTipsContext';
import { WhatsNewSheet } from './WhatsNewSheet';

const SLOT_ID = 'whats-new';
const SETTLE_MS = 800;

export function WhatsNewHost() {
  const { isSignedIn, userId } = useAuth();
  const segments = useSegments();
  const tips = useFirstRunTipsController();
  const [visible, setVisible] = useState(false);
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const onHomeTab = segments[0] === '(tabs)' || segments[0] === '(buyer)';

  useEffect(() => {
    if (!isSignedIn || !userId || !onHomeTab || checkedFor === userId) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const lastSeen = await readLastSeenWhatsNew(userId);
      if (cancelled) return;
      const decision = whatsNewDecision(lastSeen, WHATS_NEW);
      if (decision === 'record-silently') markWhatsNewSeen(userId, WHATS_NEW.id);
      if (decision === 'show') {
        // A first-run tip holds the slot: wait for it to finish (this effect
        // re-runs when the tips controller changes).
        if (!tips.claim(SLOT_ID)) return;
        setVisible(true);
      }
      setCheckedFor(userId);
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isSignedIn, userId, onHomeTab, checkedFor, tips]);

  const close = () => {
    setVisible(false);
    if (userId) {
      markWhatsNewSeen(userId, WHATS_NEW.id);
      setCheckedFor(userId);
    }
    tips.release(SLOT_ID);
  };

  return <WhatsNewSheet visible={visible} notes={WHATS_NEW} onClose={close} />;
}
