/**
 * Quiet hours as one picker row (value + chevron) that opens an option sheet,
 * instead of a wrapping chip group. Shared by the notification settings
 * screens; `onChange` receives the preset (or `off`) and persists it.
 */
import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { ListRow } from '@/components/ui/ListRow';
import { OptionSheet } from '@/components/ui/OptionSheet';

export interface QuietHoursPreset {
  id: string;
  label: string;
  start: string | null;
  end: string | null;
}

export const QUIET_HOURS_PRESETS: QuietHoursPreset[] = [
  { id: 'off', label: 'Off', start: null, end: null },
  { id: 'preset-21-06', label: '9 PM – 6 AM', start: '21:00', end: '06:00' },
  { id: 'preset-22-07', label: '10 PM – 7 AM', start: '22:00', end: '07:00' },
  { id: 'preset-23-08', label: '11 PM – 8 AM', start: '23:00', end: '08:00' },
];

export function quietHoursPresetFor(start: string | null, end: string | null): QuietHoursPreset {
  return QUIET_HOURS_PRESETS.find((p) => p.start === start && p.end === end) ?? QUIET_HOURS_PRESETS[0]!;
}

export function QuietHoursRow({
  start, end, onChange,
}: {
  start: string | null;
  end: string | null;
  onChange: (preset: QuietHoursPreset) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = quietHoursPresetFor(start, end);
  return (
    <>
      <Card>
        <ListRow
          icon="moon"
          title="Quiet hours"
          value={selected.label}
          chevron
          onPress={() => setOpen(true)}
          testID="quiet-hours-row"
        />
      </Card>
      <OptionSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Quiet hours"
        options={QUIET_HOURS_PRESETS.map(({ id, label }) => ({ id, label }))}
        selectedId={selected.id}
        onSelect={(id) => {
          setOpen(false);
          const preset = QUIET_HOURS_PRESETS.find((p) => p.id === id);
          if (preset) onChange(preset);
        }}
      />
    </>
  );
}
