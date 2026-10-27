/**
 * Hands-on quality gate for the AI image tools, on seeded inputs, writing real
 * outputs for a person to judge (docs/verification/ai-image-tools/).
 *
 *   pnpm --filter @workspace/api-server run verify:ai-image-tools            # everything
 *   pnpm --filter @workspace/api-server run verify:ai-image-tools -- --bg    # background removal only
 *   pnpm --filter @workspace/api-server run verify:ai-image-tools -- --generate
 *
 * Background removal runs the real self-hosted model (downloaded on first run).
 * Mockup to Model and AI Photoshoot call the real image engine; without an
 * image-model key they are reported SKIPPED (exit code 2) — never faked.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { removeBackground, bgModelName } from "../../src/lib/bgRemoval/segmenter";
import { activeImageProvider, generateShot, PREFERRED_IMAGE_KEY } from "../../src/lib/aiImageEngine";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const OUT = path.join(repo, "docs/verification/ai-image-tools");
const ASSETS = path.join(repo, "artifacts/mobile/assets");
const FIX = path.join(here, "fixtures");

const BG_INPUTS = [
  { name: "runway-long-hair", file: path.join(ASSETS, "videos/fashion_runway_09.jpg") },
  { name: "runway-braids-mesh", file: path.join(ASSETS, "videos/fashion_runway_07.jpg") },
  { name: "runway-flyaway-hair", file: path.join(ASSETS, "videos/fashion_runway_05.jpg") },
  { name: "product-boots", file: path.join(ASSETS, "images/products/leather-ankle-boots.jpg") },
];

const PRODUCT = path.join(FIX, "brandthread-logo-tee-mockup.jpg");
const MODEL_REF = path.join(ASSETS, "videos/fashion_runway_03.jpg");
const SCENE_REF = path.join(ASSETS, "videos/fashion_runway_07.jpg");

const args = new Set(process.argv.slice(2));
const runBg = args.size === 0 || args.has("--bg");
const runGen = args.size === 0 || args.has("--generate");

function checker(width: number, height: number, tile = 24): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="c" width="${tile * 2}" height="${tile * 2}" patternUnits="userSpaceOnUse"><rect width="${tile * 2}" height="${tile * 2}" fill="#ffffff"/><rect width="${tile}" height="${tile}" fill="#d6d6d6"/><rect x="${tile}" y="${tile}" width="${tile}" height="${tile}" fill="#d6d6d6"/></pattern></defs><rect width="100%" height="100%" fill="url(#c)"/></svg>`;
  return Buffer.from(svg);
}

/** Original | cutout on checkerboard | on white | on black, side by side. */
async function bgSheet(original: Buffer, cutout: Buffer, out: string) {
  const H = 900;
  const orig = await sharp(original).rotate().resize({ height: H }).toBuffer();
  const { width: W } = await sharp(orig).metadata();
  const cut = await sharp(cutout).resize({ height: H }).toBuffer();
  const panel = async (bg: Buffer | string) => {
    const base = typeof bg === "string"
      ? sharp({ create: { width: W!, height: H, channels: 3, background: bg } })
      : sharp(bg).resize(W!, H);
    return base.composite([{ input: cut }]).jpeg().toBuffer();
  };
  const panels = [orig, await panel(checker(W!, H)), await panel("#ffffff"), await panel("#000000")];
  await sharp({ create: { width: W! * 4 + 30, height: H, channels: 3, background: "#1a1a1a" } })
    .composite(panels.map((input, i) => ({ input, left: i * (W! + 10), top: 0 })))
    .jpeg({ quality: 88 })
    .toFile(out);
}

/** Zoomed edge crop of the cutout on mid-grey, where halos and lost strands show. */
async function edgeCrop(cutout: Buffer, out: string) {
  const meta = await sharp(cutout).metadata();
  const w = Math.round(meta.width! * 0.5);
  const crop = await sharp(cutout).extract({ left: Math.round(meta.width! * 0.25), top: 0, width: w, height: w }).resize(800, 800).toBuffer();
  await sharp({ create: { width: 800, height: 800, channels: 3, background: "#7f7f7f" } }).composite([{ input: crop }]).jpeg({ quality: 90 }).toFile(out);
}

