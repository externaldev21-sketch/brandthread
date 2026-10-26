#!/usr/bin/env node
/**
 * Seeds the demo feed's streetwear clips (scripts/street-demo-media.manifest.json)
 * into the same places the runway clips live (lib/demoMedia.ts):
 *   public/demo-media/<slug>.mp4   720x1280 H.264, muted, <=10 s, faststart
 *   assets/videos/<slug>.jpg       720x1280 poster (first second)
 *
 *   PEXELS_API_KEY=... node scripts/seed-street-demo-media.mjs
 *       Resolves each manifest query to a portrait Pexels clip (or reuses the
 *       pinned `pexelsId`), downloads it, transcodes it and pins the choice.
 *   node scripts/seed-street-demo-media.mjs --from-dir=<dir>
 *       Transcodes local files named <slug>.<ext> instead (no network).
 *
 * Also writes .store-screenshots/street-demo-contact.jpg — look at it for
 * logos or other people's brand marks before committing the output.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(import.meta.dirname, '..');
const MANIFEST = path.join(MOBILE_ROOT, 'scripts/street-demo-media.manifest.json');
const VIDEO_DIR = path.join(MOBILE_ROOT, 'public/demo-media');
const POSTER_DIR = path.join(MOBILE_ROOT, 'assets/videos');
const WORK = path.join(MOBILE_ROOT, '.store-screenshots/street-demo-media');
const fromDirArg = process.argv.find((a) => a.startsWith('--from-dir='));
const FROM_DIR = fromDirArg ? path.resolve(fromDirArg.slice('--from-dir='.length)) : null;
const KEY = process.env.PEXELS_API_KEY;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr.toString().slice(-600)}`);
  return r.stdout.toString();
}

async function pexels(pathAndQuery) {
  const res = await fetch(`https://api.pexels.com${pathAndQuery}`, { headers: { Authorization: KEY } });
  if (!res.ok) throw new Error(`Pexels ${res.status} for ${pathAndQuery}`);
  return res.json();
}

/** The smallest portrait rendition that is still at least 1280 px tall. */
function pickFile(video) {
  const portrait = (video.video_files ?? []).filter((f) => f.height > f.width && f.file_type === 'video/mp4');
  portrait.sort((a, b) => a.height - b.height);
  return portrait.find((f) => f.height >= 1280) ?? portrait.at(-1) ?? null;
}

async function resolveClip(clip, taken) {
  if (clip.pexelsId) return pexels(`/videos/videos/${clip.pexelsId}`);
  const found = await pexels(`/videos/search?${new URLSearchParams({ query: clip.query, orientation: 'portrait', size: 'medium', per_page: '15' })}`);
  const video = found.videos?.find((v) => !taken.has(v.id) && v.height > v.width && v.duration >= 5 && pickFile(v));
  if (!video) throw new Error(`No portrait Pexels clip for "${clip.query}"`);
  return video;
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download ${res.status}: ${url}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

function transcode(input, slug) {
  const video = path.join(VIDEO_DIR, `${slug}.mp4`);
  const poster = path.join(POSTER_DIR, `${slug}.jpg`);
  const fit = 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30';
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-t', '10', '-an', '-vf', fit,
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '26', '-preset', 'slow', '-movflags', '+faststart', video]);
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.5', '-i', video, '-frames:v', '1', '-q:v', '3', poster]);
  return { video, poster };
}

async function main() {
  if (!FROM_DIR && !KEY) throw new Error('Set PEXELS_API_KEY (free at pexels.com/api) or pass --from-dir=<dir>.');
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const taken = new Set(manifest.clips.map((c) => c.pexelsId).filter(Boolean));
  const posters = [];
  for (const clip of manifest.clips) {
    let input;
    if (FROM_DIR) {
      const name = readdirSync(FROM_DIR).find((f) => path.parse(f).name === clip.slug);
      if (!name) throw new Error(`No ${clip.slug}.* in ${FROM_DIR}`);
      input = path.join(FROM_DIR, name);
    } else {
      const video = await resolveClip(clip, taken);
      taken.add(video.id);
      input = path.join(WORK, `${clip.slug}.source.mp4`);
      await download(pickFile(video).link, input);
      Object.assign(clip, { pexelsId: video.id, pexelsUrl: video.url, creator: video.user?.name ?? null });
    }
    const { video, poster } = transcode(input, clip.slug);
    posters.push(poster);
    console.log(`${clip.slug}: ${clip.pexelsUrl ?? input} -> ${path.relative(MOBILE_ROOT, video)}`);
  }
  if (!FROM_DIR) writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  const sheet = path.join(MOBILE_ROOT, '.store-screenshots/street-demo-contact.jpg');
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...posters.flatMap((p) => ['-i', p]),
    '-filter_complex', `${posters.map((_, i) => `[${i}]scale=240:426[s${i}]`).join(';')};${posters.map((_, i) => `[s${i}]`).join('')}hstack=inputs=${posters.length}`,
    sheet]);
  console.log(`Contact sheet: ${path.relative(MOBILE_ROOT, sheet)} — check it for logos before committing.`);
}

if (!existsSync(VIDEO_DIR)) mkdirSync(VIDEO_DIR, { recursive: true });
main().catch((error) => { console.error(error.message ?? error); process.exit(1); });
