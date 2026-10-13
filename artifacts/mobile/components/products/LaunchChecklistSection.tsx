/**
 * Launch checklist — the readiness card in the launch editor. Copies Shopify
 * iOS "Get ready to sell" setup guide: one card, a progress line, then one
 * row per task with a dashed circle (open) or a filled check (done) and a
 * chevron that opens the screen that finishes it. Required tasks carry a
 * "Required" tag; everything else is advice.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { useColors } from '@/hooks/useColors';
import { hapticLight } from '@/lib/haptics';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { launchCheckRoute, launchCheckTitle, type ProductLaunchChecklist } from '@/lib/productLaunchChecklist';

export function LaunchChecklistSection({
  checklist, productId, onOpen,
}: {
  checklist: ProductLaunchChecklist;
  productId: string;
  onOpen: (route: string) => void;
}) {
  const colors = useColors();
  const pct = checklist.total > 0 ? (checklist.readyCount / checklist.total) * 100 : 0;
  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]} testID="launch-checklist">
      <View style={s.head}>
        <Text style={[s.headText, { color: colors.foreground }]}>{checklist.readyCount} of {checklist.total} ready</Text>
        <View style={[s.track, { backgroundColor: colors.border }]}>
          <View style={[s.fill, { width: `${pct}%`, backgroundColor: colors.primary }]} />
        </View>
      </View>
      {checklist.items.map((item) => {
        const route = item.done ? null : launchCheckRoute(item.id, productId);
        const title = launchCheckTitle(item.id, checklist.followerCount);
        const body = (
          <>
            <View style={[s.check, item.done
              ? { backgroundColor: colors.primary }
              : { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.mutedForeground }]}
            >
              {item.done && <Feather name="check" size={ICON.xs} color={colors.primaryForeground} />}
            </View>
            <Text style={[s.title, { color: item.done ? colors.mutedForeground : colors.foreground }]} numberOfLines={2}>{title}</Text>
            {item.blocking && (
              <View style={[s.tag, { borderColor: colors.border }]}>
                <Text style={[s.tagText, { color: colors.foreground }]}>Required</Text>
              </View>
            )}
            {route && <Feather name="chevron-right" size={ICON.sm} color={colors.mutedForeground} />}
          </>
        );
        return (
          <View key={item.id} style={[s.rowWrap, { borderTopColor: colors.border }]}>
            {route ? (
              <PressableScale
                style={s.row}
                onPress={() => { hapticLight(); onOpen(route); }}
                accessibilityRole="button"
                accessibilityLabel={`${title}${item.blocking ? ', required' : ''}`}
              >
                {body}
              </PressableScale>
            ) : (
              <View style={s.row} accessibilityLabel={`${title}${item.done ? ', done' : ''}`}>{body}</View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: RADIUS.lg, overflow: 'hidden' },
  head: { paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: 12, gap: SP.sm },
  headText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  track: { height: 6, borderRadius: RADIUS.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: RADIUS.pill },
  rowWrap: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: SP.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  check: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm },
  tag: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 2 },
  tagText: { fontFamily: FONT.semibold, fontSize: FS.xs },
});
