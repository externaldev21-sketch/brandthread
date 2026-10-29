/**
 * Create a giveaway: prize, winners, length, entry post, region, editable rules.
 * With `?id=` the same form edits an existing open giveaway (prefilled, PATCH);
 * see lib/giveawayEditForm.ts for the edit rules.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { ListRow } from '@/components/ui/ListRow';
import { OptionRadio } from '@/components/ui/OptionSheet';
import { Sheet, SHEET_GUTTER } from '@/components/ui/BottomSheet';
import { RetryRow } from '@/components/ui/RetryRow';
import { ChipGroup } from '@/components/ui';
import { FONT, FS, SP } from '@/lib/theme';
import { minHitSlop } from '@/lib/hitSlop';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { friendlyError } from '@/lib/friendlyError';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { GIVEAWAY_LIMITS, giveawayFormError } from '@/lib/giveawayFormValidation';
import {
  availableDurations, buildGiveawayPatch, canEditGiveaway, formFromGiveaway, isStartLocked, withCurrentOption,
  type ServerGiveaway,
} from '@/lib/giveawayEditForm';

const DURATIONS = [{ id: '3', label: '3 days' }, { id: '7', label: '7 days' }, { id: '14', label: '14 days' }, { id: '30', label: '30 days' }];
/** Shortens a caption for a one-line label, with an ellipsis when it was cut. */
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// Posts are fetched a page at a time for the Entry post picker.
const POSTS_PAGE = 50;
// The narrowest winners chip ("1") draws about 32×34pt; pad it to 44×44.
const WINNER_CHIP_HIT_SLOP = minHitSlop({ width: 32, height: 34 });

/**
 * Radio-list picker with a search field, for the prize product and entry
 * post lists (which can be long). Same rows as OptionSheet.
 */
function SearchPickerSheet({ visible, onClose, title, noneLabel, options, selectedId, onSelect, onLoadMore, loadingMore, testID }: {
  visible: boolean; onClose: () => void; title: string; noneLabel: string;
  options: { id: string; label: string }[]; selectedId: string; onSelect: (id: string) => void;
  onLoadMore?: () => void; loadingMore?: boolean; testID: string;
}) {
  const c = useColors();
  const [query, setQuery] = useState('');
  useEffect(() => { if (!visible) setQuery(''); }, [visible]);
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const rows = q ? shown : [{ id: 'none', label: noneLabel }, ...shown];
  return (
    <Sheet visible={visible} onClose={onClose} title={title} padded={false} testID={testID}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search"
        placeholderTextColor={c.mutedForeground}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityLabel={`Search ${title.toLowerCase()}`}
        style={[styles.input, styles.search, { color: c.foreground, borderColor: c.border }, WEB_INPUT_RESET]}
      />
      <View style={{ paddingHorizontal: SHEET_GUTTER }}>
        {rows.map((opt) => (
          <ListRow key={opt.id} title={opt.label} selected={opt.id === selectedId}
            right={<OptionRadio selected={opt.id === selectedId} color={c.foreground} />}
            onPress={() => onSelect(opt.id)} testID={`${testID}-${opt.id}`} />
        ))}
        {q && shown.length === 0 ? (
          <Text style={[styles.note, { color: c.mutedForeground, paddingVertical: SP.md }]}>Nothing matches "{query.trim()}".</Text>
        ) : null}
        {onLoadMore ? <Button label="Load more" variant="tertiary" loading={loadingMore} onPress={onLoadMore} /> : null}
      </View>
    </Sheet>
  );
}

const WINNERS = [{ id: '1', label: '1' }, { id: '2', label: '2' }, { id: '3', label: '3' }, { id: '5', label: '5' }, { id: '10', label: '10' }];

