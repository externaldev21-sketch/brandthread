/**
 * Database side of automatic media screening: run a verdict over a set of
 * media refs, persist held/rejected results (no raw images), and put them in
 * the moderation queue. Pure screening logic lives in mediaModeration.ts.
 */
import { randomUUID } from "node:crypto";
import { db, mediaModerationResults, reports } from "@workspace/db";
import { logger } from "./logger";
import {
  MEDIA_CATEGORY_TO_REPORT_REASON,
  screenImageUrl,
  screenVideo,
  worstVerdict,
  type MediaVerdict,
} from "./mediaModeration";
import type { ReportTargetType } from "./safety";
import { notifyModerators } from "./moderation/alerts";

export interface MediaRefs {
  images?: string[];
  videos?: string[];
  /** Extra hosts (e.g. this API's own host) videos may be downloaded from. */
  extraHosts?: string[];
}

const MAX_IMAGES_PER_ITEM = 10;

/** Screens every ref and returns the strictest verdict. Never throws. */
export async function screenMediaRefs(refs: MediaRefs): Promise<MediaVerdict> {
  const images = [...new Set((refs.images ?? []).filter(Boolean))].slice(0, MAX_IMAGES_PER_ITEM);
  const videos = [...new Set((refs.videos ?? []).filter(Boolean))].slice(0, 3);
  const results = await Promise.all([
    ...images.map((url) => screenImageUrl(url)),
    ...videos.map((url) => screenVideo({ url, extraHosts: refs.extraHosts })),
  ]);
  return worstVerdict(results);
}

/** Private `/objects/...` paths become short-lived signed URLs the provider can fetch. */
export async function signedUrlForObjectPath(path: string): Promise<string> {
  try {
    const { ObjectStorageService } = await import("./objectStorage");
    return await new ObjectStorageService().getObjectEntityDownloadURL(path, 600);
  } catch (err) {
    logger.warn({ err }, "Could not sign media path for screening");
    return path;
  }
}

export function isFlagged(v: MediaVerdict): boolean {
  return v.verdict === "hold" || v.verdict === "reject";
}

async function insertResult(input: {
  targetType: string; targetId: string; ownerId: string; verdict: MediaVerdict; refs: string[]; surface?: string;
}): Promise<void> {
  await db.insert(mediaModerationResults).values({
    targetType: input.targetType,
    targetId: input.targetId,
    ownerId: input.ownerId,
    provider: input.verdict.provider,
    verdict: input.verdict.verdict === "reject" ? "reject" : "hold",
    categories: input.verdict.categories,
    scores: input.verdict.scores,
    maxScore: input.verdict.maxScore,
    framesChecked: input.verdict.framesChecked,
    priority: input.verdict.verdict === "reject" ? "high" : "normal",
    mediaRefs: input.refs.slice(0, 12),
    surface: input.surface ?? null,
  });
}

function reportDescription(v: MediaVerdict): string {
  const cats = v.categories.join(", ") || "none";
  const head = v.verdict === "reject" ? "PRIORITY: HIGH. Blocked automatically" : "Held automatically";
  return `${head} by media screening (${cats}; max score ${v.maxScore.toFixed(2)})${v.unverified ? ". Could not be checked automatically, needs a human look" : ""}.`;
}

/** Record a held item and queue it for moderators. Best-effort: never throws. */
export async function recordHeldMedia(input: {
  targetType: Extract<ReportTargetType, "post" | "video" | "story" | "comment">;
  targetId: string;
  ownerId: string;
  verdict: MediaVerdict;
  refs: string[];
  excerpt: string;
  label: string;
}): Promise<void> {
  try {
    await insertResult({
      targetType: input.targetType === "video" ? "post" : input.targetType,
      targetId: input.targetId, ownerId: input.ownerId, verdict: input.verdict, refs: input.refs,
    });
    const reportId = randomUUID();
    await db.insert(reports).values({
      id: reportId,
      reporterId: "system:auto-filter",
      source: "auto_filter",
      targetType: input.targetType,
      targetId: input.targetId,
      targetOwnerId: input.ownerId,
      targetLabel: input.label,
      contentExcerpt: [input.excerpt, ...input.refs.slice(0, 2)].filter(Boolean).join("\n").slice(0, 1000),
      reason: MEDIA_CATEGORY_TO_REPORT_REASON(input.verdict.categories),
      description: reportDescription(input.verdict),
    });
    notifyModerators({ id: reportId, targetType: input.targetType, reason: MEDIA_CATEGORY_TO_REPORT_REASON(input.verdict.categories), contentExcerpt: input.label, source: "auto_filter" });
  } catch (err) {
    logger.error({ err, targetId: input.targetId }, "Could not queue held media for review");
  }
}

/**
 * A hard-rejected upload never gets a URL, so there is no content to point
 * at: the high-priority report targets the uploader's profile.
 */
export async function recordRejectedUpload(input: {
  ownerId: string; surface: string; verdict: MediaVerdict; refs?: string[];
}): Promise<void> {
  try {
    await insertResult({
      targetType: "upload", targetId: randomUUID(), ownerId: input.ownerId,
      verdict: input.verdict, refs: input.refs ?? [], surface: input.surface,
    });
    const reportId = randomUUID();
    await db.insert(reports).values({
      id: reportId,
      reporterId: "system:auto-filter",
      source: "auto_filter",
      targetType: "profile",
      targetId: input.ownerId,
      targetOwnerId: input.ownerId,
      targetLabel: `Blocked ${input.surface} upload`,
      contentExcerpt: `Blocked ${input.surface} upload (${input.verdict.categories.join(", ")})`,
      reason: MEDIA_CATEGORY_TO_REPORT_REASON(input.verdict.categories),
      description: reportDescription(input.verdict),
    });
    notifyModerators({ id: reportId, targetType: "profile", reason: MEDIA_CATEGORY_TO_REPORT_REASON(input.verdict.categories), contentExcerpt: `Blocked ${input.surface} upload`, source: "auto_filter" });
  } catch (err) {
    logger.error({ err, ownerId: input.ownerId }, "Could not record rejected upload");
  }
}
