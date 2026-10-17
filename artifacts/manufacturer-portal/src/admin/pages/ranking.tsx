import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmAction, ErrorLine, PageTitle } from "../ui";
import { useAdminMutation, useAdminQuery, when } from "../api";

/**
 * For You ranking weights. Defaults live in code (api-server lib/ranking/config.ts);
 * saving stores an override in ranking_config, which every API instance picks
 * up within ~60s. The server clamps every value, so what comes back is what's live.
 */
interface RankingConfig {
  eventWeights: Record<string, number>;
  scoreWeights: Record<string, number>;
  recencyHalfLifeHours: number;
  liveInterleaveEvery: number;
  explorationEvery: number;
  engagementWindowDays: number;
}
interface State { config: RankingConfig; defaults: RankingConfig; stored: boolean; envOverride: boolean; updatedAt: string | null }
type Draft = Record<string, string>;

const SCORE_LABELS: Record<string, string> = {
  affinity: "Affinity (buyer ↔ seller/category)", freshness: "Freshness", trending: "Trending",
  followed: "Followed sellers", boosted: "Promoted threads", engagement: "Engagement quality",
};
const TIMING: { key: keyof RankingConfig; label: string; hint: string }[] = [
  { key: "recencyHalfLifeHours", label: "Recency half-life (hours)", hint: "1–336" },
  { key: "liveInterleaveEvery", label: "Live stream every N items", hint: "2–50" },
  { key: "explorationEvery", label: "Exploration item every N items", hint: "2–50" },
  { key: "engagementWindowDays", label: "Engagement lookback (days)", hint: "1–90" },
];
const RANGES = { score: "0–20", event: "-10–10" };

function toDraft(c: RankingConfig): Draft {
  const d: Draft = {};
  for (const [k, v] of Object.entries(c.scoreWeights)) d[`score.${k}`] = String(v);
  for (const [k, v] of Object.entries(c.eventWeights)) d[`event.${k}`] = String(v);
  for (const t of TIMING) d[t.key] = String(c[t.key]);
  return d;
}

/** Only the fields that differ from what's live; null when a field isn't a number. */
export function draftToPatch(draft: Draft, live: RankingConfig): Partial<RankingConfig> | null {
  const patch: Record<string, unknown> = {};
  const score: Record<string, number> = {}, event: Record<string, number> = {};
  for (const [k, raw] of Object.entries(draft)) {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n)) return null;
    if (k.startsWith("score.")) { const f = k.slice(6); if (live.scoreWeights[f] !== n) score[f] = n; }
    else if (k.startsWith("event.")) { const f = k.slice(6); if (live.eventWeights[f] !== n) event[f] = n; }
    else if ((live as unknown as Record<string, number>)[k] !== n) patch[k] = n;
  }
  if (Object.keys(score).length) patch.scoreWeights = score;
  if (Object.keys(event).length) patch.eventWeights = event;
  return patch as Partial<RankingConfig>;
}

function Field({ label, value, def, hint, onChange }: { label: string; value: string; def: number; hint: string; onChange: (v: string) => void }) {
  const changed = value.trim() !== "" && Number(value) !== def;
  return (
    <label className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
      <span className="min-w-0">
        <span className="block">{label}</span>
        <span className="block text-xs text-muted-foreground">Default {def} · {hint}{changed ? " · tuned" : ""}</span>
      </span>
      <Input type="number" step="any" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-24 shrink-0 text-right tabular-nums" />
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default function RankingPage() {
  const { data, error, isLoading } = useAdminQuery<State>("/ranking");
  const save = useAdminMutation<Partial<RankingConfig>, State>("PATCH", "/ranking", ["/ranking"]);
  const reset = useAdminMutation<Record<string, never>, State>("POST", "/ranking/reset", ["/ranking"]);
  const [draft, setDraft] = useState<Draft>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (data) setDraft(toDraft(data.config)); }, [data]);
  const patch = useMemo(() => (data ? draftToPatch(draft, data.config) : null), [draft, data]);
  const dirty = !!patch && Object.keys(patch).length > 0;
  const set = (k: string) => (v: string) => { setSaved(false); setDraft((d) => ({ ...d, [k]: v })); };

  if (isLoading && !data) return <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>;
  if (!data) return <><PageTitle title="Feed ranking" /><ErrorLine error={error ?? new Error("Could not load ranking weights.")} /></>;
  const d = data.defaults;

  return (
    <>
      <PageTitle title="Feed ranking" />
      <p className="mb-4 text-sm text-muted-foreground">
        Weights for the buyer For You feed. {data.stored ? `Last saved ${when(data.updatedAt)}.` : "Using the built-in defaults."} Changes reach every server within about a minute.
      </p>
      {data.envOverride && (
        <p className="mb-4 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
          RANKING_WEIGHTS_JSON is set on the server and overrides any value it contains — those fields won't change from here until it's removed.
        </p>)}
      <ErrorLine error={error} />
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Score blend">
          {Object.keys(d.scoreWeights).map((k) => (
            <Field key={k} label={SCORE_LABELS[k] ?? k} value={draft[`score.${k}`] ?? ""} def={d.scoreWeights[k]!} hint={RANGES.score} onChange={set(`score.${k}`)} />))}
        </Section>
        <Section title="Pacing">
          {TIMING.map((t) => (
            <Field key={t.key} label={t.label} value={draft[t.key] ?? ""} def={d[t.key] as number} hint={t.hint} onChange={set(t.key)} />))}
        </Section>
        <div className="md:col-span-2">
          <Section title="Signal weights (per interaction)">
            <div className="grid md:grid-cols-2 md:gap-x-6">
              {Object.keys(d.eventWeights).map((k) => (
                <Field key={k} label={k.replaceAll("_", " ")} value={draft[`event.${k}`] ?? ""} def={d.eventWeights[k]!} hint={RANGES.event} onChange={set(`event.${k}`)} />))}
            </div>
          </Section>
        </div>
      </div>
      {patch === null && <p className="mt-3 text-sm text-destructive">Every field needs a number.</p>}
      <ErrorLine error={save.error} />
      <div className="mt-4 flex flex-col gap-2 md:flex-row md:justify-end">
        {saved && !dirty && <span className="self-center text-sm text-muted-foreground">Saved.</span>}
        <Button variant="outline" className="h-10 px-4" onClick={() => { reset.reset(); setConfirmReset(true); }}>Reset to defaults</Button>
        <Button variant="outline" className="h-10 px-4" disabled={!dirty} onClick={() => setDraft(toDraft(data.config))}>Discard changes</Button>
        <Button className="h-10 px-4" disabled={!dirty || save.isPending} onClick={() => patch && save.mutate(patch, { onSuccess: () => setSaved(true) })}>
          {save.isPending ? "Saving…" : "Save weights"}
        </Button>
      </div>
      <ConfirmAction open={confirmReset} title="Reset every weight to its default?" description="The For You feed goes back to the built-in weights. You can tune them again any time."
        confirmLabel="Reset" pending={reset.isPending} error={reset.error} onCancel={() => setConfirmReset(false)}
        onConfirm={() => reset.mutate({}, { onSuccess: () => { setConfirmReset(false); setSaved(true); } })} />
    </>
  );
}
