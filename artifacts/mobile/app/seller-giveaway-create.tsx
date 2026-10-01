/** Create a giveaway: prize, winners, length, entry post, region, editable rules. */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { ListRow } from '@/components/ui/ListRow';
import { OptionSheet } from '@/components/ui/OptionSheet';
import { ChipGroup } from '@/components/ui';
import { FONT, FS, SP } from '@/lib/theme';

const DURATIONS = [{ id: '3', label: '3 days' }, { id: '7', label: '7 days' }, { id: '14', label: '14 days' }, { id: '30', label: '30 days' }];
const WINNERS = [{ id: '1', label: '1' }, { id: '2', label: '2' }, { id: '3', label: '3' }, { id: '5', label: '5' }, { id: '10', label: '10' }];

export default function SellerGiveawayCreate() {
  const api = useApi();
  const router = useRouter();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [prize, setPrize] = useState('');
  const [winners, setWinners] = useState('1');
  const [days, setDays] = useState('7');
  const [region, setRegion] = useState('');
  const [eligibility, setEligibility] = useState('');
  const [rules, setRules] = useState('');
  const [rulesEdited, setRulesEdited] = useState(false);
  const [posts, setPosts] = useState<any[]>([]);
  const [post, setPost] = useState<{ id: string; label: string } | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [product, setProduct] = useState<{ id: string; label: string } | null>(null);
  const [sheet, setSheet] = useState<null | 'post' | 'product'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.sellerGiveaways.myPosts().then((p) => setPosts(Array.isArray(p) ? p.filter((x: any) => (x.postStatus ?? x.status) === 'published') : [])).catch(() => {});
    api.products.list().then((p: any) => setProducts(Array.isArray(p) ? p.filter((x: any) => x.status === 'active') : [])).catch(() => {});
  }, [api]);

  // Keep the template in sync with the fields until the seller edits the rules by hand.
  useEffect(() => {
    if (rulesEdited) return;
    const start = new Date();
    const end = new Date(Date.now() + Number(days) * 86_400_000);
    const q = new URLSearchParams({
      prizeText: prize, startsAt: start.toISOString(), endsAt: end.toISOString(), winnerCount: winners,
      region, eligibility, postEntry: post ? '1' : '0',
    }).toString();
    const t = setTimeout(() => { api.sellerGiveaways.rulesTemplate(q).then((r) => setRules(r.rulesText)).catch(() => {}); }, 300);
    return () => clearTimeout(t);
  }, [api, prize, winners, days, region, eligibility, post, rulesEdited]);

  const valid = title.trim() && prize.trim() && rules.trim();

  async function submit() {
    setBusy(true); setError(null);
    try {
      const g = await api.sellerGiveaways.create({
        title: title.trim(), prizeText: prize.trim(), winnerCount: Number(winners),
        startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + Number(days) * 86_400_000).toISOString(),
        postId: post?.id ?? null, productId: product?.id ?? null, region, eligibility, rulesText: rules,
      });
      router.replace(`/seller-giveaway-detail?id=${encodeURIComponent(g.id)}` as never);
    } catch (e: any) {
      setError(e?.message || 'Could not create the giveaway.');
    } finally { setBusy(false); }
  }

  const field = (label: string, value: string, set: (v: string) => void, opts: { multiline?: boolean; placeholder?: string; onEdit?: () => void } = {}) => (
    <>
      <Text style={[styles.label, { color: c.mutedForeground }]}>{label}</Text>
      <TextInput value={value} onChangeText={(t) => { set(t); opts.onEdit?.(); }} multiline={opts.multiline} placeholder={opts.placeholder} placeholderTextColor={c.mutedForeground}
        style={[styles.input, opts.multiline && styles.multiline, { color: c.foreground, borderColor: c.border }]} accessibilityLabel={label} />
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="New giveaway" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 140 }} keyboardShouldPersistTaps="handled">
          {field('Title', title, setTitle, { placeholder: 'Win the black jacket' })}
          {field('Prize', prize, setPrize, { placeholder: 'The Nord jacket, any size' })}
          <ListRow icon="shopping-bag" title="Prize product" value={product?.label ?? 'None'} chevron onPress={() => setSheet('product')} />
          <Text style={[styles.label, { color: c.mutedForeground }]}>Winners</Text>
          <ChipGroup options={WINNERS} selectedIds={[winners]} onChange={(ids: string[]) => ids[0] && setWinners(ids[0])} />
          <Text style={[styles.label, { color: c.mutedForeground }]}>Runs for</Text>
          <ChipGroup options={DURATIONS} selectedIds={[days]} onChange={(ids: string[]) => ids[0] && setDays(ids[0])} />
          <Text style={[styles.label, { color: c.mutedForeground }]}>How people enter</Text>
          <Text style={[styles.note, { color: c.mutedForeground }]}>They follow you and, if you pick a post, comment on it.</Text>
          <ListRow icon="message-circle" title="Entry post" value={post?.label ?? 'Follow only'} chevron onPress={() => setSheet('post')} />
          {field('Region', region, setRegion, { placeholder: 'United States' })}
          {field('Eligibility', eligibility, setEligibility, { placeholder: 'Open to people aged 18 or older' })}
          {field('Official rules', rules, setRules, { multiline: true, onEdit: () => setRulesEdited(true) })}
          {rulesEdited ? <Button label="Reset rules to template" variant="tertiary" onPress={() => setRulesEdited(false)} /> : null}
          {error ? <Text style={[styles.error, { color: c.destructive }]}>{error}</Text> : null}
          <View style={{ height: SP.lg }} />
          <Button label="Start giveaway" fullWidth loading={busy} disabled={!valid} onPress={submit} />
        </ScrollView>
      </KeyboardAvoidingView>
      <OptionSheet visible={sheet === 'post'} onClose={() => setSheet(null)} title="Entry post"
        options={[{ id: 'none', label: 'Follow only' }, ...posts.slice(0, 20).map((p) => ({ id: p.id, label: (p.caption || 'Untitled post').slice(0, 48) }))]}
        selectedId={post?.id ?? 'none'}
        onSelect={(id) => { const p = posts.find((x) => x.id === id); setPost(p ? { id: p.id, label: (p.caption || 'Untitled post').slice(0, 24) } : null); setSheet(null); }} />
      <OptionSheet visible={sheet === 'product'} onClose={() => setSheet(null)} title="Prize product"
        options={[{ id: 'none', label: 'None' }, ...products.slice(0, 20).map((p) => ({ id: p.id, label: p.name }))]}
        selectedId={product?.id ?? 'none'}
        onSelect={(id) => { const p = products.find((x) => x.id === id); setProduct(p ? { id: p.id, label: p.name } : null); setSheet(null); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: FS.xs, fontFamily: FONT.medium, marginTop: SP.md, marginBottom: 6 },
  note: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: FS.base, fontFamily: FONT.regular },
  multiline: { minHeight: 200, textAlignVertical: 'top' },
  error: { fontSize: FS.sm, fontFamily: FONT.medium, marginTop: SP.md },
});
