/**
 * Automatic screening of uploaded media (images, video frames, text) for the
 * new create paths: posts, stories, DM attachments, avatar/banner/logo.
 *
 * Extends lib/imageModeration.ts (community photos keep their own fail-closed
 * behaviour, untouched) and sits behind the shared OpenAI config
 * (@workspace/integrations-openai-ai-server/config):
 *   OPENAI_API_KEY (+ optional OPENAI_BASE_URL), or the Replit pair
 *   AI_INTEGRATIONS_OPENAI_BASE_URL / AI_INTEGRATIONS_OPENAI_API_KEY
 *   MEDIA_MODERATION_ENABLED  (optional kill switch; "false" | "0" | "off")
 *
 * Verdicts:
 *   allow    nothing flagged
 *   hold     upload accepted but hidden until a moderator reviews it
 *   reject   hard-reject category (sexual/minors, graphic violence…)
 *   skipped  screening is off (no AI env / disabled) — never blocks anything
 *
 * New call sites fail OPEN-TO-HOLD: when screening is on but the provider or
 * frame extraction errors, the verdict is `hold` with category
 * `review_unavailable` so users are not blocked by outages and a human still
 * looks at the item.
 *
 * This module is pure (no database). Persistence lives in
 * mediaModerationStore.ts.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { isOpenAiConfigured } from "@workspace/integrations-openai-ai-server/config";
import { logger } from "./logger";

const exec = promisify(execFile);

export type MediaVerdictKind = "allow" | "hold" | "reject" | "skipped";

export interface MediaVerdict {
  verdict: MediaVerdictKind;
  categories: string[];
  /** Max score per category across every frame/image checked. */
  scores: Record<string, number>;
  maxScore: number;
  framesChecked: number;
  provider: string;
  /** True when the verdict is hold only because the check could not run. */
  unverified?: boolean;
}

export interface FrameScores {
  flags: Record<string, boolean>;
  scores: Record<string, number>;
}

export type FrameInput =
  | { kind: "buffer"; buffer: Buffer; mimeType: string }
  | { kind: "url"; url: string };

export type MediaModerationProvider = (input: FrameInput) => Promise<FrameScores>;
export type TextModerationProvider = (text: string) => Promise<FrameScores>;
export type VideoFrameExtractor = (input: { buffer?: Buffer; url?: string; frames: number }) => Promise<Buffer[]>;

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** Always rejected when the model flags them or the score reaches the reject threshold. */
export const REJECT_THRESHOLDS: Readonly<Record<string, number>> = {
  "sexual/minors": 0.3,
  "violence/graphic": 0.8,
};
/** Sent to the human queue when flagged, or when the score reaches the threshold. */
export const HOLD_THRESHOLDS: Readonly<Record<string, number>> = {
  sexual: 0.5,
  violence: 0.7,
  "self-harm": 0.5,
  "self-harm/intent": 0.4,
  "self-harm/instructions": 0.4,
  hate: 0.6,
  "hate/threatening": 0.4,
  harassment: 0.8,
  "harassment/threatening": 0.5,
  illicit: 0.7,
  "illicit/violent": 0.5,
};
export const VIDEO_FRAME_COUNT = 6;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const UNVERIFIED_CATEGORY = "review_unavailable";

export const MEDIA_HELD_MESSAGE =
  "Your upload is in review. It stays hidden from others until a moderator approves it.";
export const MEDIA_REJECTED_MESSAGE =
  "This photo or video can't be shared in Brandthread. Try a different one.";
export const MEDIA_CATEGORY_TO_REPORT_REASON = (categories: string[]): string => {
  if (categories.some((c) => c.startsWith("sexual"))) return "nudity";
  if (categories.some((c) => c.startsWith("violence") || c.startsWith("self-harm"))) return "violence";
  if (categories.some((c) => c.startsWith("hate"))) return "hate";
  if (categories.some((c) => c.startsWith("harassment"))) return "harassment";
  return "other";
};

// ─── Feature flag & seams ─────────────────────────────────────────────────────

let providerOverride: MediaModerationProvider | null = null;
let textProviderOverride: TextModerationProvider | null = null;
let frameExtractorOverride: VideoFrameExtractor | null = null;

