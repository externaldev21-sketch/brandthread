/**
 * Creator credit on official reposts: "Video: @handle" under the caption.
 *
 * The handle is stored without the @ and resolved to a Brandthread profile at
 * read time, so the credit becomes tappable the moment that creator joins.
 * An optional name ("Bully Monday") covers creators known by more than a handle.
 */
import { and, inArray, isNull, sql } from "drizzle-orm";
import { db, users } from "@workspace/db";

const CREDIT_HANDLE_RE = /^[a-z0-9._]{1,30}$/;
const CREDIT_NAME_MAX = 60;

export type CreditInput = { creditHandle?: unknown; creditName?: unknown };
export type CreditValues = { creditHandle: string | null; creditName: string | null };

/** Validates a credit from the composer. Handles may use dots (Instagram/TikTok style). */
export function parseCredit(input: CreditInput): { ok: true; value: CreditValues } | { ok: false; error: string } {
  const rawHandle = input.creditHandle;
  const rawName = input.creditName;
  if (rawHandle !== undefined && rawHandle !== null && typeof rawHandle !== "string") {
    return { ok: false, error: "creditHandle must be a string" };
  }
  if (rawName !== undefined && rawName !== null && typeof rawName !== "string") {
    return { ok: false, error: "creditName must be a string" };
  }
  const handle = (rawHandle ?? "").trim().replace(/^@+/, "").toLowerCase();
  const name = (rawName ?? "").replace(/\s+/g, " ").trim();
  if (handle && !CREDIT_HANDLE_RE.test(handle)) {
    return { ok: false, error: "Credit handle may use letters, numbers, dots and underscores (up to 30)." };
  }
  if (name.length > CREDIT_NAME_MAX) {
    return { ok: false, error: `Credit name must be ${CREDIT_NAME_MAX} characters or fewer.` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>]/.test(name)) return { ok: false, error: "Credit name has invalid characters." };
  return { ok: true, value: { creditHandle: handle || null, creditName: name || null } };
}

export type PostCredit = {
  handle: string | null;
  name: string | null;
  /** Set when the handle belongs to a live Brandthread profile — the credit is tappable. */
  userId: string | null;
  accountType: string | null;
};

type WithCredit = { creditHandle?: string | null; creditName?: string | null };

/**
 * Replaces raw credit columns with a resolved `credit` object (null when the
 * post has none). One batched lookup for the whole list.
 */
export async function attachCredits<T extends WithCredit>(rows: T[]): Promise<Array<Omit<T, "creditHandle" | "creditName"> & { credit: PostCredit | null }>> {
  const handles = [...new Set(rows.map((r) => r.creditHandle).filter((h): h is string => !!h))];
  const profiles = handles.length === 0 ? [] : await db
    .select({ clerkId: users.clerkId, username: users.username, accountType: users.accountType })
    .from(users)
    .where(and(
      inArray(sql`lower(${users.username})`, handles),
      isNull(users.deletedAt),
      isNull(users.deletionRequestedAt),
      isNull(users.suspendedAt),
    ));
  const byHandle = new Map(profiles.map((p) => [String(p.username).toLowerCase(), p]));
  return rows.map(({ creditHandle, creditName, ...rest }) => {
    if (!creditHandle && !creditName) return { ...rest, credit: null };
    const profile = creditHandle ? byHandle.get(creditHandle) : undefined;
    return {
      ...rest,
      credit: {
        handle: creditHandle ?? null,
        name: creditName ?? null,
        userId: profile?.clerkId ?? null,
        accountType: profile?.accountType ?? null,
      },
    };
  });
}
