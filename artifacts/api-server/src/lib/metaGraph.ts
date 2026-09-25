/**
 * Thin fetch-based client for the Meta (Facebook/Instagram) Marketing API +
 * Graph API OAuth + Conversions API.
 *
 * Marketing API docs: https://developers.facebook.com/docs/marketing-apis
 * Graph API error reference: https://developers.facebook.com/docs/graph-api/guides/error-handling
 * Conversions API: https://developers.facebook.com/docs/marketing-api/conversions-api
 *
 * Every exported function here takes an already-decrypted `accessToken`
 * string as a plain argument — this file never touches storage or the DB,
 * and never knows about Brandthread sellers. Callers (routes / metaAdsLaunch)
 * are responsible for decrypting via src/lib/metaCrypto.ts and for persisting
 * results.
 */
import { withRetry } from "./retry";

function graphVersion(): string {
  return process.env.META_GRAPH_API_VERSION?.trim() || "v21.0";
}

function graphBase(): string {
  return `https://graph.facebook.com/${graphVersion()}`;
}

// ─── Error type + plain-English mapping ────────────────────────────────────

export class MetaGraphError extends Error {
  status: number;
  metaErrorCode?: number;
  metaErrorSubcode?: number;
  /** Plain-English message safe to show a seller. */
  userMessage: string;

  constructor(params: {
    message: string;
    status: number;
    metaErrorCode?: number;
    metaErrorSubcode?: number;
    userMessage: string;
  }) {
    super(params.message);
    this.name = "MetaGraphError";
    this.status = params.status;
    this.metaErrorCode = params.metaErrorCode;
    this.metaErrorSubcode = params.metaErrorSubcode;
    this.userMessage = params.userMessage;
  }
}

/**
 * Maps a Meta Graph API error body to a plain-English message. Prefers Meta's
 * own `error_user_msg` (already written for end users), then falls back to a
 * mapping of common `code`/`error_subcode` pairs from Meta's Marketing API
 * error reference, and finally to the raw `error.message`.
 */
function mapMetaError(error: {
  message?: string;
  error_user_msg?: string;
  code?: number;
  error_subcode?: number;
  type?: string;
}): string {
  if (error.error_user_msg) return error.error_user_msg;

  const code = error.code;
  const subcode = error.error_subcode;

  switch (code) {
    case 190:
      return "Your Meta connection expired — please reconnect.";
    case 200:
    case 10:
      return "You don't have permission to do this on Meta — check your Meta Business Suite roles.";
    case 100:
      // Common invalid-parameter subcodes for targeting / creative validation.
      if (subcode === 1487056 || subcode === 1487225) {
        return "Your audience settings aren't valid — try widening your audience.";
      }
      if (subcode === 1885183) {
        return "Your daily or lifetime budget is too low for this ad set — try increasing it.";
      }
      return "Some of your campaign settings aren't valid — please review and try again.";
    case 368:
      return "This ad account is restricted by Meta — check your Meta Business Suite for details.";
    case 2635:
      return "This Meta app no longer has access — please reconnect your Meta account.";
    case 17:
      return "Meta is rate-limiting requests right now — please try again shortly.";
    case 80004:
      return "Too many ad-account requests to Meta right now — please try again shortly.";
    case 2400:
      return "Your ad creative was not approved — check the media and text for policy issues.";
    case 1487742:
      return "Your ad was disapproved by Meta review — check Meta Business Suite for the reason.";
    case 2350:
      return "This ad account's payment method needs attention in Meta Business Suite.";
    default:
      return error.message || "Something went wrong talking to Meta. Please try again.";
  }
}

async function parseMetaErrorBody(res: Response): Promise<MetaGraphError> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON body (rare, e.g. an upstream proxy error page).
  }
  const error = body?.error ?? {};
  return new MetaGraphError({
    message: error.message || `Meta API error (${res.status})`,
    status: res.status,
    metaErrorCode: typeof error.code === "number" ? error.code : undefined,
    metaErrorSubcode: typeof error.error_subcode === "number" ? error.error_subcode : undefined,
    userMessage: mapMetaError(error),
  });
}

// ─── Low-level request helpers ─────────────────────────────────────────────