export default function SellerGiveawayCreate() {
  const api = useApi();
  const router = useRouter();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const editId = typeof params.id === 'string' && params.id ? params.id : null;
  const [original, setOriginal] = useState<ServerGiveaway | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'failed' | 'locked'>(editId ? 'loading' : 'idle');
  const [title, setTitle] = useState('');
  const [prize, setPrize] = useState('');
  const [winners, setWinners] = useState('1');
  const [days, setDays] = useState('7');
  const [region, setRegion] = useState('');
  const [eligibility, setEligibility] = useState('');
  const [rules, setRules] = useState('');
  const [rulesEdited, setRulesEdited] = useState(false);
  const [posts, setPosts] = useState<any[]>([]);
  // Raw /posts/mine rows fetched so far (drafts included) and whether the
  // last page was full, so the picker can offer "Load more".
  const [postsFetched, setPostsFetched] = useState(0);
  const [postsHasMore, setPostsHasMore] = useState(false);
  const [postsLoadingMore, setPostsLoadingMore] = useState(false);
  const [post, setPost] = useState<{ id: string; label: string } | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [product, setProduct] = useState<{ id: string; label: string } | null>(null);
  const [sheet, setSheet] = useState<null | 'post' | 'product'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateFailed, setTemplateFailed] = useState(false);
  const [templateAttempt, setTemplateAttempt] = useState(0);

  // Edit mode: prefill from the server. Rules count as hand-edited so the
  // template never overwrites the seller's saved text.
  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    setLoadState('loading');
    api.sellerGiveaways.get(editId).then((g: ServerGiveaway) => {
      if (cancelled) return;
      if (!canEditGiveaway(g)) { setLoadState('locked'); return; }
      const f = formFromGiveaway(g);
      setOriginal(g);
      setTitle(f.title); setPrize(f.prize); setWinners(f.winners); setDays(f.days);
      setRegion(f.region); setEligibility(f.eligibility); setRules(f.rules); setRulesEdited(true);
      setPost(f.postId ? { id: f.postId, label: 'Selected post' } : null);
      setProduct(f.productId ? { id: f.productId, label: 'Selected product' } : null);
      setLoadState('idle');
    }).catch(() => { if (!cancelled) setLoadState('failed'); });
    return () => { cancelled = true; };
  }, [api, editId]);

  // Swap the placeholder labels for the real post caption / product name once loaded.
  useEffect(() => {
    if (!post || post.label !== 'Selected post') return;
    const p = posts.find((x) => x.id === post.id);
    if (p) setPost({ id: p.id, label: (p.caption || 'Untitled post').slice(0, 24) });
  }, [posts, post]);
  useEffect(() => {
    if (!product || product.label !== 'Selected product') return;
    const p = products.find((x) => x.id === product.id);
    if (p) setProduct({ id: p.id, label: p.name });
  }, [products, product]);

  const isPublished = (x: any) => (x.postStatus ?? x.status) === 'published';
  async function loadPosts(offset: number) {
    const page = await api.sellerGiveaways.myPosts(POSTS_PAGE, offset);
    const rows = Array.isArray(page) ? page : [];
    setPosts((prev) => {
      const seen = new Set(prev.map((x) => x.id));
      return [...(offset ? prev : []), ...rows.filter((x: any) => isPublished(x) && !seen.has(x.id))];
    });
    setPostsFetched(offset + rows.length);
    setPostsHasMore(rows.length === POSTS_PAGE);
  }
  async function loadMorePosts() {
    setPostsLoadingMore(true);
    try { await loadPosts(postsFetched); } catch { /* keep what's listed; Load more stays */ } finally { setPostsLoadingMore(false); }
  }

  useEffect(() => {
    loadPosts(0).catch(() => {});
    api.products.list().then((p: any) => setProducts(Array.isArray(p) ? p.filter((x: any) => x.status === 'active') : [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const t = setTimeout(() => {
      api.sellerGiveaways.rulesTemplate(q)
        .then((r) => { setRules(r.rulesText); setTemplateFailed(false); })
        // Without the template the rules stay empty and the form can't start,
        // so offer a retry (or the seller can type rules by hand).
        .catch(() => setTemplateFailed(true));
    }, 300);
    return () => clearTimeout(t);
  }, [api, prize, winners, days, region, eligibility, post, rulesEdited, templateAttempt]);

  const complete = !!(title.trim() && prize.trim() && rules.trim());
  const formError = giveawayFormError(
    { title, prize, winners, days, region, eligibility, rules },
    { startsAt: original?.startsAt ?? null },
  );
  const valid = complete && !formError;

  // Unsaved-changes guard. The auto-filled rules template isn't a seller
  // edit, so rules only count once edited by hand. `leaveTo` is set after a
  // save lands; navigating from an effect lets the guard see dirty=false first.
  const snapshot = JSON.stringify([title, prize, winners, days, region, eligibility, rulesEdited ? rules : '', post?.id ?? null, product?.id ?? null]);
  const baseline = useRef<string | null>(null);
  useEffect(() => {
    if (loadState === 'idle' && baseline.current === null) baseline.current = snapshot;
  }, [loadState, snapshot]);
  const [leaveTo, setLeaveTo] = useState<null | { href: string; replace: boolean }>(null);
  const dirty = !leaveTo && baseline.current !== null && snapshot !== baseline.current;
  const onBack = useUnsavedChangesGuard(dirty);
  useEffect(() => {
    if (!leaveTo) return;
    if (leaveTo.replace) router.replace(leaveTo.href as never);
    else goBackOr(router, leaveTo.href as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaveTo]);

  const postLocked = !!original && isStartLocked(original);
  const winnerOptions = withCurrentOption(WINNERS, winners, (id) => id);
  const durationOptions = original
    ? availableDurations(withCurrentOption(DURATIONS, days, (id) => `${id} ${id === '1' ? 'day' : 'days'}`), original.startsAt)
    : DURATIONS;

  async function submit() {
    setBusy(true); setError(null);
    try {
      if (original) {
        await api.sellerGiveaways.update(original.id, buildGiveawayPatch(original, {
          title, prize, winners, days, region, eligibility, rules, postId: post?.id ?? null, productId: product?.id ?? null,
        }));
        // Back to the detail screen, which reloads on focus.
        setLeaveTo({ href: `/seller-giveaway-detail?id=${encodeURIComponent(original.id)}`, replace: false });
        return;
      }
      const g = await api.sellerGiveaways.create({
        title: title.trim(), prizeText: prize.trim(), winnerCount: Number(winners),
        startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + Number(days) * 86_400_000).toISOString(),
        postId: post?.id ?? null, productId: product?.id ?? null, region, eligibility, rulesText: rules,
      });
      setLeaveTo({ href: `/seller-giveaway-detail?id=${encodeURIComponent(g.id)}`, replace: true });
    } catch (e: any) {
      setError(friendlyError(e, original ? 'Could not save the giveaway.' : 'Could not create the giveaway.'));
    } finally { setBusy(false); }
  }

  const field = (label: string, value: string, set: (v: string) => void, opts: { multiline?: boolean; placeholder?: string; onEdit?: () => void; maxLength?: number } = {}) => (
    <>
      <Text style={[styles.label, { color: c.mutedForeground }]}>{label}</Text>
      <TextInput value={value} onChangeText={(t) => { set(t); opts.onEdit?.(); }} multiline={opts.multiline} placeholder={opts.placeholder} placeholderTextColor={c.mutedForeground} maxLength={opts.maxLength}
        style={[styles.input, opts.multiline && styles.multiline, { color: c.foreground, borderColor: c.border }]} accessibilityLabel={label} />
    </>
  );

  if (editId && loadState !== 'idle') {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <ScreenHeader title="Edit giveaway" />
        {loadState === 'loading' ? <ActivityIndicator color={c.foreground} style={{ marginTop: 40 }} /> : (
          <Text style={[styles.note, { color: c.mutedForeground, padding: SP.md }]}>
            {loadState === 'locked' ? 'This giveaway has ended, so it can no longer be edited.' : "Couldn't load this giveaway."}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title={original ? 'Edit giveaway' : 'New giveaway'} onBack={onBack} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: SP.xl }} keyboardShouldPersistTaps="handled">
          {field('Title', title, setTitle, { placeholder: 'Win the black jacket', maxLength: GIVEAWAY_LIMITS.title })}
          {field('Prize', prize, setPrize, { placeholder: 'The Nord jacket, any size', maxLength: GIVEAWAY_LIMITS.prize })}
          <ListRow icon="shopping-bag" title="Prize product" value={product?.label ?? 'None'} chevron onPress={() => setSheet('product')} />
          <Text style={[styles.label, { color: c.mutedForeground }]}>Winners</Text>
          <ChipGroup options={winnerOptions} selectedIds={[winners]} onChange={(ids: string[]) => ids[0] && setWinners(ids[0])} chipHitSlop={WINNER_CHIP_HIT_SLOP} />
          <Text style={[styles.label, { color: c.mutedForeground }]}>Runs for</Text>
          <ChipGroup options={durationOptions} selectedIds={[days]} onChange={(ids: string[]) => ids[0] && setDays(ids[0])} />
          <Text style={[styles.label, { color: c.mutedForeground }]}>How people enter</Text>
          <Text style={[styles.note, { color: c.mutedForeground }]}>They follow you and, if you pick a post, comment on it.</Text>
          <ListRow icon="message-circle" title="Entry post" value={post?.label ?? 'Follow only'} chevron={!postLocked} onPress={postLocked ? undefined : () => setSheet('post')} />
          {postLocked ? <Text style={[styles.note, { color: c.mutedForeground }]}>The entry post can't change once the giveaway has started.</Text> : null}
          {field('Region', region, setRegion, { placeholder: 'e.g. United States', maxLength: GIVEAWAY_LIMITS.region })}
          {field('Eligibility', eligibility, setEligibility, { placeholder: 'e.g. Open to people aged 18 or older', maxLength: GIVEAWAY_LIMITS.eligibility })}
          {field('Official rules', rules, setRules, { multiline: true, onEdit: () => setRulesEdited(true), maxLength: GIVEAWAY_LIMITS.rules })}
          {templateFailed && !rulesEdited && !rules.trim()
            ? <RetryRow label="Couldn't load the rules template" style={{ marginTop: SP.sm }} onRetry={() => { setTemplateFailed(false); setTemplateAttempt((n) => n + 1); }} />
            : null}
          {rulesEdited ? <Button label="Reset rules to template" variant="tertiary" onPress={() => setRulesEdited(false)} /> : null}
          {error ? <Text style={[styles.error, { color: c.destructive }]}>{error}</Text> : null}
          {!complete ? <Text style={[styles.note, { color: c.mutedForeground, marginTop: SP.md }]}>Add a title, a prize and the official rules to start.</Text>
            : formError ? <Text style={[styles.note, { color: c.mutedForeground, marginTop: SP.md }]}>{formError}</Text> : null}
          <View style={{ height: SP.lg }} />
          <Button label={original ? 'Save changes' : 'Start giveaway'} fullWidth loading={busy} disabled={!valid} onPress={submit} />
        </ScrollView>
      </KeyboardAvoidingView>
      <SearchPickerSheet visible={sheet === 'post'} onClose={() => setSheet(null)} title="Entry post" noneLabel="Follow only"
        options={posts.map((p) => ({ id: p.id, label: clip(p.caption || 'Untitled post', 48) }))}
        selectedId={post?.id ?? 'none'}
        onLoadMore={postsHasMore ? loadMorePosts : undefined} loadingMore={postsLoadingMore}
        testID="giveaway-post-sheet"
        onSelect={(id) => { const p = posts.find((x) => x.id === id); setPost(p ? { id: p.id, label: clip(p.caption || 'Untitled post', 24) } : null); setSheet(null); }} />
      <SearchPickerSheet visible={sheet === 'product'} onClose={() => setSheet(null)} title="Prize product" noneLabel="None"
        options={products.map((p) => ({ id: p.id, label: p.name }))}
        selectedId={product?.id ?? 'none'}
        testID="giveaway-product-sheet"
        onSelect={(id) => { const p = products.find((x) => x.id === id); setProduct(p ? { id: p.id, label: p.name } : null); setSheet(null); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: FS.meta, fontFamily: FONT.medium, marginTop: SP.md, marginBottom: 6 },
  note: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: FS.base, fontFamily: FONT.regular },
  multiline: { minHeight: 200, textAlignVertical: 'top' },
  search: { marginHorizontal: SHEET_GUTTER, marginBottom: SP.sm },
  error: { fontSize: FS.sm, fontFamily: FONT.medium, marginTop: SP.md },
});
