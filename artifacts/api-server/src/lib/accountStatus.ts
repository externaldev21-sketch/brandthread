/**
 * Account status and strikes (feature 72), plus the reporter's own reports
 * (feature 68), copied from Instagram's Help → Account Status and Reports and
 * violations.
 *
 * Strikes are derived from decisions moderators already make — nothing new to
 * keep in sync:
 *   - a report on your content that a moderator actioned (content removed,
 *     account warned, suspended or banned) counts once per item, however many
 *     people reported it;
 *   - an upheld intellectual-property takedown that applied a strike
 *     (ip_cases.strike_applied_at, the repeat-infringer policy).
 * A strike counts toward your standing for STRIKE_WINDOW_DAYS, then stays in
 * your history as expired. STRIKE_LIMIT active strikes is the point the
 * Community Guidelines say an account is reviewed for suspension.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export const STRIKE_WINDOW_DAYS = 90;
export const STRIKE_LIMIT = 3;
const DAY_MS = 86_400_000;

/** Moderator outcomes that count as a strike against the content owner. */
export const STRIKE_ACTIONS = ["remove_content", "suspend_user", "warn", "ban"] as const;

export const REASON_LABELS: Record<string, string> = {
  spam: "Spam",
  harassment: "Bullying or harassment",
  nudity: "Nudity or sexual content",
  hate: "Hate speech",
  violence: "Violence or dangerous content",
  ip_counterfeit: "Counterfeit or intellectual property",
  scam: "Scam or fraud",
  other: "Community Guidelines",
  counterfeit: "Counterfeit",
  trademark: "Trademark",
  copyright: "Copyright",
};

const TARGET_LABELS: Record<string, string> = {
  post: "Post", video: "Video", live: "Live", live_comment: "Live comment", comment: "Comment", story: "Story",
  product: "Listing", profile: "Profile", seller: "Profile", user: "Profile", message: "Message",
  community_message: "Group message", community: "Group", review: "Review",
};

export type StrikeRow = {
  id: string;
  kind: "community" | "ip";
  reason: string;
  action: string | null;
  targetType: string | null;
  issuedAt: Date;
};

export type Strike = {
  id: string;
  kind: "community" | "ip";
  title: string;
  reasonLabel: string;
  issuedAt: string;
  expiresAt: string;
  active: boolean;
};

export type Standing = "good" | "at_risk" | "limit_reached" | "suspended";

export type AccountStatus = {
  standing: Standing;
  headline: string;
  activeStrikes: number;
  strikeLimit: number;
  windowDays: number;
  strikes: Strike[];
};

function strikeTitle(row: StrikeRow): string {
  const thing = row.kind === "ip" ? "Listing" : TARGET_LABELS[row.targetType ?? ""] ?? "Content";
  if (row.kind === "ip") return "Listing removed for intellectual property";
  if (row.action === "warn") return `Warning for a ${thing.toLowerCase()}`;
  if (row.action === "suspend_user" || row.action === "ban") return "Account suspended";
  return `${thing} removed`;
}

export function buildAccountStatus(
  rows: StrikeRow[],
  user: { suspendedAt: Date | null },
  now: Date = new Date(),
): AccountStatus {
  const strikes = rows
    .slice()
    .sort((a, b) => b.issuedAt.valueOf() - a.issuedAt.valueOf())
    .map((row): Strike => {
      const expiresAt = new Date(row.issuedAt.valueOf() + STRIKE_WINDOW_DAYS * DAY_MS);
      return {
        id: row.id,
        kind: row.kind,
        title: strikeTitle(row),
        reasonLabel: REASON_LABELS[row.reason] ?? "Community Guidelines",
        issuedAt: row.issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        active: expiresAt.valueOf() > now.valueOf(),
      };
    });
  const activeStrikes = strikes.filter((s) => s.active).length;
  const standing: Standing = user.suspendedAt ? "suspended"
    : activeStrikes >= STRIKE_LIMIT ? "limit_reached"
    : activeStrikes > 0 ? "at_risk"
    : "good";
  const headline = standing === "suspended" ? "Your account is suspended"
    : standing === "limit_reached" ? "Your account is under review"
    : standing === "at_risk" ? `${activeStrikes} of ${STRIKE_LIMIT} strikes`
    : "Your account is in good standing";
  return { standing, headline, activeStrikes, strikeLimit: STRIKE_LIMIT, windowDays: STRIKE_WINDOW_DAYS, strikes };
}