/** GET with retry-with-backoff — every call in this file that only reads is safe to retry. */
async function metaGet(url: string, label: string): Promise<any> {
  return withRetry(
    async () => {
      const res = await fetch(url);
      if (!res.ok) throw await parseMetaErrorBody(res);
      return res.json();
    },
    {
      label,
      isRetryable: (err) => (err instanceof MetaGraphError ? err.status >= 500 || err.status === 429 : true),
    },
  );
}

/**
 * POST/create calls are NOT retried automatically — a retried POST could
 * double-create a campaign/ad-set/creative/ad on Meta's side. Idempotency for
 * campaign creation is instead handled one level up, in metaAdsLaunch.ts,
 * which persists each created id immediately and skips steps that already
 * have one. Callers that need to retry a whole launch attempt can do so
 * safely because of that resume behavior — never because this function retries.
 */
async function metaPost(url: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseMetaErrorBody(res);
  return res.json();
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return search.toString();
}

// ─── OAuth ──────────────────────────────────────────────────────────────────

export async function exchangeCodeForToken(params: {
  code: string;
  redirectUri: string;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const appId = process.env.META_APP_ID ?? "";
  const appSecret = process.env.META_APP_SECRET ?? "";
  const url = `${graphBase()}/oauth/access_token?${qs({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: params.redirectUri,
    code: params.code,
  })}`;
  const body = await metaGet(url, "metaGraph.exchangeCodeForToken");
  return { accessToken: body.access_token, expiresIn: body.expires_in ?? 0 };
}

export async function getLongLivedToken(
  shortLivedToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const appId = process.env.META_APP_ID ?? "";
  const appSecret = process.env.META_APP_SECRET ?? "";
  const url = `${graphBase()}/oauth/access_token?${qs({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  })}`;
  const body = await metaGet(url, "metaGraph.getLongLivedToken");
  return { accessToken: body.access_token, expiresIn: body.expires_in ?? 5_184_000 /* ~60 days */ };
}

export async function getMe(accessToken: string): Promise<{ id: string; name: string }> {
  const url = `${graphBase()}/me?${qs({ fields: "id,name", access_token: accessToken })}`;
  const body = await metaGet(url, "metaGraph.getMe");
  return { id: body.id, name: body.name };
}

// ─── Businesses / ad accounts / pages ──────────────────────────────────────

export async function listBusinesses(
  accessToken: string,
): Promise<Array<{ id: string; name: string }>> {
  const url = `${graphBase()}/me/businesses?${qs({ fields: "id,name", access_token: accessToken })}`;
  const body = await metaGet(url, "metaGraph.listBusinesses");
  return (body.data ?? []).map((b: any) => ({ id: b.id, name: b.name }));
}

export async function listAdAccounts(
  accessToken: string,
  businessId: string,
): Promise<Array<{ id: string; name: string; currency: string; accountStatus: number }>> {
  const url = `${graphBase()}/${businessId}/owned_ad_accounts?${qs({
    fields: "id,name,currency,account_status",
    access_token: accessToken,
  })}`;
  const body = await metaGet(url, "metaGraph.listAdAccounts");
  return (body.data ?? []).map((a: any) => ({
    id: a.id, // already "act_..."
    name: a.name,
    currency: a.currency,
    accountStatus: a.account_status,
  }));
}

export async function listPages(
  accessToken: string,
  businessId: string,
): Promise<Array<{ id: string; name: string; instagramBusinessAccount?: { id: string; username: string } }>> {
  const url = `${graphBase()}/${businessId}/owned_pages?${qs({
    fields: "id,name,instagram_business_account{id,username}",
    access_token: accessToken,
  })}`;
  const body = await metaGet(url, "metaGraph.listPages");
  return (body.data ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    instagramBusinessAccount: p.instagram_business_account
      ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username }
      : undefined,
  }));
}

// ─── Pixel ──────────────────────────────────────────────────────────────────

export async function getOrCreatePixel(accessToken: string, adAccountId: string): Promise<{ id: string }> {
  const listUrl = `${graphBase()}/${adAccountId}/adspixels?${qs({
    fields: "id",
    access_token: accessToken,
  })}`;
  const listBody = await metaGet(listUrl, "metaGraph.listPixels");
  const existing = listBody.data?.[0];
  if (existing?.id) return { id: existing.id };

  const created = await metaPost(`${graphBase()}/${adAccountId}/adspixels`, {
    name: "Brandthread Pixel",
    access_token: accessToken,
  });
  return { id: created.id };
}

// ─── Targeting search ───────────────────────────────────────────────────────

