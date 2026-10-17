import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ActionButton, ActionGroup, Badge, ConfirmAction, DataTable, ErrorLine, PageTitle, StatCards } from "../ui";
import { useAdminMutation, useAdminQuery, when } from "../api";

/**
 * Posts, stories and comments held by auto-moderation (text filter and/or
 * media screening). Nothing here is visible to members until approved.
 * Backed by /api/admin/held (same queue as /api/moderation/held, admin-gated and audited).
 */
interface Author { name?: string | null; handle?: string | null }
interface Held {
  type: "post" | "story" | "comment"; id: string; createdAt: string; reason: string | null; text: string | null;
  mediaType: string | null; mediaUrls: string[]; parentId: string | null; author: Author | null; authorId: string;
  moderation: { verdict: string; categories: unknown; maxScore: number | null; priority: string | null; provider: string | null } | null;
}
interface Page { items: Held[]; hasMore: boolean; nextCursor: string | null }
interface Counts { total: number; posts: number; stories: number; comments: number; highPriorityUnreviewed: number }
type Filter = "all" | "post" | "story" | "comment" | "media";
const LIMIT = 25;
const isVideo = (url: string) => /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url);
const who = (a: Author | null, id: string) => a?.name || (a?.handle ? `@${a.handle}` : id);

function categoriesOf(m: Held["moderation"]): string[] {
  const c = m?.categories;
  if (Array.isArray(c)) return c.map(String);
  if (c && typeof c === "object") return Object.keys(c);
  return [];
}

export default function HeldPage() {
  const [type, setType] = useState<Filter>("all");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1];
  const { data: counts } = useAdminQuery<Counts>("/held/counts");
  const { data, error, isLoading } = useAdminQuery<Page>(`/held?type=${type}&limit=${LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
  const review = useAdminMutation<{ item: Held; action: "approve" | "remove" }>("POST", (b) => `/held/${b.item.type}/${b.item.id}/${b.action}`, ["/held"]);
  const [pending, setPending] = useState<{ item: Held; action: "approve" | "remove" } | null>(null);
  const pick = (t: Filter) => { setType(t); setCursors([null]); };

  return (
    <>
      <PageTitle title="Held content" />
      {counts && <StatCards items={[
        { label: "All held", value: String(counts.total), active: type === "all", onClick: () => pick("all") },
        { label: "Posts", value: String(counts.posts), active: type === "post", onClick: () => pick("post") },
        { label: "Stories", value: String(counts.stories), active: type === "story", onClick: () => pick("story") },
        { label: "Comments", value: String(counts.comments), active: type === "comment", onClick: () => pick("comment") },
        { label: "High priority (media)", value: String(counts.highPriorityUnreviewed), active: type === "media", onClick: () => pick("media") },
      ]} />}
      <ErrorLine error={error} />
      <DataTable loading={isLoading} rows={data?.items} rowKey={(i) => `${i.type}:${i.id}`} empty="Nothing is held. Auto-moderation hasn't stopped anything."
        columns={[
          { header: "Content", primary: true, cell: (i) => (
            <div className="flex max-w-md items-start gap-3">
              {i.mediaUrls[0] && (isVideo(i.mediaUrls[0])
                ? <video src={i.mediaUrls[0]} className="h-14 w-14 shrink-0 rounded object-cover" muted preload="metadata" />
                : <img src={i.mediaUrls[0]} alt="" className="h-14 w-14 shrink-0 rounded object-cover" loading="lazy" />)}
              <div className="min-w-0">
                <div className="font-medium capitalize">{i.type}{i.mediaUrls.length > 1 ? ` · ${i.mediaUrls.length} media` : ""}</div>
                {i.text
                  ? <div className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">{i.text}</div>
                  : <div className="mt-0.5 text-xs text-muted-foreground">No text</div>}
                {i.mediaUrls.length > 0 && <a href={i.mediaUrls[0]} target="_blank" rel="noreferrer" className="text-xs underline" onClick={(e) => e.stopPropagation()}>Open media</a>}
              </div>
            </div>) },
          { header: "Reason", cell: (i) => (
            <div className="space-y-1">
              <div>{i.reason ?? (i.moderation ? "Media screening" : "Text filter")}</div>
              {i.moderation && (
                <div className="flex flex-wrap gap-1">
                  {i.moderation.priority === "high" && <Badge tone="danger">high priority</Badge>}
                  {categoriesOf(i.moderation).slice(0, 3).map((c) => <Badge key={c} tone="outline">{c.replaceAll("_", " ")}</Badge>)}
                </div>)}
            </div>) },
          { header: "Author", cell: (i) => who(i.author, i.authorId) },
          { header: "Held at", cell: (i) => when(i.createdAt) },
          { header: "Action", cell: (i) => (
            <ActionGroup>
              <ActionButton onClick={(e) => { e.stopPropagation(); review.reset(); setPending({ item: i, action: "approve" }); }}>Approve</ActionButton>
              <ActionButton onClick={(e) => { e.stopPropagation(); review.reset(); setPending({ item: i, action: "remove" }); }}>Reject</ActionButton>
            </ActionGroup>) },
        ]} />
      {(cursors.length > 1 || data?.hasMore) && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" className="h-8 w-24 px-3" disabled={cursors.length <= 1} onClick={() => setCursors((c) => c.slice(0, -1))}>Previous</Button>
          <Button size="sm" variant="outline" className="h-8 w-24 px-3" disabled={!data?.hasMore || !data.nextCursor} onClick={() => data?.nextCursor && setCursors((c) => [...c, data.nextCursor])}>Next</Button>
        </div>)}
      <ConfirmAction open={!!pending}
        title={pending?.action === "approve" ? `Publish this ${pending.item.type}?` : `Reject this ${pending?.item.type ?? "item"}?`}
        description={pending?.action === "approve"
          ? "It becomes visible to members. Any open reports on it are dismissed."
          : "It stays hidden for good and open reports on it are closed. The author's account is untouched."}
        confirmLabel={pending?.action === "approve" ? "Approve" : "Reject"} destructive={pending?.action === "remove"}
        pending={review.isPending} error={review.error} onCancel={() => setPending(null)}
        onConfirm={() => pending && review.mutate(pending, { onSuccess: () => setPending(null) })} />
    </>
  );
}
