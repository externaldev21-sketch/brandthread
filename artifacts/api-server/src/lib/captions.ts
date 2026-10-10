/**
 * Auto captions (subtitles) for video posts.
 *
 * Pipeline: composed video (object storage) -> ffmpeg mono 16 kHz mp3 -> OpenAI
 * Whisper (verbose_json segments) -> moderation -> WebVTT + JSON segments in
 * `post_captions`. Everything is gated by the `autoCaptions` feature flag AND
 * the OpenAI integration env keys; the OpenAI client is imported lazily so a
 * server without the keys never crashes.
 */
import { execFile } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { isOpenAiConfigured } from "@workspace/integrations-openai-ai-server/config";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool, posts, postCaptions, type CaptionSegment } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { evaluateContent } from "./contentModerator";
import { logger } from "./logger";

const exec = promisify(execFile);

export const CAPTION_LANGUAGE_DEFAULT = "en";
export const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 15 * 60;
export const MAX_SEGMENTS = 1500;
export const MAX_SEGMENT_TEXT = 500;
const STALE_PENDING_MS = 10 * 60_000;
const FLAG_CACHE_MS = 30_000;

// ─── Gating ───────────────────────────────────────────────────────────────────

export function captionsEnvConfigured(): boolean {
  return isOpenAiConfigured();
}

let flagCache: { value: boolean; at: number } | null = null;

export function resetCaptionsFlagCache(): void {
  flagCache = null;
}

async function captionsFlagEnabled(): Promise<boolean> {
  if (flagCache && Date.now() - flagCache.at < FLAG_CACHE_MS) return flagCache.value;
  let value = false;
  try {
    const result = await pool.query<{ enabled: boolean }>(
      "SELECT enabled FROM feature_flags WHERE key = 'autoCaptions' LIMIT 1",
    );
    value = result.rows[0]?.enabled === true;
  } catch (err) {
    logger.warn({ err }, "Could not read autoCaptions flag; treating as off");
  }
  flagCache = { value, at: Date.now() };
  return value;
}

/** True only when the flag is on AND the AI env keys exist. Never throws. */
export async function captionsAvailable(): Promise<boolean> {
  if (!captionsEnvConfigured()) return false;
  return captionsFlagEnabled();
}

// ─── VTT ──────────────────────────────────────────────────────────────────────

export function formatVttTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60_000) % 60;
  const h = Math.floor(total / 3_600_000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

export function segmentsToVtt(segments: CaptionSegment[]): string {
  const cues = segments.map((segment, index) =>
    `${index + 1}\n${formatVttTime(segment.start)} --> ${formatVttTime(segment.end)}\n${segment.text}`);
  return `WEBVTT\n\n${cues.join("\n\n")}${cues.length ? "\n" : ""}`;
}

/** Collapse whitespace, strip cue-breaking markers, cap length. */
export function cleanCaptionText(text: string): string {
  return text
    .replace(/[<>&]/g, (c) => (c === "<" ? "‹" : c === ">" ? "›" : "+"))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEGMENT_TEXT);
}

/** Whisper segments -> clean, ordered, non-overlapping caption segments. */
export function normalizeWhisperSegments(
  raw: Array<{ start?: number; end?: number; text?: string }>,
): CaptionSegment[] {
  const out: CaptionSegment[] = [];
  let cursor = 0;
  for (const item of raw.slice(0, MAX_SEGMENTS)) {
    const text = cleanCaptionText(String(item.text ?? ""));
    const start = Number(item.start);
    const end = Number(item.end);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    const s = Math.max(start, cursor);
    const e = Math.max(end, s + 0.2);
    out.push({ start: Math.round(s * 1000) / 1000, end: Math.round(e * 1000) / 1000, text });
    cursor = e;
  }
  return out;
}

/**
 * Drop any segment the public-surface moderator would not allow. Returns the
 * kept segments and how many were skipped.
 */
export function moderateSegments(segments: CaptionSegment[]): { kept: CaptionSegment[]; skipped: number } {
  const kept = segments.filter((segment) => evaluateContent(segment.text, "public").action === "allow");
  return { kept, skipped: segments.length - kept.length };
}

const LANGUAGE_CODES: Record<string, string> = {
  english: "en", spanish: "es", french: "fr", german: "de", italian: "it", portuguese: "pt",
  dutch: "nl", russian: "ru", japanese: "ja", korean: "ko", chinese: "zh", arabic: "ar",
  hindi: "hi", turkish: "tr", polish: "pl", swedish: "sv", indonesian: "id", vietnamese: "vi",
  thai: "th", ukrainian: "uk", greek: "el", hebrew: "he",
};

export function languageCode(whisperLanguage: string | undefined): string {
  const value = (whisperLanguage ?? "").trim().toLowerCase();
  if (!value) return CAPTION_LANGUAGE_DEFAULT;
  if (/^[a-z]{2,3}$/.test(value)) return value;
  return LANGUAGE_CODES[value] ?? CAPTION_LANGUAGE_DEFAULT;
}

// ─── Media ────────────────────────────────────────────────────────────────────

function composedObjectPath(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const pathname = new URL(value, "https://brandthread.invalid").pathname;
    const marker = "/api/posts/media/";
    const index = pathname.indexOf(marker);
    if (index < 0) return null;
    const suffix = decodeURIComponent(pathname.slice(index + marker.length));
    if (!suffix || suffix.includes("..")) return null;
    return `/objects/${suffix.replace(/^\/+/, "")}`;
  } catch {
    return null;
  }
}