type Rows<T> = { rows?: T[] };

export async function loadStrikeRows(userId: string): Promise<StrikeRow[]> {
  const actions = sql.join(STRIKE_ACTIONS.map((a) => sql`${a}`), sql`, `);
  const community = await db.execute(sql`
    SELECT DISTINCT ON (r.target_type, r.target_id)
           r.id::text AS id, r.reason, r.resolution_action AS action, r.target_type AS target_type,
           COALESCE(r.resolved_at, r.created_at) AS issued_at
    FROM reports r
    WHERE r.target_owner_id = ${userId} AND r.status = 'actioned' AND r.resolution_action IN (${actions})
    ORDER BY r.target_type, r.target_id, COALESCE(r.resolved_at, r.created_at)
  `);
  const ip = await db.execute(sql`
    SELECT c.id::text AS id, c.rights_type AS reason, c.strike_applied_at AS issued_at
    FROM ip_cases c
    WHERE c.seller_id = ${userId} AND c.strike_applied_at IS NOT NULL
  `);
  type C = { id: string; reason: string; action: string | null; target_type: string | null; issued_at: Date | string };
  type I = { id: string; reason: string; issued_at: Date | string };
  return [
    ...((community as unknown as Rows<C>).rows ?? []).map((r): StrikeRow => ({
      id: `report:${r.id}`, kind: "community", reason: r.reason, action: r.action, targetType: r.target_type, issuedAt: new Date(r.issued_at),
    })),
    ...((ip as unknown as Rows<I>).rows ?? []).map((r): StrikeRow => ({
      id: `ip:${r.id}`, kind: "ip", reason: r.reason, action: "remove_content", targetType: "product", issuedAt: new Date(r.issued_at),
    })),
  ];
}

export async function loadAccountStatus(userId: string, now = new Date()): Promise<AccountStatus> {
  const user = await db.execute(sql`SELECT suspended_at FROM users WHERE clerk_id = ${userId} LIMIT 1`);
  const row = ((user as unknown as Rows<{ suspended_at: Date | string | null }>).rows ?? [])[0];
  return buildAccountStatus(await loadStrikeRows(userId), { suspendedAt: row?.suspended_at ? new Date(row.suspended_at) : null }, now);
}

// ─── Your reports ────────────────────────────────────────────────────────────

export type MyReport = {
  id: string;
  targetType: string;
  targetLabel: string | null;
  reasonLabel: string;
  status: "in_review" | "removed" | "no_violation";
  statusLabel: string;
  createdAt: string;
  resolvedAt: string | null;
};

export function toMyReport(r: {
  id: string; target_type: string; target_label: string | null; reason: string; status: string;
  resolution_action: string | null; created_at: Date | string; resolved_at: Date | string | null;
}): MyReport {
  const status: MyReport["status"] = r.status === "pending" ? "in_review"
    : r.status === "actioned" && r.resolution_action && r.resolution_action !== "dismiss" ? "removed"
    : "no_violation";
  return {
    id: r.id,
    targetType: TARGET_LABELS[r.target_type] ?? "Content",
    targetLabel: r.target_label,
    reasonLabel: REASON_LABELS[r.reason] ?? "Other",
    status,
    statusLabel: status === "in_review" ? "In review" : status === "removed" ? "We took action" : "No violation found",
    createdAt: new Date(r.created_at).toISOString(),
    resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
  };
}

export async function loadMyReports(userId: string, limit = 50): Promise<MyReport[]> {
  // Auto-filter rows are filed in the poster's name by the system; only what
  // this person reported themselves is theirs to see.
  const result = await db.execute(sql`
    SELECT id::text AS id, target_type, target_label, reason, status, resolution_action, created_at, resolved_at
    FROM reports
    WHERE reporter_id = ${userId} AND source = 'user'
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  return ((result as unknown as Rows<Parameters<typeof toMyReport>[0]>).rows ?? []).map(toMyReport);
}
