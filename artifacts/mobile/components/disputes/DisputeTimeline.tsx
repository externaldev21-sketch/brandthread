import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP } from '@/lib/theme';
import { useApi } from '@/lib/api';
import { RetryRow } from '@/components/ui/RetryRow';
import type { DisputeTimelineStep } from '@/lib/disputeTypes';
import { demoSteps, shortDateTime } from './disputeUi';

interface Props {
  disputeId: string;
  /** Used only for the signed-out &demo=1 preview, where no API is called. */
  demo?: { status: string; createdAt: string; evidenceDeadline: string | null };
  /** Bump to refetch after the parent changed the dispute. */
  refreshKey?: number;
}

/**
 * Vertical status steps in the Stripe-dashboard style:
 * Opened, Evidence due, Submitted, Under review, Won / Lost.
 */
export function DisputeTimeline({ disputeId, demo, refreshKey = 0 }: Props) {
  const colors = useColors();
  const api = useApi();
  const [steps, setSteps] = useState<DisputeTimelineStep[] | null>(
    demo ? demoSteps(demo.status, demo.createdAt, demo.evidenceDeadline) : null,
  );
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (demo) {
      setSteps(demoSteps(demo.status, demo.createdAt, demo.evidenceDeadline));
      return;
    }
    setFailed(false);
    try {
      const t = await api.disputes.timeline(disputeId);
      setSteps(t.steps);
    } catch {
      setFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disputeId, demo?.status, demo?.createdAt, demo?.evidenceDeadline]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  return (
    <View>
      <Text style={[styles.heading, { color: colors.foreground }]}>Status</Text>
      {failed && !steps ? (
        <RetryRow label="Couldn't load status" onRetry={() => void load()} />
      ) : !steps ? (
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>Loading…</Text>
      ) : (
        <View testID="dispute-timeline-card" style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {steps.map((step, i) => {
            const last = i === steps.length - 1;
            const done = step.state === 'done';
            const current = step.state === 'current';
            const skipped = step.state === 'skipped';
            const subtitle = step.detail ?? (done && step.at ? shortDateTime(step.at) : null);
            return (
              <View key={step.key} style={styles.row} testID={`dispute-step-${step.key}`}>
                <View style={styles.rail}>
                  <View
                    style={[
                      styles.dot,
                      done && { backgroundColor: colors.foreground, borderColor: colors.foreground },
                      current && { borderColor: colors.foreground, borderWidth: 2 },
                      !done && !current && { borderColor: colors.border },
                    ]}
                  >
                    {done ? <Feather name="check" size={10} color={colors.background} /> : null}
                    {current ? <View style={[styles.innerDot, { backgroundColor: colors.foreground }]} /> : null}
                  </View>
                  {!last ? (
                    <View style={[styles.line, { backgroundColor: done ? colors.foreground : colors.border }]} />
                  ) : null}
                </View>
                <View style={[styles.body, last && { paddingBottom: 0 }]}>
                  <Text
                    style={[
                      styles.label,
                      { color: done || current ? colors.foreground : colors.mutedForeground },
                      current && { fontFamily: FONT.semibold },
                      skipped && { textDecorationLine: 'line-through' },
                    ]}
                  >
                    {step.label}
                  </Text>
                  {subtitle ? (
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>{subtitle}</Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const DOT = 18;

const styles = StyleSheet.create({
  heading: { fontSize: FS.base, fontFamily: FONT.semibold, marginBottom: SP.sm },
  card: { borderRadius: 12, borderWidth: 1, paddingHorizontal: SP.md, paddingVertical: SP.md },
  row: { flexDirection: 'row', gap: SP.md },
  rail: { alignItems: 'center', width: DOT },
  dot: {
    width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  innerDot: { width: 6, height: 6, borderRadius: 3 },
  line: { width: 2, flex: 1, marginVertical: 2, minHeight: 18 },
  body: { flex: 1, paddingBottom: SP.md, gap: 2 },
  label: { fontSize: FS.base, fontFamily: FONT.medium },
  meta: { fontSize: FS.sm, fontFamily: FONT.regular },
});