export function setMediaModerationProvider(next?: MediaModerationProvider): void { providerOverride = next ?? null; }
export function setTextModerationProvider(next?: TextModerationProvider): void { textProviderOverride = next ?? null; }
export function setVideoFrameExtractor(next?: VideoFrameExtractor): void { frameExtractorOverride = next ?? null; }

export type MediaModerationStatus =
  | { enabled: true; reason: null }
  | { enabled: false; reason: "kill_switch" | "no_provider" };

/** Whether screening runs, and if not, why. */
export function mediaModerationStatus(env: NodeJS.ProcessEnv = process.env): MediaModerationStatus {
  const flag = (env.MEDIA_MODERATION_ENABLED ?? "").trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "off") return { enabled: false, reason: "kill_switch" };
  if (!isOpenAiConfigured(env)) return { enabled: false, reason: "no_provider" };
  return { enabled: true, reason: null };
}

export function mediaModerationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return mediaModerationStatus(env).enabled;
}

/**
 * Production must never run with screening silently off (App Store guideline
 * 1.2). Logged at error level once at boot and reported as degraded by
 * GET /api/healthz/ready. Returns true when the warning was logged.
 */
export function reportMediaModerationAtBoot(
  env: NodeJS.ProcessEnv = process.env,
  log: Pick<typeof logger, "error" | "info"> = logger,
): boolean {
  const status = mediaModerationStatus(env);
  if (status.enabled) {
    log.info("Media moderation is on: uploaded images and video frames are screened");
    return false;
  }
  if (env.NODE_ENV !== "production") return false;
  log.error(
    { reason: status.reason },
    status.reason === "kill_switch"
      ? "Media moderation is OFF in production (MEDIA_MODERATION_ENABLED is false). Uploaded images and videos are not screened."
      : "Media moderation is OFF in production: set OPENAI_API_KEY (or the Replit AI_INTEGRATIONS_OPENAI_* pair). Uploaded images and videos are not screened.",
  );
  return true;
}

function screeningOn(custom: unknown): boolean {
  return custom ? true : mediaModerationEnabled();
}

const SKIPPED: MediaVerdict = {
  verdict: "skipped", categories: [], scores: {}, maxScore: 0, framesChecked: 0, provider: "none",
};

// ─── Provider (OpenAI omni-moderation) ───────────────────────────────────────

async function callOpenAi(input: unknown): Promise<FrameScores> {
  // Lazy import keeps this module light; the client itself is created on first use.
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const result = await openai.moderations.create({ model: "omni-moderation-latest", input: input as never });
  const first = result.results?.[0];
  if (!first) throw new Error("Empty moderation response");
  return {
    flags: first.categories as unknown as Record<string, boolean>,
    scores: first.category_scores as unknown as Record<string, number>,
  };
}

const openAiMediaProvider: MediaModerationProvider = (input) => {
  const url = input.kind === "url" ? input.url : `data:${input.mimeType};base64,${input.buffer.toString("base64")}`;
  return callOpenAi([{ type: "image_url", image_url: { url } }]);
};
const openAiTextProvider: TextModerationProvider = (text) => callOpenAi(text);

// ─── Aggregation ──────────────────────────────────────────────────────────────

/** Merge per-frame results: flags OR-ed, scores max-ed. */
export function mergeFrames(frames: FrameScores[]): FrameScores {
  const flags: Record<string, boolean> = {};
  const scores: Record<string, number> = {};
  for (const frame of frames) {
    for (const [k, v] of Object.entries(frame.flags ?? {})) if (v) flags[k] = true;
    for (const [k, v] of Object.entries(frame.scores ?? {})) {
      if (typeof v === "number" && v > (scores[k] ?? -1)) scores[k] = v;
    }
  }
  return { flags, scores };
}

