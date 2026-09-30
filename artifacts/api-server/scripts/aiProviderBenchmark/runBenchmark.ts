#!/usr/bin/env -S tsx
/**
 * Runs the 5-garment × 3-reference-style benchmark matrix against every
 * configured provider, single-stage AND two-stage, and writes a contact
 * sheet Dev can scan by eye.
 *
 * Usage (once FASHN_API_KEY and/or FAL_KEY and/or the OpenAI env vars are
 * set in this server's env):
 *
 *   pnpm --filter @workspace/api-server exec tsx ./scripts/aiProviderBenchmark/runBenchmark.ts
 *
 * With no provider configured, this prints exactly what's missing and
 * exits — it never fabricates results. Pass --mock to exercise the whole
 * pipeline end-to-end with placeholder images (clearly labeled as mock in
 * every output) purely to verify the wiring and contact-sheet rendering
 * are correct ahead of real keys landing:
 *
 *   pnpm --filter @workspace/api-server exec tsx ./scripts/aiProviderBenchmark/runBenchmark.ts --mock
 *
 * Fixture images: drop real photos at
 *   scripts/aiProviderBenchmark/fixtures/<garment>.png            (5 files)
 *   scripts/aiProviderBenchmark/fixtures/refs/<reference-style>.png (3 files)
 * See matrix.ts for the exact filenames expected. Not committed — no real
 * product/reference photos exist in this repo to commit.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_PROVIDERS,
  getConfiguredProviders,
  runSingleStage,
  runTwoStage,
  type BenchmarkRunResult,
  type ImageProvider,
} from "../../src/lib/aiImageProviders";
import { BENCHMARK_MATRIX } from "./matrix";
import { writeContactSheet } from "./contactSheet";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOCK = process.argv.includes("--mock");

function missingFixtures(): string[] {
  const missing: string[] = [];
  for (const c of BENCHMARK_MATRIX) {
    for (const f of [c.garmentFixture, c.referenceFixture]) {
      const abs = path.join(HERE, f);
      if (!fs.existsSync(abs) && !missing.includes(f)) missing.push(f);
    }
  }
  return missing;
}

function mockImageBuffer(label: string): Buffer {
  // A tiny deterministic 1x1 PNG stand-in is enough to prove the pipeline
  // and contact sheet work; we tag the run as `mock: true` everywhere so
  // nobody mistakes this for a real generation result.
  const PNG_1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  return Buffer.from(PNG_1x1, "base64");
}

const mockProvider = (id: string, role: "garment-fidelity" | "creative-scene", costUsd: number): ImageProvider => ({
  id: id as any,
  role,
  description: `MOCK stand-in for ${id} — no real API call made.`,
  isConfigured: () => true,
  generate: async () => ({
    imageBuffer: mockImageBuffer(id),
    providerId: id as any,
    costUsd,
    latencyMs: 400 + Math.round(Math.random() * 800),
  }),
});

async function main() {
  const missing = missingFixtures();
  if (missing.length > 0 && !MOCK) {
    console.log("Fixture images are missing — nothing was generated. Add these files, then re-run:");
    for (const m of missing) console.log(`  scripts/aiProviderBenchmark/${m}`);
    console.log("\nOr run with --mock to verify the pipeline + contact sheet with placeholder images.");
  }

  let garmentProviders: ImageProvider[];
  let sceneProviders: ImageProvider[];

  if (MOCK) {
    garmentProviders = [
      mockProvider("fashn-direct", "garment-fidelity", 0.075),
      mockProvider("fal-kling", "garment-fidelity", 0.07),
    ];
    sceneProviders = [mockProvider("openai", "creative-scene", 0.167), mockProvider("fal-nano-banana", "creative-scene", 0.15)];
  } else {
    const configured = getConfiguredProviders();
    if (configured.length === 0) {
      console.log(
        "No provider is configured (need FASHN_API_KEY, and/or FAL_KEY, and/or the OpenAI " +
          "AI_INTEGRATIONS_OPENAI_* vars). Nothing was generated — see the README for exactly " +
          "which env vars to set once Dev's FASHN/fal.ai accounts exist. Run with --mock to " +
          "verify the pipeline end-to-end with placeholder images in the meantime."
      );
      return;
    }
    garmentProviders = configured.filter((p) => p.role === "garment-fidelity");
    sceneProviders = configured.filter((p) => p.role === "creative-scene");
    if (garmentProviders.length === 0) {
      console.log("No garment-fidelity provider is configured (FASHN_API_KEY or FAL_KEY). Nothing was generated.");
      return;
    }
  }

  if (missing.length > 0 && MOCK) {
    console.log("(--mock: using placeholder images instead of the missing fixtures above.)");
  }

  const outDir = path.join(HERE, "results", MOCK ? "mock" : new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(outDir, { recursive: true });

  const runResults: BenchmarkRunResult[] = [];
  const cases = MOCK ? BENCHMARK_MATRIX.slice(0, 4) : BENCHMARK_MATRIX; // keep --mock fast

  for (const c of cases) {
    const garmentFixture = path.join(HERE, c.garmentFixture);
    const referenceFixture = path.join(HERE, c.referenceFixture);
    const input = MOCK
      ? { productImages: ["mock-product"], referenceImages: ["mock-reference"], prompt: c.prompt }
      : { productImages: [garmentFixture], referenceImages: [referenceFixture], prompt: c.prompt };

    // Pipeline A: single-stage, one call per garment-fidelity provider.
    for (const provider of garmentProviders) {
      const result = await tryRun(() => runSingleStage(provider, input as any));
      runResults.push(toRunResult(c, "single-stage", [provider.id], result, outDir));
    }

    // Pipeline B: two-stage, every (scene, garment) pair.
    for (const scene of sceneProviders) {
      for (const garment of garmentProviders) {
        const result = await tryRun(() => runTwoStage(scene, garment, input as any));
        runResults.push(toRunResult(c, "two-stage", [scene.id, garment.id], result, outDir));
      }
    }
  }

  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(runResults, null, 2));
  const sheetPath = writeContactSheet(runResults, outDir);
  console.log(`\nWrote ${runResults.length} result(s) to ${outDir}`);
  console.log(`Contact sheet: ${sheetPath}`);
}

async function tryRun<T extends { imageBuffer: Buffer; costUsd: number; latencyMs: number }>(
  fn: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function toRunResult(
  c: (typeof BENCHMARK_MATRIX)[number],
  pipeline: "single-stage" | "two-stage",
  providers: string[],
  result: Awaited<ReturnType<typeof tryRun>>,
  outDir: string
): BenchmarkRunResult {
  if (!result.ok) {
    return {
      case: c,
      pipeline,
      providers: providers as any,
      outputPath: null,
      costUsd: 0,
      latencyMs: 0,
      ok: false,
      error: result.error,
      mock: MOCK,
    };
  }
  const fileName = `${c.id}__${pipeline}__${providers.join("+")}.png`.replace(/\//g, "-");
  const outputPath = path.join(outDir, fileName);
  fs.writeFileSync(outputPath, result.value.imageBuffer);
  return {
    case: c,
    pipeline,
    providers: providers as any,
    outputPath: fileName,
    costUsd: result.value.costUsd,
    latencyMs: result.value.latencyMs,
    ok: true,
    mock: MOCK,
  };
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Benchmark run failed:", err);
    process.exit(1);
  });
