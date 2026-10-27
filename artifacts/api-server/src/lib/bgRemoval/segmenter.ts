/**
 * Self-hosted background removal: salient-object segmentation run in-process
 * with onnxruntime-node. No provider key and no per-call cost. The subject is
 * never redrawn: the output is the seller's original photo with a predicted
 * alpha matte applied, so the product (print, stitching, logo) stays exact.
 *
 * Models (all MIT/Apache ONNX exports hosted on the rembg GitHub release):
 *   birefnet-general-lite  BiRefNet, Swin-T backbone. Best hair/edge quality we can
 *                          run on CPU; ~6 GB peak RAM per inference at 1024x1024.
 *   birefnet-general       BiRefNet, Swin-L backbone. Marginally crisper, ~1.7x slower.
 *   isnet-general-use      IS-Net. Under 1 GB, but leaves stray patches on busy scenes.
 *
 * BG_REMOVAL_MODEL picks one; unset ("auto") uses birefnet-general-lite when the
 * process may use at least 7 GB, otherwise isnet-general-use.
 * The file lives at BG_REMOVAL_MODEL_PATH, else <BG_REMOVAL_MODEL_DIR or
 * artifacts/api-server/.models>/<file>. build.mjs prefetches it; if it is still
 * missing it is downloaded on first use.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export type BgModelName = "birefnet-general-lite" | "birefnet-general" | "isnet-general-use";

interface ModelSpec {
  file: string;
  bytes: number;
  mean: [number, number, number];
  std: [number, number, number];
  /** BiRefNet emits logits; IS-Net emits probabilities already. */
  logits: boolean;
}

const RELEASE = "https://github.com/danielgatis/rembg/releases/download/v0.0.0";
const IMAGENET = { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] } as const;

export const BG_MODELS: Record<BgModelName, ModelSpec> = {
  "birefnet-general-lite": {
    file: "BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx",
    bytes: 224_005_088,
    mean: [...IMAGENET.mean],
    std: [...IMAGENET.std],
    logits: true,
  },
  "birefnet-general": {
    file: "BiRefNet-general-epoch_244.onnx",
    bytes: 972_666_916,
    mean: [...IMAGENET.mean],
    std: [...IMAGENET.std],
    logits: true,
  },
  "isnet-general-use": {
    file: "isnet-general-use.onnx",
    bytes: 178_648_008,
    mean: [0.5, 0.5, 0.5],
    std: [1, 1, 1],
    logits: false,
  },
};

const INPUT_SIZE = 1024;
const BIREFNET_MIN_BYTES = 7 * 1024 ** 3;

type Env = Record<string, string | undefined>;

/** Memory this process may use: the cgroup limit when there is one, else physical RAM. */
function usableMemory(): number {
  const constrained = typeof process.constrainedMemory === "function" ? process.constrainedMemory() : 0;
  const total = os.totalmem();
  return constrained && constrained > 0 && constrained < total ? constrained : total;
}

export function bgModelName(env: Env = process.env, memory = usableMemory()): BgModelName {
  const requested = env.BG_REMOVAL_MODEL?.trim();
  if (requested && requested in BG_MODELS) return requested as BgModelName;
  return memory >= BIREFNET_MIN_BYTES ? "birefnet-general-lite" : "isnet-general-use";
}

/** artifacts/api-server, whether running from src/ (tsx) or the dist/ bundle. */
function appRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "build.mjs"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export function bgModelPath(env: Env = process.env, model = bgModelName(env)): string {
  if (env.BG_REMOVAL_MODEL_PATH) return env.BG_REMOVAL_MODEL_PATH;
  const dir = env.BG_REMOVAL_MODEL_DIR || path.join(appRoot(), ".models");
  return path.join(dir, BG_MODELS[model].file);
}

/** Downloads the model if it is not on disk yet (size-checked, atomic rename). */
export async function ensureBgModel(env: Env = process.env, model = bgModelName(env)): Promise<string> {
  const target = bgModelPath(env, model);
  const spec = BG_MODELS[model];
  try {
    if ((await fsp.stat(target)).size > 0) return target;
  } catch { /* not downloaded yet */ }
  if (env.BG_REMOVAL_MODEL_PATH) throw new Error(`BG_REMOVAL_MODEL_PATH points at a missing file: ${target}`);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const partial = `${target}.${process.pid}.part`;
  const resp = await fetch(`${RELEASE}/${spec.file}`);
  if (!resp.ok || !resp.body) throw new Error(`Background-removal model download failed (${resp.status})`);
  await pipeline(Readable.fromWeb(resp.body as never), fs.createWriteStream(partial));
  const { size } = await fsp.stat(partial);
  if (size !== spec.bytes) {
    await fsp.rm(partial, { force: true });
    throw new Error(`Background-removal model download was incomplete (${size} of ${spec.bytes} bytes)`);
  }
  await fsp.rename(partial, target);
  return target;
}

type OrtModule = typeof import("onnxruntime-node");
type Session = import("onnxruntime-node").InferenceSession;
let sessionPromise: Promise<{ ort: OrtModule; session: Session; spec: ModelSpec }> | null = null;

function loadSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const model = bgModelName();
      const modelPath = await ensureBgModel(process.env, model);
      const ort = await import("onnxruntime-node");
      const session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "all",
        // Without the arena, the multi-GB activation buffers go back to the OS
        // after each run instead of staying reserved for the life of the process.
        enableCpuMemArena: false,
        enableMemPattern: false,
      });
      return { ort, session, spec: BG_MODELS[model] };
    })().catch((err) => {
      sessionPromise = null; // let the next request retry (e.g. a transient download failure)
      throw err;
    });
  }
  return sessionPromise;
}

// One inference at a time: a run already uses every core, and two at once only
// doubles the memory peak without finishing either sooner.
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

interface Decoded { rgb: Buffer; width: number; height: number }

async function decode(input: Buffer): Promise<Decoded> {
  // .rotate() bakes in EXIF orientation so the matte lines up with what the seller sees.
  const { data, info } = await sharp(input, { failOn: "none" }).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgb: data, width: info.width, height: info.height };
}

/** Predicts the subject's alpha matte at the photo's own resolution (1 byte per pixel). */
export async function predictMatte(img: Decoded): Promise<Buffer> {
  const { ort, session, spec } = await loadSession();
  const small = await sharp(img.rgb, { raw: { width: img.width, height: img.height, channels: 3 } })
    .resize(INPUT_SIZE, INPUT_SIZE, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer();
  const plane = INPUT_SIZE * INPUT_SIZE;
  const tensor = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) tensor[c * plane + i] = (small[i * 3 + c]! / 255 - spec.mean[c]!) / spec.std[c]!;
  }
  const outputs = await serialize(() =>
    session.run({ [session.inputNames[0]!]: new ort.Tensor("float32", tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]) }),
  );
  const raw = outputs[session.outputNames[0]!]!.data as Float32Array;
  const prob = new Float32Array(plane);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < plane; i++) {
    const p = spec.logits ? 1 / (1 + Math.exp(-raw[i]!)) : raw[i]!;
    prob[i] = p;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  const span = max - min || 1;
  const matteSmall = Buffer.alloc(plane);
  for (let i = 0; i < plane; i++) matteSmall[i] = Math.round(((prob[i]! - min) / span) * 255);
  return sharp(matteSmall, { raw: { width: INPUT_SIZE, height: INPUT_SIZE, channels: 1 } })
    .resize(img.width, img.height, { fit: "fill", kernel: "lanczos3" })
    .extractChannel(0) // sharp otherwise widens a 1-channel raw input to 3 channels
    .raw()
    .toBuffer();
}

/**
 * Colour decontamination for soft edges (hair, fur, sheer fabric): a pixel at
 * alpha a shows a*F + (1-a)*B, so on a new backdrop the old background B shows
 * up as a halo. F is estimated as the blurred average of nearby solid-subject
 * pixels and the edge pixel is pulled toward it in proportion to (1 - a).
 */
export async function decontaminate(img: Decoded, matte: Buffer): Promise<Buffer> {
  const { rgb, width, height } = img;
  const n = width * height;
  const seed = Buffer.alloc(n * 3);
  const weight = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    if (matte[i]! >= 235) {
      seed[i * 3] = rgb[i * 3]!;
      seed[i * 3 + 1] = rgb[i * 3 + 1]!;
      seed[i * 3 + 2] = rgb[i * 3 + 2]!;
      weight[i * 3] = weight[i * 3 + 1] = weight[i * 3 + 2] = 255;
    }
  }
  const sigma = Math.max(3, Math.round(Math.max(width, height) / 250));
  const blurRaw = (b: Buffer) => sharp(b, { raw: { width, height, channels: 3 } }).blur(sigma).raw().toBuffer();
  const [sum, wsum] = await Promise.all([blurRaw(seed), blurRaw(weight)]);

  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const a = matte[i]!;
    const w = wsum[i * 3]!;
    for (let c = 0; c < 3; c++) {
      const observed = rgb[i * 3 + c]!;
      if (a === 0 || a >= 250 || w < 6) {
        out[i * 4 + c] = observed;
      } else {
        const fg = Math.min(255, (sum[i * 3 + c]! * 255) / w);
        const k = a / 255;
        out[i * 4 + c] = Math.round(observed * k + fg * (1 - k));
      }
    }
    out[i * 4 + 3] = a;
  }
  return out;
}

export interface CutoutResult {
  png: Buffer;
  width: number;
  height: number;
  /** Fraction of the frame the subject covers (alpha > 50%). 0 means nothing was found. */
  coverage: number;
  model: BgModelName;
}

export async function removeBackground(input: Buffer): Promise<CutoutResult> {
  const img = await decode(input);
  const matte = await predictMatte(img);
  const rgba = await decontaminate(img, matte);
  let solid = 0;
  for (let i = 0; i < matte.length; i++) if (matte[i]! > 127) solid++;
  const png = await sharp(rgba, { raw: { width: img.width, height: img.height, channels: 4 } })
    .png({ compressionLevel: 6 })
    .toBuffer();
  return { png, width: img.width, height: img.height, coverage: solid / matte.length, model: bgModelName() };
}