export function decide(merged: FrameScores, framesChecked: number, provider: string): MediaVerdict {
  const reject: string[] = [];
  const hold: string[] = [];
  const names = new Set([...Object.keys(merged.flags), ...Object.keys(merged.scores)]);
  for (const name of names) {
    const score = merged.scores[name] ?? 0;
    const flagged = !!merged.flags[name];
    const rejectAt = REJECT_THRESHOLDS[name];
    const holdAt = HOLD_THRESHOLDS[name];
    if (rejectAt !== undefined && (flagged || score >= rejectAt)) reject.push(name);
    else if (holdAt !== undefined && (flagged || score >= holdAt)) hold.push(name);
    else if (flagged && rejectAt === undefined && holdAt === undefined) hold.push(name);
  }
  const maxScore = Math.max(0, ...Object.values(merged.scores));
  const base = { scores: merged.scores, maxScore, framesChecked, provider };
  if (reject.length > 0) return { ...base, verdict: "reject", categories: [...reject, ...hold] };
  if (hold.length > 0) return { ...base, verdict: "hold", categories: hold };
  return { ...base, verdict: "allow", categories: [] };
}

function unverified(provider: string, framesChecked = 0): MediaVerdict {
  return {
    verdict: "hold", categories: [UNVERIFIED_CATEGORY], scores: {}, maxScore: 0,
    framesChecked, provider, unverified: true,
  };
}

/** Strictest verdict wins: reject > hold > allow > skipped. */
export function worstVerdict(results: MediaVerdict[]): MediaVerdict {
  if (results.length === 0) return SKIPPED;
  const rank: Record<MediaVerdictKind, number> = { skipped: 0, allow: 1, hold: 2, reject: 3 };
  const scores: Record<string, number> = {};
  const categories = new Set<string>();
  let worst = results[0];
  let frames = 0;
  for (const r of results) {
    if (rank[r.verdict] > rank[worst.verdict]) worst = r;
    frames += r.framesChecked;
    r.categories.forEach((c) => categories.add(c));
    for (const [k, v] of Object.entries(r.scores)) if (v > (scores[k] ?? -1)) scores[k] = v;
  }
  return {
    verdict: worst.verdict,
    categories: [...categories],
    scores,
    maxScore: Math.max(0, ...Object.values(scores)),
    framesChecked: frames,
    provider: worst.provider,
    ...(results.some((r) => r.unverified) ? { unverified: true } : {}),
  };
}

// ─── Images ───────────────────────────────────────────────────────────────────

async function screenFrames(inputs: FrameInput[]): Promise<MediaVerdict> {
  const provider = providerOverride ?? openAiMediaProvider;
  const name = providerOverride ? "custom" : "openai-omni-moderation";
  try {
    const frames = await Promise.all(inputs.map((input) => provider(input)));
    return decide(mergeFrames(frames), frames.length, name);
  } catch (err) {
    logger.warn({ err }, "Media moderation provider failed; holding for human review");
    return unverified(name);
  }
}

export async function screenImageBuffer(buffer: Buffer, mimeType: string): Promise<MediaVerdict> {
  if (!screeningOn(providerOverride)) return SKIPPED;
  return screenFrames([{ kind: "buffer", buffer, mimeType }]);
}

