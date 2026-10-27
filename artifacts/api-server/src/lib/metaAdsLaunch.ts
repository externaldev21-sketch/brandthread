/**
 * Orchestrates launching a draft `metaCampaigns` row onto Meta as a real
 * Campaign -> Ad Set -> Ad Creative -> Ad chain.
 *
 * Idempotent by design: before each step, if the row already has the
 * corresponding meta*Id column set, that Graph call is skipped and the
 * existing id is reused. Each newly-created id is persisted to the row
 * immediately, so a crash (or a client retry of POST /launch) mid-chain
 * resumes from wherever it left off instead of creating duplicate objects on
 * Meta. The DB row's unique `idempotencyKey` plus this resume behavior are
 * what make a retried "Launch" tap safe, since metaGraph.ts itself
 * deliberately does not retry create calls (see its withRetry usage note).
 */
import { db, metaAdAccounts, metaCampaigns } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  MetaGraphError,
  createAd,
  createAdCreative,
  createAdSet,
  createCampaign,
  updateCampaignStatus,
  uploadAdImage,
  uploadAdVideo,
} from "./metaGraph";
import {
  MetaReconnectRequiredError,
  RECONNECT_MESSAGE,
  connectionState,
  getFreshAccessToken,
  markNeedsReconnect,
  marketingTarget,
} from "./metaConnection";
import { ObjectStorageService } from "./objectStorage";

const storage = new ObjectStorageService();

type MetaCampaignRow = typeof metaCampaigns.$inferSelect;

export const OBJECTIVE_TO_OPTIMIZATION_GOAL: Record<string, string> = {
  sales: "OFFSITE_CONVERSIONS",
  traffic: "LINK_CLICKS",
  awareness: "REACH",
};

const OBJECTIVE_TO_BILLING_EVENT: Record<string, string> = {
  sales: "IMPRESSIONS",
  traffic: "IMPRESSIONS",
  awareness: "IMPRESSIONS",
};

export class LaunchError extends Error {
  /** Plain-English message safe to show the seller — mirrors MetaGraphError.userMessage. */
  userMessage: string;
  /** Set when the seller must log in to Meta again before anything can launch. */
  code?: "META_RECONNECT_REQUIRED";
  constructor(userMessage: string, cause?: unknown, code?: "META_RECONNECT_REQUIRED") {
    super(userMessage);
    this.name = "LaunchError";
    this.userMessage = userMessage;
    this.code = code;
    if (cause !== undefined) this.cause = cause as Error;
  }
}

async function markFailed(campaignId: string, rejectionReason: string): Promise<void> {
  await db
    .update(metaCampaigns)
    .set({ status: "failed", rejectionReason, updatedAt: new Date() })
    .where(eq(metaCampaigns.id, campaignId));
}

async function patchCampaign(campaignId: string, values: Partial<MetaCampaignRow>): Promise<void> {
  await db
    .update(metaCampaigns)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(metaCampaigns.id, campaignId));
}