export async function targetingSearch(
  accessToken: string,
  adAccountId: string,
  query: string,
  type: "adinterest" | "adgeolocation",
): Promise<Array<{ id: string; name: string; audienceSizeLower?: number; audienceSizeUpper?: number }>> {
  const url = `${graphBase()}/${adAccountId}/targetingsearch?${qs({
    q: query,
    type,
    access_token: accessToken,
  })}`;
  const body = await metaGet(url, "metaGraph.targetingSearch");
  return (body.data ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    audienceSizeLower: t.audience_size_lower,
    audienceSizeUpper: t.audience_size_upper,
  }));
}

// ─── Campaign / ad set / creative / ad creation ────────────────────────────

export async function createCampaign(
  accessToken: string,
  adAccountId: string,
  params: { name: string; objective: string; status: "PAUSED" | "ACTIVE" },
): Promise<{ id: string }> {
  const body = await metaPost(`${graphBase()}/${adAccountId}/campaigns`, {
    name: params.name,
    objective: params.objective,
    status: params.status,
    special_ad_categories: [],
    access_token: accessToken,
  });
  return { id: body.id };
}

export interface CreateAdSetParams {
  name: string;
  campaignId: string;
  dailyBudgetCents?: number;
  lifetimeBudgetCents?: number;
  billingEvent: string; // e.g. "IMPRESSIONS"
  optimizationGoal: string; // e.g. "OFFSITE_CONVERSIONS" | "LINK_CLICKS" | "REACH"
  startTime?: string; // ISO
  endTime?: string; // ISO
  targeting: Record<string, unknown>;
  advantagePlus?: boolean;
  placements?: Record<string, unknown>;
  status: "PAUSED" | "ACTIVE";
  pixelId?: string;
  promotedObject?: Record<string, unknown>;
}

export async function createAdSet(
  accessToken: string,
  adAccountId: string,
  params: CreateAdSetParams,
): Promise<{ id: string }> {
  const targeting = params.advantagePlus
    ? { ...params.targeting } // Advantage+ placements: Meta auto-expands from this base targeting
    : { ...params.targeting, ...(params.placements ?? {}) };

  const body = await metaPost(`${graphBase()}/${adAccountId}/adsets`, {
    name: params.name,
    campaign_id: params.campaignId,
    ...(params.dailyBudgetCents !== undefined ? { daily_budget: params.dailyBudgetCents } : {}),
    ...(params.lifetimeBudgetCents !== undefined ? { lifetime_budget: params.lifetimeBudgetCents } : {}),
    billing_event: params.billingEvent,
    optimization_goal: params.optimizationGoal,
    ...(params.startTime ? { start_time: params.startTime } : {}),
    ...(params.endTime ? { end_time: params.endTime } : {}),
    targeting,
    status: params.status,
    ...(params.pixelId && params.promotedObject
      ? { promoted_object: { pixel_id: params.pixelId, ...params.promotedObject } }
      : params.promotedObject
        ? { promoted_object: params.promotedObject }
        : {}),
    access_token: accessToken,
  });
  return { id: body.id };
}

/**
 * Meta fetches the media itself from a public URL rather than us uploading
 * raw bytes — Brandthread's object storage already serves media over HTTPS,
 * so this avoids implementing binary multipart upload entirely. Assumption:
 * the object storage download URL is publicly fetchable (or at least
 * fetchable by Meta's crawler) for the duration of the upload call.
 */
export async function uploadAdImage(
  accessToken: string,
  adAccountId: string,
  params: { sourceUrl: string },
): Promise<{ imageHash: string }> {
  const body = await metaPost(`${graphBase()}/${adAccountId}/adimages`, {
    url: params.sourceUrl,
    access_token: accessToken,
  });
  // Response shape: { images: { bytes: { hash, url, ... } } }
  const firstKey = Object.keys(body.images ?? {})[0];
  const hash = firstKey ? body.images[firstKey].hash : undefined;
  if (!hash) {
    throw new MetaGraphError({
      message: "Meta did not return an image hash",
      status: 502,
      userMessage: "Meta could not process this image — please try a different file.",
    });
  }
  return { imageHash: hash };
}

export async function uploadAdVideo(
  accessToken: string,
  adAccountId: string,
  params: { sourceUrl: string },
): Promise<{ videoId: string }> {
  const body = await metaPost(`${graphBase()}/${adAccountId}/advideos`, {
    file_url: params.sourceUrl,
    access_token: accessToken,
  });
  return { videoId: body.id };
}