async function verifyBg() {
  const dir = path.join(OUT, "bg-removal");
  fs.mkdirSync(dir, { recursive: true });
  const rows: string[] = [];
  for (const input of BG_INPUTS) {
    const original = fs.readFileSync(input.file);
    const started = Date.now();
    const r = await removeBackground(original);
    const ms = Date.now() - started;
    fs.writeFileSync(path.join(dir, `${input.name}.png`), r.png);
    await bgSheet(original, r.png, path.join(dir, `${input.name}-sheet.jpg`));
    await edgeCrop(r.png, path.join(dir, `${input.name}-edge.jpg`));
    const { data, info } = await sharp(r.png).raw().toBuffer({ resolveWithObject: true });
    let clear = 0, solid = 0, soft = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 0) clear++;
      else if (data[i] === 255) solid++;
      else soft++;
    }
    const n = info.width * info.height;
    const line = `${input.name}: ${info.width}x${info.height} RGBA PNG, ${(100 * clear / n).toFixed(1)}% fully transparent, ${(100 * solid / n).toFixed(1)}% fully opaque, ${(100 * soft / n).toFixed(1)}% soft edge, ${ms} ms`;
    rows.push(line);
    console.log(line);
  }
  fs.writeFileSync(path.join(dir, "stats.txt"), `model: ${bgModelName()}\n${rows.join("\n")}\n`);
}

async function verifyGenerate(): Promise<boolean> {
  const dir = path.join(OUT, "generation");
  fs.mkdirSync(dir, { recursive: true });
  const product = fs.readFileSync(PRODUCT);
  const runs = [
    {
      name: "mockup-to-model",
      input: { task: "mockup_to_model" as const, productImages: [product], referenceImages: [fs.readFileSync(MODEL_REF)], aspectRatio: "4:5" as const, brief: "Lookbook for a black logo tee." },
    },
    ...[0, 1].map((shotIndex) => ({
      name: `ai-photoshoot-shot-${shotIndex + 1}`,
      input: {
        task: "photoshoot" as const, productImages: [product], referenceImages: [fs.readFileSync(SCENE_REF)], aspectRatio: "4:5" as const,
        brief: "Night-time city rooftop, streetwear campaign, confident and candid.", modelStyle: "male", sceneStyle: "night", lightingStyle: "flash",
        shotIndex, shotCount: 2,
      },
    })),
  ];
  const provider = activeImageProvider("photoshoot");
  if (!provider) {
    const msg = `SKIPPED: no image-model key is configured. Add ${PREFERRED_IMAGE_KEY} to the API server's secrets and re-run. No outputs were generated (none are faked).`;
    fs.writeFileSync(path.join(dir, "STATUS.txt"), `${msg}\n`);
    console.log(msg);
    return false;
  }
  const log: string[] = [`provider: ${provider}`];
  for (const run of runs) {
    const started = Date.now();
    try {
      const shot = await generateShot(run.input);
      fs.writeFileSync(path.join(dir, `${run.name}.jpg`), shot.image);
      const meta = await sharp(shot.image).metadata();
      const line = `${run.name}: ${shot.provider}${shot.model ? ` (${shot.model})` : ""}, ${meta.width}x${meta.height}, ${Date.now() - started} ms`;
      log.push(line);
      console.log(line);
    } catch (err) {
      const line = `${run.name}: FAILED ${err instanceof Error ? err.message : String(err)}`;
      log.push(line);
      console.error(line);
    }
  }
  fs.writeFileSync(path.join(dir, "STATUS.txt"), `${log.join("\n")}\n`);
  return true;
}

let ok = true;
if (runBg) await verifyBg();
if (runGen) ok = await verifyGenerate();
process.exit(ok ? 0 : 2);
