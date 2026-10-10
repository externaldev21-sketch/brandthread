/**
 * Link in bio editor with live preview.
 * Mobbin reference: Linktree "Links" editor (link cards with drag handle,
 * title, url, toggle, Add pill) re-skinned to the Brandthread palette.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Alert, Share, StyleSheet } from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, RADIUS, SP, TEXT_DISABLED } from '@/lib/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PrimaryButton, SecondaryButton, PressableScale, HapticSwitch } from '@/components/BrandthreadUI';
import { ErrorState } from '@/components/ui/ErrorState';
import { AnalyticsSkeleton, Card, PillTabs, SectionTitle } from '@/components/analytics/AnalyticsKit';
import { Chip, CopyRow, Field } from '@/components/growth/GrowthUI';
import { normalizeUrlInput } from '@/lib/growthValidation';
import {
  addBioLink, deleteBioLink, getBio, getDestinations, patchBioLink, reorderBioLinks, saveBio,
  type BioLink, type BioPage, type GrowthDestinations,
} from '@/services/growthService';
import { crispPx } from '@/lib/crispPixel';

const SOCIAL_FIELDS = [
  { key: 'instagram', label: 'Instagram', placeholder: '@handle' },
  { key: 'tiktok', label: 'TikTok', placeholder: '@handle' },
  { key: 'youtube', label: 'YouTube', placeholder: 'youtube.com/@channel' },
  { key: 'x', label: 'X', placeholder: '@handle' },
  { key: 'facebook', label: 'Facebook', placeholder: 'facebook.com/page' },
  { key: 'website', label: 'Website', placeholder: 'yourbrand.com' },
  { key: 'email', label: 'Email', placeholder: 'hello@yourbrand.com' },
] as const;

export default function LinkInBioScreen() {
  const colors = useColors();
  const router = useRouter();
  const [page, setPage] = useState<BioPage | null>(null);
  const [dest, setDest] = useState<GrowthDestinations | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', url: '' });
  const [adding, setAdding] = useState(false);
  const scroll = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    try {
      const [p, d] = await Promise.all([getBio(), getDestinations().catch(() => null)]);
      setPage(p); setDest(d); setFailed(false); setDirty(false);
    } catch { setFailed(true); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const edit = (patch: Partial<BioPage>) => { setPage((p) => (p ? { ...p, ...patch } : p)); setDirty(true); };

  async function persist(extra: Partial<BioPage> = {}) {
    if (!page) return;
    const p = { ...page, ...extra };
    setSaving(true);
    try {
      const saved = await saveBio({
        displayName: p.displayName, bio: p.bio, avatarUrl: p.avatarUrl, showShopButton: p.showShopButton, shopButtonLabel: p.shopButtonLabel,
        featuredProductIds: p.featuredProductIds, socials: p.socials, theme: p.theme, accentColor: p.accentColor, published: p.published,
      });
      setPage(saved); setDirty(false);
    } catch (e: any) {
      Alert.alert("Couldn't save", String(e?.message ?? 'Check your entries and try again.').slice(0, 200));
    } finally { setSaving(false); }
  }

  async function ensureSaved(): Promise<boolean> {
    if (page?.exists) return true;
    await persist();
    return true;
  }

  async function toggleLink(l: BioLink, enabled: boolean) {
    setPage((p) => p && ({ ...p, links: p.links.map((x) => (x.id === l.id ? { ...x, enabled } : x)) }));
    try { await patchBioLink(l.id, { enabled }); } catch { load(); }
  }

  async function move(index: number, dir: -1 | 1) {
    if (!page) return;
    const links = [...page.links];
    const j = index + dir;
    if (j < 0 || j >= links.length) return;
    [links[index], links[j]] = [links[j], links[index]];
    setPage({ ...page, links });
    try { await reorderBioLinks(links.map((l) => l.id)); } catch { load(); }
  }

  async function submitLink() {
    const url = normalizeUrlInput(draft.url);
    if (!draft.title.trim() || !url) { Alert.alert('Add a title and a valid link', 'Use a web address, mailto: or tel: link.'); return; }
    try {
      await ensureSaved();
      if (editing && editing !== 'new') await patchBioLink(editing, { title: draft.title.trim(), url });
      else await addBioLink(draft.title.trim(), url);
      setEditing(null); setAdding(false); setDraft({ title: '', url: '' });
      await load();
    } catch (e: any) { Alert.alert("Couldn't save link", String(e?.message ?? '').slice(0, 160)); }
  }

  const removeLink = (l: BioLink) => Alert.alert('Delete this link?', l.title, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { try { await deleteBioLink(l.id); setEditing(null); await load(); } catch { Alert.alert("Couldn't delete link"); } } },
  ]);

  const header = (
    <ScreenHeader
      title="Link in bio"
      actions={[{ icon: 'bar-chart-2', onPress: () => router.push('/link-in-bio-stats' as never), accessibilityLabel: 'Link in bio stats' }]}
    />
  );
  if (failed && !page) return <View style={{ flex: 1 }}>{header}<ErrorState onRetry={load} /></View>;
  if (!page) return <View style={{ flex: 1 }}>{header}<AnalyticsSkeleton kpiCount={1} listRows={3} /></View>;

  const formOpen = adding || !!editing;

  return (
    <View style={{ flex: 1 }}>
      {header}
      <View style={{ paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: SP.sm }}>
        <PillTabs options={[{ key: 'edit', label: 'Edit' }, { key: 'preview', label: 'Preview' }]} value={tab} onChange={setTab} scroll={false} />
      </View>
      <ScrollView ref={scroll} contentContainerStyle={{ padding: SP.md, paddingBottom: 160 }} keyboardShouldPersistTaps="handled">
        {tab === 'preview' ? (
          <BioPreview page={page} products={dest?.products ?? []} />
        ) : (
          <>
            {page.url && (
              <View style={{ marginBottom: SP.lg }}>
                <CopyRow value={page.url} />
              </View>
            )}

            <View style={s.profileRow}>
              {page.avatarUrl
                ? <CachedImage source={{ uri: page.avatarUrl }} style={[s.avatar, { borderColor: colors.border }]} accessibilityLabel="Profile photo" />
                : <View style={[s.avatar, s.avatarPh, { backgroundColor: colors.secondary, borderColor: colors.border }]}><Feather name="user" size={28} color={colors.mutedForeground} /></View>}
              <View style={{ flex: 1 }}>
                <Field label="Name" value={page.displayName} onChangeText={(v) => edit({ displayName: v })} maxLength={60} />
              </View>
            </View>
            <Field label="Bio" value={page.bio} onChangeText={(v) => edit({ bio: v })} multiline maxLength={240} style={{ minHeight: 76, textAlignVertical: 'top' }} />
            {page.avatarUrl && <SecondaryButton small label="Remove photo" onPress={() => edit({ avatarUrl: null })} style={{ marginBottom: SP.lg }} />}

            <View style={s.linksHead}>
              <SectionTitle>Links</SectionTitle>
              <PressableScale
                onPress={() => { setEditing('new'); setAdding(true); setDraft({ title: '', url: '' }); }}
                accessibilityRole="button" accessibilityLabel="Add link"
                style={[s.addPill, { backgroundColor: colors.primary }]}
              >
                <Feather name="plus" size={16} color={colors.primaryForeground} />
                <Text style={{ color: colors.primaryForeground, fontFamily: FONT.semibold, fontSize: FS.sm }}>Add</Text>
              </PressableScale>
            </View>

            {formOpen && (
              <Card padded>
                <Field label="Title" value={draft.title} onChangeText={(v) => setDraft({ ...draft, title: v })} maxLength={80} placeholder="Spring lookbook" />
                <Field label="Link" value={draft.url} onChangeText={(v) => setDraft({ ...draft, url: v })} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="yourbrand.com/lookbook" />
                <PrimaryButton label={editing && editing !== 'new' ? 'Save link' : 'Add link'} onPress={submitLink} />
                <View style={{ height: SP.sm }} />
                <SecondaryButton label="Cancel" onPress={() => { setEditing(null); setAdding(false); }} />
              </Card>
            )}

            {page.links.length === 0 && !formOpen && (
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: FS.sm, marginBottom: SP.md }}>No links yet. Tap Add to create your first.</Text>
            )}
            {page.links.map((l, i) => (
              <Card key={l.id} style={{ marginBottom: SP.sm }}>
                <View style={s.linkRow}>
                  <View style={s.arrows}>
                    <PressableScale onPress={() => move(i, -1)} disabled={i === 0} accessibilityRole="button" accessibilityLabel={`Move ${l.title} up`} style={s.arrowBtn}>
                      <Feather name="chevron-up" size={18} color={i === 0 ? colors.subtle : colors.foreground} />
                    </PressableScale>
                    <PressableScale onPress={() => move(i, 1)} disabled={i === page.links.length - 1} accessibilityRole="button" accessibilityLabel={`Move ${l.title} down`} style={s.arrowBtn}>
                      <Feather name="chevron-down" size={18} color={i === page.links.length - 1 ? colors.subtle : colors.foreground} />
                    </PressableScale>
                  </View>
                  <PressableScale
                    style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel={`Edit ${l.title}`}
                    onPress={() => { setEditing(l.id); setAdding(false); setDraft({ title: l.title, url: l.url }); scroll.current?.scrollTo({ y: 0, animated: true }); }}
                  >
                    <Text style={[s.linkTitle, { color: l.enabled ? colors.foreground : TEXT_DISABLED }]} numberOfLines={1}>{l.title}</Text>
                    <Text style={[s.linkUrl, { color: l.enabled ? colors.mutedForeground : TEXT_DISABLED }]} numberOfLines={1}>{l.url}</Text>
                    <Text style={[s.linkUrl, { color: colors.subtle }]}>{l.clicks30 ?? 0} clicks, 30 days</Text>
                  </PressableScale>
                  <View style={s.linkSide}>
                    <HapticSwitch value={l.enabled} onValueChange={(v) => toggleLink(l, v)} accessibilityLabel={`Show ${l.title}`} />
                    <PressableScale onPress={() => removeLink(l)} accessibilityRole="button" accessibilityLabel={`Delete ${l.title}`} style={s.arrowBtn}>
                      <Feather name="trash-2" size={16} color={colors.mutedForeground} />
                    </PressableScale>
                  </View>
                </View>
              </Card>
            ))}

            <View style={{ height: SP.md }} />
            <SectionTitle>Store</SectionTitle>
            <Card padded>
              <ToggleLine label="Shop my store button" value={page.showShopButton} onChange={(v) => edit({ showShopButton: v })} />
              {page.showShopButton && <Field label="Button label" value={page.shopButtonLabel} onChangeText={(v) => edit({ shopButtonLabel: v })} maxLength={30} />}
              {!!dest?.products.length && (
                <>
                  <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>Featured products (up to 6)</Text>
                  <View style={s.wrap}>
                    {dest.products.slice(0, 30).map((p) => {
                      const on = page.featuredProductIds.includes(p.id);
                      return (
                        <Chip key={p.id} label={p.name} active={on} onPress={() => {
                          const ids = on ? page.featuredProductIds.filter((x) => x !== p.id) : [...page.featuredProductIds, p.id].slice(0, 6);
                          edit({ featuredProductIds: ids });
                        }} />
                      );
                    })}
                  </View>
                </>
              )}
            </Card>

            <SectionTitle>Social icons</SectionTitle>
            <Card padded>
              {SOCIAL_FIELDS.map((f) => (
                <Field
                  key={f.key} label={f.label} placeholder={f.placeholder} autoCapitalize="none" autoCorrect={false}
                  value={page.socials[f.key] ?? ''}
                  onChangeText={(v) => edit({ socials: { ...page.socials, [f.key]: v } })}
                />
              ))}
            </Card>

            <SectionTitle>Appearance</SectionTitle>
            <Card padded>
              <View style={s.wrap}>
                <Chip label="Light" active={page.theme === 'mono'} onPress={() => edit({ theme: 'mono' })} />
                <Chip label="Dark" active={page.theme === 'dark'} onPress={() => edit({ theme: 'dark' })} />
              </View>
              {!!page.storeAccentColor && (
                <View style={[s.wrap, { marginTop: SP.sm }]}>
                  <Chip label="Black and white" active={!page.accentColor} onPress={() => edit({ accentColor: null })} />
                  <Chip label="Use store color" active={page.accentColor === page.storeAccentColor} onPress={() => edit({ accentColor: page.storeAccentColor })} />
                </View>
              )}
              <View style={{ height: SP.md }} />
              <ToggleLine label="Page is live" value={page.published} onChange={(v) => edit({ published: v })} />
            </Card>

            <PrimaryButton label={page.exists ? 'Save changes' : 'Publish page'} onPress={() => persist()} loading={saving} disabled={saving || (page.exists && !dirty)} />
            {page.url && (
              <>
                <View style={{ height: SP.sm }} />
                <SecondaryButton label="Share page" icon="share-2" onPress={() => Share.share({ message: page.url!, url: page.url! }).catch(() => {})} />
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ToggleLine({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
      <Text style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: FS.base }}>{label}</Text>
      <HapticSwitch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

/** Live preview of the public page, rendered from the unsaved editor state (monochrome by default). */
function BioPreview({ page, products }: { page: BioPage; products: { id: string; name: string }[] }) {
  const colors = useColors();
  const dark = page.theme === 'dark';
  const bg = useMemo(() => (dark ? colors.background : colors.card), [dark, colors]);
  const fg = colors.foreground;
  const btn = page.accentColor ?? fg;
  const links = page.links.filter((l) => l.enabled);
  const featured = products.filter((p) => page.featuredProductIds.includes(p.id));
  return (
    <View style={[s.phone, { backgroundColor: bg, borderColor: colors.border }]} accessibilityLabel="Page preview">
      {page.avatarUrl
        ? <CachedImage source={{ uri: page.avatarUrl }} style={[s.pvAvatar, { borderColor: colors.border }]} />
        : <View style={[s.pvAvatar, s.avatarPh, { backgroundColor: colors.secondary, borderColor: colors.border }]}><Text style={{ color: fg, fontFamily: FONT.bold, fontSize: FS.xl }}>{(page.displayName || 'B').slice(0, 1).toUpperCase()}</Text></View>}
      <Text style={[s.pvName, { color: fg }]}>{page.displayName || 'Your name'}</Text>
      {!!page.bio && <Text style={[s.pvBio, { color: colors.mutedForeground }]}>{page.bio}</Text>}
      {page.showShopButton && (
        <View style={[s.pvBtn, { backgroundColor: btn, borderColor: btn }]}>
          <Text style={{ color: page.accentColor ? colors.primaryForeground : dark ? colors.background : colors.card, fontFamily: FONT.semibold }}>{page.shopButtonLabel || 'Shop my store'}</Text>
        </View>
      )}
      {featured.length > 0 && (
        <View style={s.pvGrid}>
          {featured.map((p) => (
            <View key={p.id} style={{ width: '48%' }}>
              <View style={[s.pvImg, { backgroundColor: colors.secondary }]} />
              <Text style={{ color: fg, fontFamily: FONT.semibold, fontSize: FS.sm, marginTop: 6 }} numberOfLines={1}>{p.name}</Text>
            </View>
          ))}
        </View>
      )}
      {links.map((l) => (
        <View key={l.id} style={[s.pvBtn, { borderColor: fg }]}>
          <Text style={{ color: fg, fontFamily: FONT.semibold }} numberOfLines={1}>{l.title}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  profileRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.md, marginBottom: SP.xs },
  avatar: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, marginTop: 26 },
  avatarPh: { alignItems: 'center', justifyContent: 'center' },
  linksHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.sm },
  addPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, minHeight: 40, borderRadius: RADIUS.pill, marginBottom: SP.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', padding: SP.sm, gap: SP.sm },
  arrows: { alignItems: 'center' },
  arrowBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  linkTitle: { fontSize: FS.base, fontFamily: FONT.bold },
  linkUrl: { fontSize: FS.meta, fontFamily: FONT.regular, marginTop: 1 },
  linkSide: { alignItems: 'center', gap: 2, width: 56 },
  fieldLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, marginBottom: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  phone: { borderWidth: 1, borderRadius: RADIUS.xl, padding: SP.lg, alignItems: 'center', minHeight: 420 },
  pvAvatar: { width: 84, height: 84, borderRadius: 42, borderWidth: 1, marginBottom: SP.sm },
  pvName: { fontSize: FS.xl, fontFamily: FONT.bold, textAlign: 'center' },
  pvBio: { fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', marginTop: 6, marginBottom: SP.md },
  pvBtn: { width: '100%', borderWidth: crispPx(1.5), borderRadius: 14, minHeight: 50, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.md, marginTop: SP.sm },
  pvGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, width: '100%', marginTop: SP.md, justifyContent: 'space-between' },
  pvImg: { width: '100%', aspectRatio: 4 / 5, borderRadius: 12 },
});
