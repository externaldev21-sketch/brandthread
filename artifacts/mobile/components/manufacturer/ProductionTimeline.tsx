/**
 * Six-stage production tracker (payment received → delivered) with the time
 * each stage was reached, shown in the viewer's time zone with a GMT offset.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { formatTimestamp } from '@workspace/manufacturer-flow';
import { BORDER, CARD_ELEVATED, FG, FONT, FS, MUTED, SP, SUBTLE, SUCCESS } from '@/lib/theme';
import type { TimelineStep } from '@/services/manufacturerOrderFlow';

export default function ProductionTimeline({
  steps, awaitingPayment, cancelled,
}: { steps: TimelineStep[]; awaitingPayment?: boolean; cancelled?: boolean }) {
  return (
    <View testID="production-timeline">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const done = step.state === 'done';
        const current = step.state === 'current';
        return (
          <View key={step.stage} style={styles.row} testID={`timeline-step-${step.stage}`}>
            <View style={styles.rail}>
              <View style={[styles.dot, done && styles.dotDone, current && styles.dotCurrent]}>
                {done ? <Feather name="check" size={13} color="#0A0A0B" /> : current ? <View style={styles.pulse} /> : <Text style={styles.dotText}>{index + 1}</Text>}
              </View>
              {!last && <View style={[styles.line, done && styles.lineDone]} />}
            </View>
            <View style={[styles.body, !last && { paddingBottom: SP.md }]}>
              <View style={styles.titleRow}>
                <Text style={[styles.label, step.state === 'upcoming' && { color: MUTED }]}>{step.label}</Text>
                {step.at ? <Text style={styles.time}>{formatTimestamp(step.at)}</Text> : null}
              </View>
              <Text style={styles.desc}>
                {index === 0 && awaitingPayment
                  ? 'Waiting for your payment. Production starts right after.'
                  : index === 0 && cancelled ? 'Closed before payment.' : step.description}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: SP.sm + 4 },
  rail: { alignItems: 'center', width: 26 },
  dot: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER,
  },
  dotDone: { backgroundColor: SUCCESS, borderColor: SUCCESS },
  dotCurrent: { borderColor: FG, borderWidth: 2 },
  pulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: FG },
  dotText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: SUBTLE },
  line: { flex: 1, width: 2, backgroundColor: BORDER, marginVertical: 2 },
  lineDone: { backgroundColor: SUCCESS },
  body: { flex: 1, paddingTop: 3 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: SP.sm, flexWrap: 'wrap' },
  label: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  time: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  desc: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 2, lineHeight: 18 },
});