/** http(s) only; the provider fetches the URL itself, so this server never does. */
export async function screenImageUrl(url: string): Promise<MediaVerdict> {
  if (!screeningOn(providerOverride)) return SKIPPED;
  if (!/^https?:\/\//i.test(url)) return unverified("none");
  return screenFrames([{ kind: "url", url }]);
}

// ─── Video ────────────────────────────────────────────────────────────────────

/** Hosts this server may download video from (SSRF guard). */
export function allowedVideoHosts(extra: string[] = [], env: NodeJS.ProcessEnv = process.env): string[] {
  const fromEnv = (env.MEDIA_MODERATION_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return ["storage.googleapis.com", ...fromEnv, ...extra.map((h) => h.toLowerCase())];
}

export function isAllowedVideoUrl(raw: string, hosts: string[]): boolean {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return false; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "::1" || host.startsWith("[")) {
    return false;
  }
  return hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

async function ffprobeDuration(file: string): Promise<number> {
  try {
    const { stdout } = await exec("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
    ], { timeout: 20_000 });
    const n = parseFloat(String(stdout).trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Offsets (seconds) for N evenly spaced frames, avoiding the very first/last instant. */
export function frameOffsets(durationSeconds: number, frames: number): number[] {
  if (!(durationSeconds > 0) || frames <= 1) return [0];
  return Array.from({ length: frames }, (_, i) => +((durationSeconds * (i + 0.5)) / frames).toFixed(2));
}

/** Default extractor: the `ffmpeg` binary already used by post-video.ts / avatar-video.ts. */
export const ffmpegFrameExtractor: VideoFrameExtractor = async ({ buffer, url, frames }) => {
  const dir = await fs.mkdtemp(join(os.tmpdir(), "mm-frames-"));
  try {
    let source = url ?? "";
    if (buffer) {
      source = join(dir, "input.bin");
      await fs.writeFile(source, buffer);
    } else if (url) {
      const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`Video fetch failed (${res.status})`);
      const length = Number(res.headers.get("content-length") ?? 0);
      if (length > MAX_VIDEO_BYTES) throw new Error("Video too large to screen");
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_VIDEO_BYTES) throw new Error("Video too large to screen");
      source = join(dir, "input.bin");
      await fs.writeFile(source, bytes);
    }
    const duration = await ffprobeDuration(source);
    const out: Buffer[] = [];
    for (const [i, offset] of frameOffsets(duration, frames).entries()) {
      const target = join(dir, `f${i}.jpg`);
      await exec("ffmpeg", [
        "-y", "-ss", String(offset), "-i", source, "-frames:v", "1",
        "-vf", "scale='min(512,iw)':-2", "-q:v", "5", target,
      ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
      out.push(await fs.readFile(target));
    }
    if (out.length === 0) throw new Error("No frames extracted");
    return out;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};

/**
 * Samples VIDEO_FRAME_COUNT frames and aggregates with max-score. Remote URLs
 * are only downloaded from allowed hosts (storage + MEDIA_MODERATION_ALLOWED_HOSTS
 * + `extraHosts`); anything else is held as unverified.
 */
export async function screenVideo(
  source: { url: string; extraHosts?: string[] } | { buffer: Buffer },
): Promise<MediaVerdict> {
  if (!screeningOn(providerOverride)) return SKIPPED;
  const name = providerOverride ? "custom" : "openai-omni-moderation";
  try {
    if ("url" in source && !isAllowedVideoUrl(source.url, allowedVideoHosts(source.extraHosts))) {
      return unverified(name);
    }
    const extractor = frameExtractorOverride ?? ffmpegFrameExtractor;
    const buffers = await extractor({
      ...("url" in source ? { url: source.url } : { buffer: source.buffer }),
      frames: VIDEO_FRAME_COUNT,
    });
    return await screenFrames(buffers.map((buffer) => ({ kind: "buffer", buffer, mimeType: "image/jpeg" as const })));
  } catch (err) {
    logger.warn({ err }, "Video frame sampling failed; holding for human review");
    return unverified(name);
  }
}

// ─── Text (second layer after contentModerator) ──────────────────────────────

/**
 * OpenAI text moderation. Only hold/allow from this layer, except sexual/minors
 * which rejects. Provider errors allow (contentModerator already ran) so an
 * outage cannot hold every post.
 */
export async function screenText(text: string): Promise<MediaVerdict> {
  if (!screeningOn(textProviderOverride)) return SKIPPED;
  const trimmed = text.trim();
  if (!trimmed) return { ...SKIPPED, verdict: "allow" };
  try {
    const result = await (textProviderOverride ?? openAiTextProvider)(trimmed.slice(0, 8000));
    const decided = decide(mergeFrames([result]), 1, textProviderOverride ? "custom" : "openai-omni-moderation");
    // Text: only minors-sexualisation is a hard reject here; the rest goes to a human.
    if (decided.verdict === "reject" && !decided.categories.includes("sexual/minors")) {
      return { ...decided, verdict: "hold" };
    }
    return decided;
  } catch (err) {
    logger.warn({ err }, "Text moderation provider failed; allowing (contentModerator already applied)");
    return { ...SKIPPED, verdict: "allow", provider: "openai-omni-moderation" };
  }
}
