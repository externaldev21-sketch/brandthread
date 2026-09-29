/**
 * Tracks whether the confetti celebration has already played for a given
 * checkout session, so reopening an already-confirmed order (from order
 * history, or just navigating back to this exact screen) never replays it —
 * it fires exactly once, the moment an order is first actually confirmed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const keyFor = (sessionId: string) => `bt:checkout:confetti-shown:${sessionId}`;

export async function hasPlayedOrderConfetti(sessionId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(keyFor(sessionId))) === '1';
  } catch {
    return false;
  }
}

export async function markOrderConfettiPlayed(sessionId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(sessionId), '1');
  } catch {
    // Non-fatal: worst case the celebration replays once more.
  }
}
