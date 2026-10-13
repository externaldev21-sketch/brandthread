/**
 * Most active times — when the seller's followers are active over the last
 * 28 days, in the device timezone. Copies TikTok Studio Analytics "Most
 * active times": Hours / Days toggle, one summary sentence, then an hourly
 * chart with a day pager (Hours) or a weekday chart (Days). Hidden behind a
 * clear message until 20 followers have been active (k-anonymity, enforced
 * server-side). Data: GET /api/product-launches/best-time?tz=.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { AnalyticsBarChart, Card, PillTabs, SectionTitle } from '@/components/analytics/AnalyticsKit';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';
import { serviceRequest } from '@/lib/serviceConfig';
import { FONT, FS, ICON, SP } from '@/lib/theme';
import { previewMode } from '@/services/sellerInsightsService';
import {
  buildDemoBestTime, mostActiveSentence, weekdayLong, weekdayShort, type BestTimeResponse,
} from '@/lib/productLaunchChecklist';

type Mode = 'hours' | 'days';
const HOUR_TICKS = ['12a', '1a', '2a', '3a', '4a', '5a', '6a', '7a', '8a', '9a', '10a', '11a', '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '10p', '11p'];

function deviceZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

async function getMostActiveTimes(tz: string): Promise<BestTimeResponse | null> {
  const m = previewMode();
  if (m === 'demo') return buildDemoBestTime(tz);
  if (m === 'empty') return null;
  return serviceRequest<BestTimeResponse>(`/api/product-launches/best-time?tz=${encodeURIComponent(tz)}`, {}, false);
}

export function MostActiveTimesCard() {
  const colors = useColors();
  const [data, setData] = useState<BestTimeResponse | null>(null);
  const [mode, setMode] = useState<Mode>('hours');
  const [day, setDay] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    getMostActiveTimes(deviceZone())
      .then((r) => { if (live) setData(r); })
      .catch(() => { if (live) setData(null); });
    return () => { live = false; };
  }, []);

  // Nothing to show (preview without demo, or the request failed): the card stays out of the way.
  if (!data) return null;

  const top = data.status === 'ok' ? data.top[0] : undefined;
  const shownDay = day ?? top?.weekday ?? 0;

  return (
    <>
      <SectionTitle>Most active times</SectionTitle>
      <Card padded>
        {data.status !== 'ok' || !top ? (
          <Text style={[s.body, { color: colors.mutedForeground }]}>
            Not enough activity yet. This shows once {data.minActiveFollowers} followers have been active in the last {data.days} days.
          </Text>
        ) : (
          <View testID="most-active-times">
            <PillTabs<Mode>
              scroll={false}
              options={[{ key: 'hours', label: 'Hours' }, { key: 'days', label: 'Days' }]}
              value={mode}
              onChange={setMode}
            />
            <Text style={[s.sentence, { color: colors.foreground }]}>{mostActiveSentence(top, data.days)}</Text>
            {mode === 'hours' ? (
              <>
                <View style={s.pager}>
                  <PressableScale
                    onPress={() => { hapticSelection(); setDay((shownDay + 6) % 7); }}
                    accessibilityLabel="Previous day"
                    style={s.pagerBtn}
                  >
                    <Feather name="chevron-left" size={ICON.sm} color={colors.mutedForeground} />
                  </PressableScale>
                  <Text style={[s.pagerText, { color: colors.foreground }]} accessibilityLabel={weekdayLong(shownDay)}>{weekdayShort(shownDay)}</Text>
                  <PressableScale
                    onPress={() => { hapticSelection(); setDay((shownDay + 1) % 7); }}
                    accessibilityLabel="Next day"
                    style={s.pagerBtn}
                  >
                    <Feather name="chevron-right" size={ICON.sm} color={colors.mutedForeground} />
                  </PressableScale>
                </View>
                <AnalyticsBarChart
                  points={data.grid[shownDay].map((value, h) => ({ label: HOUR_TICKS[h], value }))}
                  emptyLabel={`No follower activity on ${weekdayLong(shownDay)}`}
                />
              </>
            ) : (
              <AnalyticsBarChart points={data.byWeekday.map((value, wd) => ({ label: weekdayShort(wd), value }))} />
            )}
          </View>
        )}
      </Card>
    </>
  );
}

const s = StyleSheet.create({
  body: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19 },
  sentence: { fontFamily: FONT.semibold, fontSize: FS.sm, lineHeight: 19, marginBottom: SP.md },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.md, marginBottom: SP.xs },
  pagerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pagerText: { fontFamily: FONT.semibold, fontSize: FS.sm, minWidth: 40, textAlign: 'center' },
});
