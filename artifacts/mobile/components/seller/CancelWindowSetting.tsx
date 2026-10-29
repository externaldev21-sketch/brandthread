/**
 * Item 129: the seller picks how long buyers can cancel an order themselves
 * (GET/PUT /api/seller/cancel-window). An iOS Settings-style picker list on
 * the Store policies screen; a tap saves right away and reverts on failure.
 * "Until shipped" is the platform default (up to day 21).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { CANCEL_WINDOW_OPTIONS, type CancelWindowHours } from '@/lib/cancelWindow';
import { hapticError, hapticSelection } from '@/lib/haptics';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';

export function CancelWindowSetting() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const api = useApi();
  const [hours, setHours] = useState<CancelWindowHours | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // The last value the server confirmed, and which save is the latest: an
  // older save failing after a newer one was sent must not undo the newer one.
  const savedRef = useRef<CancelWindowHours | undefined>(undefined);
  const saveSeqRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    let alive = true;
    api.seller.getCancelWindow()
      .then(res => {
        if (!alive) return;
        savedRef.current = (res?.hours ?? null) as CancelWindowHours;
        setHours(savedRef.current);
      })
      // Unknown is not "Until shipped": keep the choices unselected and say why.
      .catch(() => { if (alive) setError('Couldn’t load your cancellation window. Leave and reopen this screen to try again.'); });
    return () => { alive = false; };
  }, [api]);

  function choose(next: CancelWindowHours) {
    if (hours === undefined || next === hours) return;
    hapticSelection();
    const seq = ++saveSeqRef.current;
    setHours(next);
    setError(null);
    api.seller.setCancelWindow(next).then(() => {
      savedRef.current = next;
    }, () => {
      if (!mountedRef.current || seq !== saveSeqRef.current) return;
      hapticError();
      setHours(savedRef.current);
      setError('Couldn’t save. Check your connection and try again.');
    });
  }

  return (
    <View testID="cancel-window-setting">
      <Text style={s.title}>Buyers can cancel</Text>
      <View style={s.card}>
        {CANCEL_WINDOW_OPTIONS.map((option, i) => {
          const selected = hours !== undefined && option.hours === hours;
          return (
            <PressableScale
              key={option.label}
              onPress={() => choose(option.hours)}
              disabled={hours === undefined}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: hours === undefined }}
              accessibilityLabel={option.label}
              style={[s.row, i < CANCEL_WINDOW_OPTIONS.length - 1 && s.rowBorder]}
              testID={`cancel-window-${option.hours ?? 'shipped'}`}
            >
              <Text style={[s.label, selected && s.labelSelected]}>{option.label}</Text>
              {selected ? <Feather name="check" size={ICON.sm} color={theme.text} /> : null}
            </PressableScale>
          );
        })}
      </View>
      {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
      <Text style={s.footnote}>After this, buyers message you to cancel. Orders that have shipped can’t be cancelled.</Text>
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  title: { fontFamily: FONT.semibold, fontSize: FS.sm, letterSpacing: 0.4, textTransform: 'uppercase', color: theme.muted, marginBottom: SP.sm },
  card: { backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: RADIUS.lg, overflow: 'hidden' },
  row: { minHeight: 52, paddingHorizontal: SP.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
  label: { fontFamily: FONT.medium, fontSize: FS.base, color: theme.text },
  labelSelected: { fontFamily: FONT.semibold },
  error: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.text, marginTop: SP.sm },
  footnote: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, lineHeight: 18, marginTop: SP.sm },
});
