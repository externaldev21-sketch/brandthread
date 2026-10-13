/**
 * DashboardTopCard: the single card slot under the seller dashboard's top
 * bar. Renders at most ONE card, the highest-priority visible candidate (see
 * lib/dashboardTopCard.ts). While it shows a card, the dashboard holds back
 * its bottom setup prompts (Continue setup, Launch checklist) so only one
 * promo is ever on screen; they come back once the top card is dismissed.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';

import { pickTopCard, type TopCardCandidate } from '@/lib/dashboardTopCard';
import { SP } from '@/lib/theme';

export interface DashboardTopCardCandidate extends TopCardCandidate {
  render: () => React.ReactNode;
}

export default function DashboardTopCard({ card }: { card: DashboardTopCardCandidate | null }) {
  if (!card) return null;
  return <View style={styles.slot} testID={`dashboard-top-card-${card.key}`}>{card.render()}</View>;
}

export { pickTopCard };

const styles = StyleSheet.create({
  slot: { marginTop: SP.sm, marginBottom: SP.sm },
});
