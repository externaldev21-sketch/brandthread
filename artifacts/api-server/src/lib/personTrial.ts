import { db, users } from "@workspace/db";
import { and, inArray, isNotNull, ne, or } from "drizzle-orm";
import { personProfileIds } from "./accountProfiles";

/**
 * One free trial per PERSON, not per profile: true when any other profile
 * of the same login (live or deleted) already started a subscription or
 * trial. Accounts without linked profiles are never affected here; their
 * own active subscription is handled by the checkout route itself.
 */
export async function personHadTrial(clerkUserId: string): Promise<boolean> {
  const ids = (await personProfileIds(clerkUserId, { includeDeleted: true })).filter((id) => id !== clerkUserId);
  if (ids.length === 0) return false;
  const [row] = await db
    .select({ clerkId: users.clerkId })
    .from(users)
    .where(and(
      inArray(users.clerkId, ids),
      ne(users.clerkId, clerkUserId),
      or(isNotNull(users.subscriptionTrialStartedAt), isNotNull(users.subscriptionId)),
    ))
    .limit(1);
  return !!row;
}

/** Drops the Checkout trial when this person already had theirs. */
export function withPersonTrialRule<T extends { subscription_data?: { trial_period_days?: number } & Record<string, unknown> }>(
  trialAllowed: boolean,
  params: T,
): T {
  if (trialAllowed || !params.subscription_data) return params;
  const { trial_period_days: _dropped, ...subscriptionData } = params.subscription_data;
  return { ...params, subscription_data: subscriptionData };
}