export async function launchCampaign(
  campaignId: string,
): Promise<{ status: "in_review" | "failed"; metaAdId?: string; rejectionReason?: string }> {
  const [campaign] = await db.select().from(metaCampaigns).where(eq(metaCampaigns.id, campaignId)).limit(1);
  if (!campaign) {
    throw new LaunchError("Campaign not found.");
  }

  const [account] = await db
    .select()
    .from(metaAdAccounts)
    .where(eq(metaAdAccounts.id, campaign.adAccountRecordId))
    .limit(1);
  const state = connectionState(account);
  if (!account || (state !== "connected" && state !== "needs_reconnect") || !account.adAccountId) {
    const reason = "Your Meta ad account is not connected. Please reconnect and try again.";
    await markFailed(campaignId, reason);
    throw new LaunchError(reason);
  }

  let sellerToken: string;
  try {
    sellerToken = await getFreshAccessToken(account);
  } catch (err) {
    const reconnect = err instanceof MetaReconnectRequiredError;
    const reason = reconnect ? err.userMessage : "Meta Ads isn't configured on this server yet.";
    await markFailed(campaignId, reason);
    throw new LaunchError(reason, err, reconnect ? "META_RECONNECT_REQUIRED" : undefined);
  }

  // Sandbox mode swaps in the sandbox ad account (and its token, when set).
  const target = marketingTarget(account, sellerToken);
  if (!target.adAccountId) {
    const reason = "Meta sandbox mode is on but META_SANDBOX_AD_ACCOUNT_ID is not set.";
    await markFailed(campaignId, reason);
    throw new LaunchError(reason);
  }
  const adAccountId = target.adAccountId;
  const accessToken = target.accessToken;

  // A draft saved days ago can carry a start that has since passed — Meta
  // starts an ad set with no start_time immediately. An end that has passed
  // can't run at all.
  const now = Date.now();
  if (campaign.endTime && campaign.endTime.getTime() <= now) {
    const reason = "This campaign's end date has passed — pick new dates and launch again.";
    await markFailed(campaignId, reason);
    throw new LaunchError(reason);
  }
  const startTime = campaign.startTime && campaign.startTime.getTime() > now
    ? campaign.startTime.toISOString()
    : undefined;

  try {
    // ── Step 1: Campaign (created PAUSED; switched on in step 5, once the
    // whole chain exists, so nothing half-built can deliver) ─────────────
    let metaCampaignId = campaign.metaCampaignId;
    if (!metaCampaignId) {
      const created = await createCampaign(accessToken, adAccountId, {
        name: `Brandthread — ${campaign.headline ?? campaign.id}`,
        objective: campaign.metaObjective,
        status: "PAUSED",
      });
      metaCampaignId = created.id;
      await patchCampaign(campaignId, { metaCampaignId, status: "launching" });
    }

    // ── Step 2: Ad Set ──────────────────────────────────────────────────
    let metaAdSetId = campaign.metaAdSetId;
    if (!metaAdSetId) {
      const targeting = buildTargeting(campaign);
      const created = await createAdSet(accessToken, adAccountId, {
        name: `Brandthread ad set — ${campaign.id}`,
        campaignId: metaCampaignId,
        dailyBudgetCents: campaign.budgetType === "daily" ? campaign.budgetCents : undefined,
        lifetimeBudgetCents: campaign.budgetType === "lifetime" ? campaign.budgetCents : undefined,
        billingEvent: OBJECTIVE_TO_BILLING_EVENT[campaign.objective] ?? "IMPRESSIONS",
        optimizationGoal: OBJECTIVE_TO_OPTIMIZATION_GOAL[campaign.objective] ?? "LINK_CLICKS",
        startTime,
        endTime: campaign.endTime ? campaign.endTime.toISOString() : undefined,
        targeting,
        advantagePlus: campaign.advantagePlus,
        placements: campaign.placements as Record<string, unknown>,
        // Delivery is still held by the paused campaign until step 5.
        status: "ACTIVE",
        pixelId: campaign.objective === "sales" ? (account.pixelId ?? undefined) : undefined,
        promotedObject: campaign.objective === "sales" ? { custom_event_type: "PURCHASE" } : undefined,
      });
      metaAdSetId = created.id;
      await patchCampaign(campaignId, { metaAdSetId });
    }

    // ── Step 3: Ad Creative ─────────────────────────────────────────────
    let metaCreativeId = campaign.metaCreativeId;
    if (!metaCreativeId) {
      let imageHash: string | undefined;
      let videoId: string | undefined;
      if (campaign.mediaKind === "video" && campaign.mediaObjectPaths[0]) {
        const sourceUrl = await storage.getObjectEntityDownloadURL(campaign.mediaObjectPaths[0]);
        const uploaded = await uploadAdVideo(accessToken, adAccountId, { sourceUrl });
        videoId = uploaded.videoId;
      } else if (campaign.mediaObjectPaths[0]) {
        const sourceUrl = await storage.getObjectEntityDownloadURL(campaign.mediaObjectPaths[0]);
        const uploaded = await uploadAdImage(accessToken, adAccountId, { sourceUrl });
        imageHash = uploaded.imageHash;
      }

      const created = await createAdCreative(accessToken, adAccountId, {
        name: `Brandthread creative — ${campaign.id}`,
        pageId: account.pageId ?? "",
        instagramActorId: account.instagramActorId ?? undefined,
        primaryText: campaign.primaryText ?? undefined,
        headline: campaign.headline ?? undefined,
        ctaType: campaign.ctaType,
        destinationUrl: campaign.destinationUrl,
        imageHash,
        videoId,
      });
      metaCreativeId = created.id;
      await patchCampaign(campaignId, { metaCreativeId });
    }

    // ── Step 4: Ad ──────────────────────────────────────────────────────
    let metaAdId = campaign.metaAdId;
    if (!metaAdId) {
      const created = await createAd(accessToken, adAccountId, {
        name: `Brandthread ad — ${campaign.id}`,
        adsetId: metaAdSetId,
        creativeId: metaCreativeId,
        status: "ACTIVE",
      });
      metaAdId = created.id;
      await patchCampaign(campaignId, { metaAdId });
    }

    // ── Step 5: switch the campaign on. Safe to repeat on a retried launch.
    // Meta reviews the ad before it delivers (effective_status PENDING_REVIEW).
    await updateCampaignStatus(accessToken, metaCampaignId, "ACTIVE");

    await patchCampaign(campaignId, {
      metaAdId,
      status: "in_review",
      rejectionReason: null,
      launchedAt: new Date(),
      lastSyncedAt: new Date(),
    });

    return { status: "in_review", metaAdId };
  } catch (err) {
    if (err instanceof MetaGraphError && err.requiresReconnect) {
      await markNeedsReconnect(account.id);
      await markFailed(campaignId, RECONNECT_MESSAGE);
      throw new LaunchError(RECONNECT_MESSAGE, err, "META_RECONNECT_REQUIRED");
    }
    const reason = err instanceof MetaGraphError
      ? err.userMessage
      : "Could not launch this campaign on Meta. Please try again.";
    await markFailed(campaignId, reason);
    throw new LaunchError(reason, err);
  }
}

export function buildTargeting(campaign: Pick<MetaCampaignRow, "targetingSpec">): Record<string, unknown> {
  const spec = (campaign.targetingSpec ?? {}) as {
    countries?: string[];
    ageMin?: number;
    ageMax?: number;
    genders?: string[];
    interests?: { id: string; name: string }[];
  };
  const genderMap: Record<string, number> = { male: 1, female: 2, all: 0 };
  return {
    geo_locations: {
      countries: spec.countries && spec.countries.length > 0 ? spec.countries : ["US"],
    },
    age_min: spec.ageMin ?? 18,
    age_max: spec.ageMax ?? 65,
    ...(spec.genders && spec.genders.length > 0 && !spec.genders.includes("all")
      ? { genders: spec.genders.map((g) => genderMap[g]).filter((n) => n > 0) }
      : {}),
    ...(spec.interests && spec.interests.length > 0
      ? { flexible_spec: [{ interests: spec.interests.map((i) => ({ id: i.id, name: i.name })) }] }
      : {}),
  };
}
