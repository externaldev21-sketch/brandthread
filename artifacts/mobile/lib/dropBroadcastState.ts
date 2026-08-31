export type DropBroadcastState = 'idle' | 'loading' | 'sent' | 'already_sent';

type DropBroadcastRecord = {
  id: string;
  broadcastSentAt?: unknown;
};

export function getInitialDropBroadcastStates(
  drops: DropBroadcastRecord[],
): Record<string, DropBroadcastState> {
  return drops.reduce<Record<string, DropBroadcastState>>((states, drop) => {
    if (drop.broadcastSentAt != null) {
      states[drop.id] = 'already_sent';
    }
    return states;
  }, {});
}