export interface CreateAdCreativeParams {
  name: string;
  pageId: string;
  instagramActorId?: string;
  primaryText?: string;
  headline?: string;
  ctaType: string; // e.g. "SHOP_NOW"
  destinationUrl: string;
  imageHash?: string;
  videoId?: string;
}

export async function createAdCreative(
  accessToken: string,
  adAccountId: string,
  params: CreateAdCreativeParams,
): Promise<{ id: string }> {
  const linkData = params.videoId
    ? undefined
    : {
        message: params.primaryText,
        link: params.destinationUrl,
        name: params.headline,
        image_hash: params.imageHash,
        call_to_action: { type: params.ctaType, value: { link: params.destinationUrl } },
      };
  const videoData = params.videoId
    ? {
        video_id: params.videoId,
        message: params.primaryText,
        title: params.headline,
        call_to_action: { type: params.ctaType, value: { link: params.destinationUrl } },
      }
    : undefined;

  const objectStorySpec: Record<string, unknown> = {
    page_id: params.pageId,
    ...(params.instagramActorId ? { instagram_actor_id: params.instagramActorId } : {}),
    ...(linkData ? { link_data: linkData } : {}),
    ...(videoData ? { video_data: videoData } : {}),
  };

  const body = await metaPost(`${graphBase()}/${adAccountId}/adcreatives`, {
    name: params.name,
    object_story_spec: objectStorySpec,
    access_token: accessToken,
  });
  return { id: body.id };
}

export async function createAd(
  accessToken: string,
  adAccountId: string,
  params: { name: string; adsetId: string; creativeId: string; status: "PAUSED" | "ACTIVE" },
): Promise<{ id: string }> {
  const body = await metaPost(`${graphBase()}/${adAccountId}/ads`, {
    name: params.name,
    adset_id: params.adsetId,
    creative: { creative_id: params.creativeId },
    status: params.status,
    access_token: accessToken,
  });
  return { id: body.id };
}

// ─── Previews ───────────────────────────────────────────────────────────────

export async function getAdPreviews(
  accessToken: string,
  params: { creativeId: string; adFormat: string },
): Promise<Array<{ html: string }>> {
  const url = `${graphBase()}/${params.creativeId}/previews?${qs({
    ad_format: params.adFormat,
    access_token: accessToken,
  })}`;
  const body = await metaGet(url, "metaGraph.getAdPreviews");
  return (body.data ?? []).map((p: any) => ({ html: p.body }));
}

/**
 * Generates a preview from an inline creative spec, without persisting an
 * ad creative object on the ad account — used for the draft "preview" screen
 * before the seller has launched anything.
 */
export async function generatePreviews(
  accessToken: string,
  adAccountId: string,
  creativeSpec: Record<string, unknown>,
  adFormat: string,
): Promise<Array<{ html: string }>> {
  const url = `${graphBase()}/${adAccountId}/generatepreviews?${qs({
    creative: JSON.stringify(creativeSpec),
    ad_format: adFormat,
    access_token: accessToken,
  })}`;
  const body = await metaGet(url, "metaGraph.generatePreviews");
  return (body.data ?? []).map((p: any) => ({ html: p.body }));
}

// ─── Status / lifecycle ─────────────────────────────────────────────────────

export async function updateCampaignStatus(
  accessToken: string,
  campaignId: string,
  status: "ACTIVE" | "PAUSED",
): Promise<void> {
  await metaPost(`${graphBase()}/${campaignId}`, { status, access_token: accessToken });
}

export async function updateAdSetBudget(
  accessToken: string,
  adSetId: string,
  params: { dailyBudgetCents?: number; lifetimeBudgetCents?: number; endTime?: string },
): Promise<void> {
  await metaPost(`${graphBase()}/${adSetId}`, {
    ...(params.dailyBudgetCents !== undefined ? { daily_budget: params.dailyBudgetCents } : {}),
    ...(params.lifetimeBudgetCents !== undefined ? { lifetime_budget: params.lifetimeBudgetCents } : {}),
    ...(params.endTime ? { end_time: params.endTime } : {}),
    access_token: accessToken,
  });
}

