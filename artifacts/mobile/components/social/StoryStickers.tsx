/**
 * Interactive story stickers: poll, question, product link, drop countdown.
 *
 * One set of presentational cards used by the story editor canvas (mode
 * 'editor': inert previews) and the story viewer (mode 'viewer': tap to vote,
 * answer, open the product or the drop). Look follows Instagram's sticker cards
 * (Mobbin: Instagram story poll / question / countdown) reskinned in black,
 * white and silver: a solid paper card, ink text, silver option rows, no
 * translucency. Colours are fixed on purpose: a sticker sits on top of
 * arbitrary photos and must read the same in every app theme.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { FONT, FS } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import type {
  StoryCountdownState, StoryOverlay, StoryPollState, StoryProductState, StoryQuestionState, StoryStickerState,
} from '@/services/socialTypes';

export const STICKER = {
  paper: '#F5F5F5',
  ink: '#111112',
  inkSoft: '#5B5B5B',
  silver: '#C4C4C4',
  silverSoft: '#E6E6E6',
  card: 240,
} as const;

export type StickerMode = 'editor' | 'viewer';

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// ─── Poll ─────────────────────────────────────────────────────────────────────

export function PollSticker({
  question, options, state, mode, isAuthor, busy, onVote,
}: {
  question: string;
  options: string[];
  state?: StoryPollState | null;
  mode: StickerMode;
  isAuthor?: boolean;
  busy?: boolean;
  onVote?: (index: number) => void;
}) {
  const revealed = !!state && state.counts !== null;
  const canVote = mode === 'viewer' && !isAuthor && !!onVote && (state?.myVote ?? null) === null && !busy;
  return (
    <View style={s.card} testID="sticker-poll">
      <Text style={s.title}>{question}</Text>
      <View style={s.rows}>
        {options.map((label, i) => {
          const pct = revealed ? (state!.percentages?.[i] ?? 0) : 0;
          const mine = state?.myVote === i;
          return (
            <Pressable
              key={`${i}-${label}`}
              disabled={!canVote}
              onPress={() => onVote?.(i)}
              style={s.optionRow}
              accessibilityRole="button"
              accessibilityLabel={revealed ? `${label}, ${pct} percent${mine ? ', your vote' : ''}` : `Vote ${label}`}
              accessibilityState={{ selected: mine, disabled: !canVote }}
              testID={`sticker-poll-option-${i}`}
            >
              {revealed ? <View style={[s.optionFill, { width: `${pct}%` }]} /> : null}
              <View style={s.optionContent}>
                <Text style={[s.optionLabel, mine && s.optionLabelMine]}>{label}</Text>
                {revealed ? (
                  <View style={s.optionRight}>
                    {mine ? <Feather name="check" size={14} color={STICKER.ink} /> : null}
                    <Text style={s.optionPct}>{pct}%</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      {revealed && state!.total !== null ? (
        <Text style={s.meta}>{state!.total} {state!.total === 1 ? 'vote' : 'votes'}</Text>
      ) : null}
    </View>
  );
}

// ─── Question ─────────────────────────────────────────────────────────────────

export function QuestionSticker({
  prompt, state, mode, isAuthor, busy, onSubmit, onOpenResponses, onFocusChange,
}: {
  prompt: string;
  state?: StoryQuestionState | null;
  mode: StickerMode;
  isAuthor?: boolean;
  busy?: boolean;
  onSubmit?: (answer: string) => void;
  onOpenResponses?: () => void;
  /** The answer box gained / lost focus (the viewer pauses playback while typing). */
  onFocusChange?: (focused: boolean) => void;
}) {
  const [draft, setDraft] = useState('');
  const answered = !!state?.answered;
  if (mode === 'viewer' && isAuthor) {
    const n = state?.count ?? 0;
    return (
      <Pressable style={s.card} onPress={onOpenResponses} accessibilityRole="button" accessibilityLabel={`${n} responses`} testID="sticker-question">
        <Text style={s.title}>{prompt}</Text>
        <View style={s.responsesBtn}>
          <Feather name="message-circle" size={16} color={STICKER.paper} />
          <Text style={s.responsesBtnText}>{n === 1 ? '1 response' : `${n} responses`}</Text>
        </View>
      </Pressable>
    );
  }
  return (
    <View style={s.card} testID="sticker-question">
      <Text style={s.title}>{prompt}</Text>
      {mode === 'editor' ? (
        <View style={s.inputRow}><Text style={s.inputPlaceholder}>Type something…</Text></View>
      ) : answered ? (
        <View style={s.sentRow}>
          <Feather name="check" size={16} color={STICKER.ink} />
          <Text style={s.sentText}>Sent</Text>
        </View>
      ) : (
        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Type something…"
            placeholderTextColor={STICKER.inkSoft}
            maxLength={200}
            editable={!busy}
            returnKeyType="send"
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => onFocusChange?.(false)}
            onSubmitEditing={() => { if (draft.trim()) onSubmit?.(draft.trim()); }}
            accessibilityLabel="Your answer"
          />
          <Pressable
            onPress={() => { if (draft.trim()) onSubmit?.(draft.trim()); }}
            disabled={!draft.trim() || busy}
            style={[s.sendBtn, (!draft.trim() || busy) && s.sendBtnOff]}
            accessibilityRole="button"
            accessibilityLabel="Send answer"
          >
            {busy ? <ActivityIndicator size="small" color={STICKER.paper} /> : <Feather name="arrow-up" size={16} color={STICKER.paper} />}
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ─── Product ──────────────────────────────────────────────────────────────────

export function ProductSticker({
  name, imageUrl, priceCents, available = true, soldOut = false, mode, onPress,
}: {
  name: string;
  imageUrl?: string | null;
  priceCents?: number | null;
  available?: boolean;
  soldOut?: boolean;
  mode: StickerMode;
  onPress?: () => void;
}) {
  const sub = !available ? 'No longer available' : soldOut ? 'Sold out' : typeof priceCents === 'number' ? dollars(priceCents) : 'Shop now';
  return (
    <Pressable
      disabled={mode === 'editor' || !available || !onPress}
      onPress={onPress}
      style={s.productCard}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${sub}`}
      testID="sticker-product"
    >
      {imageUrl
        ? <CachedImage source={{ uri: imageUrl }} style={s.productImg} contentFit="cover" />
        : <View style={[s.productImg, { backgroundColor: STICKER.silver }]}><Feather name="shopping-bag" size={18} color={STICKER.ink} /></View>}
      <View style={s.productText}>
        <Text style={s.productName}>{name}</Text>
        <Text style={s.productSub}>{sub}</Text>
      </View>
      {mode === 'viewer' && available ? <Feather name="chevron-right" size={18} color={STICKER.ink} /> : null}
    </Pressable>
  );
}

// ─── Countdown ────────────────────────────────────────────────────────────────

export function countdownParts(msLeft: number) {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** Milliseconds until `releaseAt`, ticking each second from the SERVER clock (`serverNow`), not the phone's. */
export function useCountdown(releaseAt: string | null | undefined, serverNow?: number, tick = true): number | null {
  const offset = useRef((serverNow ?? Date.now()) - Date.now());
  useEffect(() => { offset.current = (serverNow ?? Date.now()) - Date.now(); }, [serverNow]);
  const target = releaseAt ? new Date(releaseAt).getTime() : null;
  const compute = () => (target === null ? null : target - (Date.now() + offset.current));
  const [left, setLeft] = useState<number | null>(compute);
  useEffect(() => {
    setLeft(compute());
    if (!tick || target === null) return undefined;
    const t = setInterval(() => setLeft(compute()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, tick]);
  return left;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function CountdownSticker({
  name, releaseAt, serverNow, live, subscribed, mode, busy, onNotify, onOpen,
}: {
  name: string;
  releaseAt: string | null;
  serverNow?: number;
  /** the drop has launched and is selling */
  live?: boolean;
  subscribed?: boolean;
  mode: StickerMode;
  busy?: boolean;
  onNotify?: () => void;
  onOpen?: () => void;
}) {
  const left = useCountdown(releaseAt, serverNow, mode === 'viewer');
  const launched = !!live || (left !== null && left <= 0);
  const parts = useMemo(() => countdownParts(left ?? 0), [left]);
  const cells: Array<[string, string]> = [
    [pad(parts.days), 'days'], [pad(parts.hours), 'hrs'], [pad(parts.minutes), 'min'], [pad(parts.seconds), 'sec'],
  ];
  return (
    <Pressable
      disabled={mode === 'editor' || !onOpen}
      onPress={onOpen}
      style={s.card}
      accessibilityRole="button"
      accessibilityLabel={launched ? `${name}, live now` : `${name} drops soon`}
      testID="sticker-countdown"
    >
      <Text style={s.countName}>{name}</Text>
      {launched ? (
        <View style={s.liveNow}><Text style={s.liveNowText}>Live now</Text></View>
      ) : (
        <View style={s.cells}>
          {cells.map(([value, label]) => (
            <View key={label} style={s.cell}>
              <Text style={s.cellValue}>{value}</Text>
              <Text style={s.cellLabel}>{label}</Text>
            </View>
          ))}
        </View>
      )}
      {mode === 'viewer' && !launched ? (
        <Pressable
          onPress={onNotify}
          disabled={busy || subscribed}
          style={[s.notifyBtn, subscribed && s.notifyBtnOn]}
          accessibilityRole="button"
          accessibilityLabel={subscribed ? 'You will be notified' : 'Notify me when this drops'}
          accessibilityState={{ selected: !!subscribed }}
          testID="sticker-countdown-notify"
        >
          <Feather name={subscribed ? 'check' : 'bell'} size={14} color={subscribed ? STICKER.paper : STICKER.ink} />
          <Text style={[s.notifyText, subscribed && { color: STICKER.paper }]}>{subscribed ? 'You’ll be notified' : 'Notify me'}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

// ─── Viewer layer ─────────────────────────────────────────────────────────────

/**
 * Renders a slide's interactive stickers at their saved positions. State comes
 * from `story.stickerState`; every action returns fresh state which replaces it.
 * `local` (dev demo preview only) applies the action in memory instead of calling the API.
 */
export function ViewerStickerLayer({
  storyId, overlays, state, isAuthor, local, actions, onPause,
}: {
  storyId: string;
  overlays: StoryOverlay[];
  state?: StoryStickerState | null;
  isAuthor: boolean;
  local?: boolean;
  actions: {
    vote: (storyId: string, overlayId: string, optionIndex: number) => Promise<StoryStickerState | null>;
    answer: (storyId: string, overlayId: string, text: string) => Promise<StoryStickerState | null>;
    notify: (dropId: string) => Promise<void>;
    openProduct: (productId: string, name: string) => void;
    openDrop: (dropId: string, name: string) => void;
    openResponses: (storyId: string) => void;
  };
  onPause?: (paused: boolean) => void;
}) {
  const [live, setLive] = useState<StoryStickerState | null>(state ?? null);
  const [busyId, setBusyId] = useState<string | null>(null);
  useEffect(() => { setLive(state ?? null); }, [state]);

  const stickers = overlays.filter((o) => o.type === 'poll' || o.type === 'question' || o.type === 'product' || o.type === 'countdown');
  if (stickers.length === 0) return null;

  const run = async (id: string, fn: () => Promise<StoryStickerState | null | void>) => {
    setBusyId(id);
    try {
      const next = await fn();
      if (next) setLive(next);
    } catch {
      /* a failed vote leaves the card as it was so the viewer can try again */
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {stickers.map((o) => {
        const frame = {
          position: 'absolute' as const, left: o.x, top: o.y, zIndex: 7,
          transform: [{ rotate: `${o.rotation ?? 0}deg` }, { scale: o.scale ?? 1 }],
        };
        let body: React.ReactNode = null;
        if (o.type === 'poll') {
          const options = (o.pollOptions ?? []).map((p) => p.label);
          const cur = live?.polls?.[o.id] ?? null;
          body = (
            <PollSticker
              question={o.pollQuestion ?? ''} options={options} state={cur} mode="viewer" isAuthor={isAuthor} busy={busyId === o.id}
              onVote={(i) => run(o.id, async () => {
                if (local) {
                  const counts = options.map((_, k) => (k === i ? 7 : k === 0 ? 4 : 2));
                  const total = counts.reduce((a, b) => a + b, 0);
                  const pcts = counts.map((c) => Math.round((c / total) * 100));
                  return { ...(live ?? emptyState()), polls: { ...(live?.polls ?? {}), [o.id]: { counts, percentages: pcts, total, myVote: i } } };
                }
                return actions.vote(storyId, o.id, i);
              })}
            />
          );
        } else if (o.type === 'question') {
          body = (
            <QuestionSticker
              prompt={o.questionPrompt ?? ''} state={live?.questions?.[o.id] ?? null} mode="viewer" isAuthor={isAuthor} busy={busyId === o.id}
              onSubmit={(text) => run(o.id, async () => {
                if (local) return { ...(live ?? emptyState()), questions: { ...(live?.questions ?? {}), [o.id]: { answered: true, count: null } } };
                return actions.answer(storyId, o.id, text);
              })}
              onOpenResponses={() => actions.openResponses(storyId)}
              onFocusChange={onPause}
            />
          );
        } else if (o.type === 'product') {
          const p = live?.products?.[o.id] as StoryProductState | undefined;
          const productId = p?.productId ?? o.productId ?? '';
          const name = p?.name ?? o.productName ?? 'Product';
          body = (
            <ProductSticker
              name={name} imageUrl={p ? p.imageUrl : o.productImageUri} priceCents={p ? p.priceCents : o.productPriceCents}
              available={p ? p.available : true} soldOut={p?.soldOut} mode="viewer"
              onPress={productId ? () => actions.openProduct(productId, name) : undefined}
            />
          );
        } else if (o.type === 'countdown') {
          const c = live?.countdowns?.[o.id] as StoryCountdownState | undefined;
          const dropId = c?.dropId ?? o.dropId ?? '';
          const name = c?.name ?? o.dropName ?? 'Drop';
          body = (
            <CountdownSticker
              name={name} releaseAt={c?.releaseAt ?? o.dropReleaseAt ?? null} serverNow={live?.serverNow}
              live={c?.live} subscribed={c?.subscribed} mode="viewer" busy={busyId === o.id}
              onNotify={() => run(o.id, async () => {
                if (!local) await actions.notify(dropId);
                return { ...(live ?? emptyState()), countdowns: { ...(live?.countdowns ?? {}), [o.id]: { ...(c ?? { dropId, name, releaseAt: o.dropReleaseAt ?? null, launched: false, live: false }), subscribed: true } } };
              })}
              onOpen={dropId ? () => actions.openDrop(dropId, name) : undefined}
            />
          );
        }
        return (
          <View key={o.id} style={frame} onTouchStart={() => onPause?.(true)} onTouchEnd={() => onPause?.(false)}>
            {body}
          </View>
        );
      })}
    </>
  );
}

function emptyState(): StoryStickerState {
  return { serverNow: Date.now(), polls: {}, questions: {}, products: {}, countdowns: {} };
}

const s = StyleSheet.create({
  card: { width: STICKER.card, backgroundColor: STICKER.paper, borderRadius: RADII.sheet, paddingHorizontal: 16, paddingVertical: 16, gap: 12 },
  title: { color: STICKER.ink, fontFamily: FONT.bold, fontSize: FS.base, lineHeight: 20, textAlign: 'center' },
  rows: { gap: 8 },
  optionRow: { height: 40, borderRadius: RADII.card, backgroundColor: STICKER.silverSoft, overflow: 'hidden', justifyContent: 'center' },
  optionFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: STICKER.silver },
  optionContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  optionLabel: { color: STICKER.ink, fontFamily: FONT.medium, fontSize: FS.sm },
  optionLabelMine: { fontFamily: FONT.bold },
  optionRight: { position: 'absolute', right: 12, flexDirection: 'row', alignItems: 'center', gap: 4 },
  optionPct: { color: STICKER.ink, fontFamily: FONT.semibold, fontSize: FS.sm },
  meta: { color: STICKER.inkSoft, fontFamily: FONT.medium, fontSize: FS.meta, textAlign: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, borderRadius: RADII.card, backgroundColor: STICKER.silverSoft, paddingLeft: 12, paddingRight: 4 },
  input: { flex: 1, color: STICKER.ink, fontFamily: FONT.regular, fontSize: FS.sm, paddingVertical: 0 },
  inputPlaceholder: { color: STICKER.inkSoft, fontFamily: FONT.regular, fontSize: FS.sm },
  sendBtn: { width: 32, height: 32, borderRadius: RADII.full, backgroundColor: STICKER.ink, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { backgroundColor: STICKER.silver },
  sentRow: { height: 40, borderRadius: RADII.card, backgroundColor: STICKER.silverSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  sentText: { color: STICKER.ink, fontFamily: FONT.semibold, fontSize: FS.sm },
  responsesBtn: { height: 40, borderRadius: RADII.card, backgroundColor: STICKER.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  responsesBtnText: { color: STICKER.paper, fontFamily: FONT.semibold, fontSize: FS.sm },
  productCard: { width: STICKER.card, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: STICKER.paper, borderRadius: RADII.card, padding: 12 },
  productImg: { width: 48, height: 48, borderRadius: RADII.chip, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  productText: { flex: 1, gap: 2 },
  productName: { color: STICKER.ink, fontFamily: FONT.semibold, fontSize: FS.sm, lineHeight: 17 },
  productSub: { color: STICKER.inkSoft, fontFamily: FONT.medium, fontSize: FS.meta },
  countName: { color: STICKER.ink, fontFamily: FONT.bold, fontSize: FS.sm, lineHeight: 18, textAlign: 'center' },
  cells: { flexDirection: 'row', gap: 8 },
  cell: { flex: 1, height: 56, borderRadius: RADII.input, backgroundColor: STICKER.silverSoft, alignItems: 'center', justifyContent: 'center', gap: 2 },
  cellValue: { color: STICKER.ink, fontFamily: FONT.bold, fontSize: FS.md, lineHeight: 20 },
  cellLabel: { color: STICKER.inkSoft, fontFamily: FONT.medium, fontSize: FS.xs, lineHeight: 13 },
  liveNow: { height: 40, borderRadius: RADII.card, backgroundColor: STICKER.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  liveNowText: { color: STICKER.paper, fontFamily: FONT.bold, fontSize: FS.sm },
  notifyBtn: { height: 40, borderRadius: RADII.card, borderWidth: 1.5, borderColor: STICKER.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12 },
  notifyBtnOn: { backgroundColor: STICKER.ink },
  notifyText: { color: STICKER.ink, fontFamily: FONT.semibold, fontSize: FS.sm },
});
