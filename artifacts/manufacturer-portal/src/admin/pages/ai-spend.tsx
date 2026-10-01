import { useState } from "react";
import { Chips, DataTable, ErrorLine, PageTitle, Pager, StatCards } from "../ui";
import { dollarsFromMicros, useAdminQuery } from "../api";

interface Spend {
  days: number; totalCostMicros: number; totalCalls: number; unpricedCalls: number; hasMore: boolean;
  byFeature: { feature: string; costMicros: number; calls: number }[];
  items: { userId: string | null; name: string; email: string | null; plan: string | null; costMicros: number; calls: number; inputTokens: number; outputTokens: number; unpricedCalls: number }[];
}
const LIMIT = 25;
const FEATURE: Record<string, string> = { chat: "Text", image: "Image generation", image_edit: "Image editing" };

export default function AiSpendPage() {
  const [days, setDays] = useState("30");
  const [offset, setOffset] = useState(0);
  const { data, error, isLoading } = useAdminQuery<Spend>(`/ai-spend?days=${days}&limit=${LIMIT}&offset=${offset}`);
  return (
    <>
      <PageTitle title="AI spend" />
      <div className="mb-4"><Chips value={days} onChange={(d) => { setDays(d); setOffset(0); }} options={[{ id: "7", label: "7 days" }, { id: "30", label: "30 days" }, { id: "90", label: "90 days" }]} /></div>
      <ErrorLine error={error} />
      {data && <StatCards items={[
        { label: "Estimated spend", value: dollarsFromMicros(data.totalCostMicros) },
        { label: "AI calls", value: data.totalCalls.toLocaleString() },
        ...data.byFeature.map((f) => ({ label: FEATURE[f.feature] ?? f.feature, value: dollarsFromMicros(f.costMicros) })),
      ]} />}
      {data && data.unpricedCalls > 0 && <p className="mb-3 text-xs text-muted-foreground">{data.unpricedCalls} call{data.unpricedCalls === 1 ? "" : "s"} used a model with no price on file and count as $0. Add the model in the pricing table (lib/admin/aiPricing.ts).</p>}
      <DataTable loading={isLoading} rows={data?.items} rowKey={(r) => r.userId ?? "system"} empty="No AI usage recorded in this period."
        columns={[
          { header: "User", primary: true, cell: (r) => <span className="font-medium">{r.name}</span> },
          { header: "Email", cell: (r) => <span className="text-muted-foreground">{r.email ?? "—"}</span> },
          { header: "Plan", cell: (r) => r.plan ?? "—" },
          { header: "Calls", className: "tabular-nums", cell: (r) => r.calls.toLocaleString() },
          { header: "Tokens in / out", className: "tabular-nums", cell: (r) => `${r.inputTokens.toLocaleString()} / ${r.outputTokens.toLocaleString()}` },
          { header: "Est. cost", className: "tabular-nums font-medium", cell: (r) => dollarsFromMicros(r.costMicros) },
        ]} />
      <Pager offset={offset} limit={LIMIT} hasMore={!!data?.hasMore} onChange={setOffset} />
    </>
  );
}