const SIMPLIFIED_STATUS_MAP: Record<string, string> = {
  ACTIVE: "active",
  PAUSED: "paused",
  DELETED: "archived",
  ARCHIVED: "archived",
  PENDING_REVIEW: "in_review",
  DISAPPROVED: "rejected",
  PREAPPROVED: "in_review",
  PENDING_BILLING_INFO: "in_review",
  CAMPAIGN_PAUSED: "paused",
  ADSET_PAUSED: "paused",
  IN_PROCESS: "in_review",
  WITH_ISSUES: "active",
};

export async function getCampaignEffectiveStatus(
  accessToken: string,
  campaignId: string,
): Promise<{ status: string; reviewFeedback?: string }> {
  const url = `${graphBase()}/${campaignId}?${qs({
    fields: "effective_status,issues_info",
    access_token: accessToken,
  })}`;
  const body = await metaGet(url, "metaGraph.getCampaignEffectiveStatus");
  const effective = body.effective_status as string | undefined;
  const issues = Array.isArray(body.issues_info) ? body.issues_info : [];
  const reviewFeedback = issues.length > 0
    ? issues.map((i: any) => i.error_summary ?? i.error_message).filter(Boolean).join("; ")
    : undefined;
  return {
    status: (effective && SIMPLIFIED_STATUS_MAP[effective]) || "in_review",
    reviewFeedback,
  };
}

// ─── Insights ───────────────────────────────────────────────────────────────

export interface CampaignInsights {
  spendCents: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpcCents: number | null;
  purchases: number;
  purchaseValueCents: number;
  roas: number | null;
}

function sumActionValue(actions: any[] | undefined, actionTypes: string[]): number {
  if (!Array.isArray(actions)) return 0;
  return actions
    .filter((a) => actionTypes.includes(a.action_type))
    .reduce((sum, a) => sum + (Number(a.value) || 0), 0);
}

export async function getInsights(accessToken: string, campaignId: string): Promise<CampaignInsights> {
  const url = `${graphBase()}/${campaignId}/insights?${qs({
    fields: "spend,impressions,reach,clicks,ctr,cpc,actions,action_values",
    access_token: accessToken,
  })}`;
  const body = await metaGet(url, "metaGraph.getInsights");
  const row = body.data?.[0] ?? {};

  const spendDollars = Number(row.spend) || 0;
  const spendCents = Math.round(spendDollars * 100);
  const cpcDollars = row.cpc !== undefined ? Number(row.cpc) : null;
  const purchaseTypes = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];
  const purchases = Math.round(sumActionValue(row.actions, purchaseTypes));
  const purchaseValueDollars = sumActionValue(row.action_values, purchaseTypes);
  const purchaseValueCents = Math.round(purchaseValueDollars * 100);

  return {
    spendCents,
    impressions: Number(row.impressions) || 0,
    reach: Number(row.reach) || 0,
    clicks: Number(row.clicks) || 0,
    ctr: Number(row.ctr) || 0,
    cpcCents: cpcDollars !== null ? Math.round(cpcDollars * 100) : null,
    purchases,
    purchaseValueCents,
    roas: spendCents > 0 ? purchaseValueCents / spendCents : null,
  };
}

// ─── Conversions API ────────────────────────────────────────────────────────

/**
 * Sends a single server-side event via the Conversions API. `userData` must
 * already contain any PII (em/ph) pre-hashed with SHA-256 by the caller —
 * this file makes no assumptions about how the caller sources or hashes that
 * data, to keep it free of PII-handling logic.
 */
export async function sendConversionEvent(
  accessToken: string,
  pixelId: string,
  params: {
    eventName: string;
    eventId: string;
    eventTime: number; // unix seconds
    eventSourceUrl?: string;
    userData: {
      em?: string; // pre-hashed
      ph?: string; // pre-hashed
      client_ip_address?: string;
      client_user_agent?: string;
      fbc?: string;
      fbp?: string;
    };
    customData?: Record<string, unknown>;
  },
): Promise<{ eventsReceived: number }> {
  const body = await metaPost(`${graphBase()}/${pixelId}/events`, {
    data: [
      {
        event_name: params.eventName,
        event_time: params.eventTime,
        event_id: params.eventId,
        action_source: "website",
        ...(params.eventSourceUrl ? { event_source_url: params.eventSourceUrl } : {}),
        user_data: params.userData,
        ...(params.customData ? { custom_data: params.customData } : {}),
      },
    ],
    access_token: accessToken,
  });
  return { eventsReceived: body.events_received ?? 0 };
}
