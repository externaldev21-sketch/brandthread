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
import { decryptToken } from "./metaCrypto";
import {
  MetaGraphError,
  createAd,
  createAdCreative,
  createAdSet,
  createCampaign,
  uploadAdImage,
  uploadAdVideo,
} from "./metaGraph";
import { ObjectStorageService } from "./objectStorage";

const storage = new ObjectStorageService();

type MetaCampaignRow = typeof metaCampaigns.$inferSelect;

const OBJECTIVE_TO_OPTIMIZATION_GOAL: Record<string, string> = {
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
  constructor(userMessage: string, cause?: unknown) {
    super(userMessage);
    this.name = "LaunchError";
    this.userMessage = userMessage;
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
  if (!account || account.status !== "connected" || !account.adAccountId) {
    const reason = "Your Meta ad account is not connected. Please reconnect and try again.";
    await markFailed(campaignId, reason);
    throw new LaunchError(reason);
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(account.accessTokenEncrypted);
  } catch {
    const reason = "Your Meta connection expired — please reconnect.";
    await markFailed(campaignId, reason);
    throw new LaunchError(reason);
  }

  const adAccountId = account.adAccountId;

  try {
    // ── Step 1: Campaign ────────────────────────────────────────────────
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
        startTime: campaign.startTime ? campaign.startTime.toISOString() : undefined,
        endTime: campaign.endTime ? campaign.endTime.toISOString() : undefined,
        targeting,
        advantagePlus: campaign.advantagePlus,
        placements: campaign.placements as Record<string, unknown>,
        status: "PAUSED",
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
    }

    await patchCampaign(campaignId, {
      metaAdId,
      status: "in_review",
      rejectionReason: null,
      launchedAt: new Date(),
      lastSyncedAt: new Date(),
    });

    return { status: "in_review", metaAdId };
  } catch (err) {
    const reason = err instanceof MetaGraphError
      ? err.userMessage
      : "Could not launch this campaign on Meta. Please try again.";
    await markFailed(campaignId, reason);
    throw new LaunchError(reason, err);
  }
}

function buildTargeting(campaign: MetaCampaignRow): Record<string, unknown> {
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