async function downloadVideo(post: { mediaUrl: string; mediaUrls: string[] }, target: string): Promise<void> {
  const objectPath = composedObjectPath(post.mediaUrl) ?? composedObjectPath(post.mediaUrls?.[0]);
  if (!objectPath) throw new Error("Video is not stored in Brandthread media");
  const storage = new ObjectStorageService();
  const file = await storage.getObjectEntityFile(objectPath);
  const [metadata] = await file.getMetadata();
  if (Number(metadata.size ?? 0) > MAX_VIDEO_BYTES) throw new Error("Video is too large to caption");
  await pipeline(file.createReadStream(), createWriteStream(target));
}

/** Mono 16 kHz mp3 at 32 kbps (~14 MB/hour), refusing overlong or oversized results. */
export async function extractAudio(videoPath: string, audioPath: string): Promise<void> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", videoPath,
  ], { timeout: 15_000 });
  const seconds = Number.parseFloat(String(stdout).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Invalid video duration");
  if (seconds > MAX_DURATION_SECONDS) throw new Error("Video is too long to caption");
  await exec("ffmpeg", [
    "-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000",
    "-c:a", "libmp3lame", "-b:a", "32k", audioPath,
  ], { timeout: 120_000, maxBuffer: 1024 * 1024 });
  const { size } = await fs.stat(audioPath);
  if (size <= 0) throw new Error("Video has no audio track");
  if (size > MAX_AUDIO_BYTES) throw new Error("Audio is too large to transcribe");
}

export interface TranscriptionResult {
  language: string;
  segments: Array<{ start: number; end: number; text: string }>;
}

/** Calls Whisper for segment timestamps. The OpenAI client is imported lazily. */
export async function transcribeAudio(audio: Buffer): Promise<TranscriptionResult> {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const file = new File([new Uint8Array(audio)], "audio.mp3", { type: "audio/mpeg" });
  const response = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  }) as unknown as { language?: string; segments?: TranscriptionResult["segments"] };
  return { language: response.language ?? "", segments: response.segments ?? [] };
}

// ─── Orchestration ────────────────────────────────────────────────────────────

const inFlight = new Set<string>();

async function setFailed(postId: string, language: string, error: string): Promise<void> {
  await db.insert(postCaptions).values({ postId, language, status: "failed", error })
    .onConflictDoUpdate({
      target: [postCaptions.postId, postCaptions.language],
      set: { status: "failed", error, updatedAt: new Date() },
    });
}

/**
 * Generate the caption track for a video post. Never throws: failures are
 * stored as status 'failed'. Deduplicated in-process and through the row state
 * (a pending row younger than 10 minutes or a ready row is left alone unless
 * `force`).
 */
export async function generateCaptionsForPost(
  postId: string,
  opts: { force?: boolean } = {},
): Promise<{ started: boolean }> {
  if (inFlight.has(postId)) return { started: false };
  inFlight.add(postId);
  const workDir = join(tmpdir(), `captions-${randomUUID()}`);
  let language = CAPTION_LANGUAGE_DEFAULT;
  try {
    const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
    if (!post || post.mediaType !== "video") return { started: false };

    const existing = await db.select().from(postCaptions).where(eq(postCaptions.postId, postId));
    if (!opts.force) {
      const fresh = existing.some((row) =>
        row.status === "ready" ||
        (row.status === "pending" && Date.now() - row.updatedAt.getTime() < STALE_PENDING_MS));
      if (fresh) return { started: false };
    }
    // Manual edits are never overwritten by an automatic run.
    if (existing.some((row) => row.source === "manual" && row.status === "ready") && !opts.force) {
      return { started: false };
    }

    await db.insert(postCaptions).values({ postId, language, status: "pending" })
      .onConflictDoUpdate({
        target: [postCaptions.postId, postCaptions.language],
        set: { status: "pending", error: null, updatedAt: new Date() },
      });

    await fs.mkdir(workDir, { recursive: true });
    const videoPath = join(workDir, "video");
    const audioPath = join(workDir, "audio.mp3");
    await downloadVideo(post, videoPath);
    await extractAudio(videoPath, audioPath);
    const transcription = await transcribeAudio(await fs.readFile(audioPath));
    const detected = languageCode(transcription.language);

    const segments = normalizeWhisperSegments(transcription.segments);
    const { kept, skipped } = moderateSegments(segments);
    if (kept.length === 0) {
      await setFailed(postId, language, segments.length === 0 ? "No speech detected" : "Captions were withheld by moderation");
      return { started: true };
    }
    if (detected !== language) {
      // Move the pending placeholder to the detected language.
      await db.delete(postCaptions).where(and(eq(postCaptions.postId, postId), eq(postCaptions.language, language)));
      language = detected;
    }
    await db.insert(postCaptions).values({
      postId, language, status: "ready", vtt: segmentsToVtt(kept), segments: kept,
      source: "whisper", error: skipped > 0 ? `${skipped} segment(s) withheld by moderation` : null,
    }).onConflictDoUpdate({
      target: [postCaptions.postId, postCaptions.language],
      set: {
        status: "ready", vtt: segmentsToVtt(kept), segments: kept, source: "whisper",
        error: skipped > 0 ? `${skipped} segment(s) withheld by moderation` : null, updatedAt: new Date(),
      },
    });
    return { started: true };
  } catch (err) {
    logger.warn({ err, postId }, "Caption generation failed");
    await setFailed(postId, language, err instanceof Error ? err.message.slice(0, 200) : "Caption generation failed")
      .catch(() => {});
    return { started: true };
  } finally {
    inFlight.delete(postId);
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Fire-and-forget hook for a freshly published video post. No-op unless available. */
export function scheduleAutoCaptions(postId: string): void {
  void (async () => {
    if (!(await captionsAvailable())) return;
    await generateCaptionsForPost(postId);
  })().catch((err) => logger.warn({ err, postId }, "Auto caption hook failed"));
}
