import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { eq, inArray } from "drizzle-orm";
import { db, posts, users } from "@workspace/db";
import {
  ensureVideoPoster, mediaOrigin, objectPathFromMediaUrl, posterFfmpegArgs, runVideoPosterBackfill, type PosterDeps,
} from "../videoPoster";

const exec = promisify(execFile);
const suffix = crypto.randomBytes(5).toString("hex");
const author = `vp-brandthread-${suffix}`;
const createdPostIds: string[] = [];
let sampleVideo = "";
let workDir = "";

/** In-memory object storage double; `download` copies the real sample video. */
function fakeStorage() {
  const saved = new Map<string, Buffer>();
  const acl = new Map<string, unknown>();
  const storage: NonNullable<PosterDeps["storage"]> = {
    getObjectEntityFile: (async () => ({ download: async ({ destination }: { destination: string }) => fs.copyFile(sampleVideo, destination) })) as any,
    createObjectEntityFromBuffer: async (buf: Buffer) => {
      const path = `/objects/uploads/poster-${saved.size}-${suffix}`;
      saved.set(path, buf);
      return path;
    },
    trySetObjectEntityAclPolicy: async (path: string, policy: unknown) => { acl.set(path, policy); return path; },
  };
  return { storage, saved, acl };
}

async function seedVideo(mediaUrl: string, thumbnailUrl: string | null = null) {
  const [row] = await db.insert(posts).values({
    userId: author, mediaUrl, mediaUrls: [], mediaType: "video", thumbnailUrl, postStatus: "published", caption: "seed video",
  }).returning();
  createdPostIds.push(row.id);
  return row;
}

beforeAll(async () => {
  workDir = await fs.mkdtemp(join(tmpdir(), "vp-test-"));
  sampleVideo = join(workDir, "sample.mp4");
  // A real 1s clip so the ffmpeg path is exercised end to end.
  await exec("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=720x1280:rate=24", "-t", "1", "-pix_fmt", "yuv420p", sampleVideo]);
  await db.insert(users).values({ clerkId: author, email: `${author}@t.local`, name: "Brandthread", username: author.replace(/-/g, "_"), role: "seller", accountType: "seller" });
});

afterAll(async () => {
  if (createdPostIds.length > 0) await db.delete(posts).where(inArray(posts.id, createdPostIds));
  await db.delete(users).where(eq(users.clerkId, author));
  await fs.rm(workDir, { recursive: true, force: true });
});

describe("videoPoster helpers", () => {
  it("parses /api/posts/media URLs", () => {
    expect(objectPathFromMediaUrl("https://api.x/api/posts/media/uploads/abc")).toBe("/objects/uploads/abc");
    expect(objectPathFromMediaUrl("https://cdn.x/v.mp4")).toBeNull();
    expect(objectPathFromMediaUrl("https://api.x/api/posts/media/../etc")).toBeNull();
    expect(mediaOrigin("https://api.x/api-server/api/posts/media/uploads/abc")).toBe("https://api.x/api-server");
  });

  it("asks ffmpeg for one small frame past any fade-in", () => {
    const args = posterFfmpegArgs("in.mp4", "out.jpg");
    expect(args).toEqual(expect.arrayContaining(["-ss", "0.5", "-frames:v", "1"]));
    expect(args.join(" ")).toContain("scale='min(540,iw)':-2");
  });
});

describe("ensureVideoPoster", () => {
  it("generates a real JPEG poster from storage media, stores it public, and fills thumbnail_url", async () => {
    const post = await seedVideo(`https://api.test/api/posts/media/uploads/vid-${suffix}`);
    const { storage, saved, acl } = fakeStorage();
    const url = await ensureVideoPoster(post, { storage });
    expect(url).toMatch(/^https:\/\/api\.test\/api\/posts\/media\/uploads\/poster-0-/);
    const [jpeg] = [...saved.values()];
    expect(jpeg.subarray(0, 2).toString("hex")).toBe("ffd8"); // JPEG SOI marker
    expect([...acl.values()][0]).toEqual({ owner: author, visibility: "public" });
    const [row] = await db.select({ thumbnailUrl: posts.thumbnailUrl }).from(posts).where(eq(posts.id, post.id));
    expect(row.thumbnailUrl).toBe(url);
  });

  it("leaves posts that already have a poster (or are not videos) alone", async () => {
    const post = await seedVideo("https://api.test/api/posts/media/uploads/x", "https://img.test/existing.jpg");
    const { storage, saved } = fakeStorage();
    expect(await ensureVideoPoster(post, { storage })).toBe("https://img.test/existing.jpg");
    expect(saved.size).toBe(0);
  });

  it("returns null (never throws) when ffmpeg fails", async () => {
    const post = await seedVideo(`https://api.test/api/posts/media/uploads/broken-${suffix}`);
    const { storage } = fakeStorage();
    const url = await ensureVideoPoster(post, { storage, exec: async () => { throw new Error("boom"); } });
    expect(url).toBeNull();
  });
});

describe("runVideoPosterBackfill", () => {
  it("backfills every video without a poster (incl. external seed URLs via --origin) and is idempotent", async () => {
    const external = await seedVideo(`https://seed.test/brandthread-${suffix}.mp4`);
    const { storage } = fakeStorage();
    // External URLs are read by ffmpeg directly; point it at the local sample instead of the network.
    const exec2: PosterDeps["exec"] = async (file, args, opts) => {
      const patched = args.map((a) => (a.startsWith("https://seed.test/") ? sampleVideo : a));
      return exec(file, patched, opts);
    };
    const dry = await runVideoPosterBackfill({ dryRun: true }, { storage, exec: exec2, origin: "https://api.test" });
    expect(dry.scanned).toBeGreaterThanOrEqual(1);

    const first = await runVideoPosterBackfill({ origin: "https://api.test" }, { storage, exec: exec2 });
    expect(first.generated).toBeGreaterThanOrEqual(1);
    const [row] = await db.select({ thumbnailUrl: posts.thumbnailUrl }).from(posts).where(eq(posts.id, external.id));
    expect(row.thumbnailUrl).toMatch(/^https:\/\/api\.test\/api\/posts\/media\/uploads\/poster-/);

    const again = await runVideoPosterBackfill({ origin: "https://api.test" }, { storage, exec: exec2 });
    expect(again.scanned).toBe(0);
  });
});
