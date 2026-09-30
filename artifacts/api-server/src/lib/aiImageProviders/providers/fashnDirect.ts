/**
 * FASHN API, called directly (not via fal.ai). Kept as an alternate path in
 * case a specific FASHN capability isn't available (or isn't current) on
 * fal.ai's wrapper — see docs/polish/ai-provider-benchmark/README.md.
 *
 * FASHN's API is async: POST /v1/run returns a prediction id, then poll
 * GET /v1/status/{id} until it completes. Gated entirely on FASHN_API_KEY;
 * generate() throws a clear, typed error if it's missing rather than
 * silently no-op'ing.
 */
import fs from "node:fs";
import type { GenerationInput, GenerationResult, ImageProvider } from "../types";
import { getFashnApiKey } from "../config";

const FASHN_BASE_URL = "https://api.fashn.ai/v1";
// FASHN v1.5/v1.6 published price per generation (see research doc for source).
const ESTIMATED_COST_USD = 0.075;
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 90_000;

function isConfigured(): boolean {
  return Boolean(getFashnApiKey());
}

function toDataUrl(filePathOrDataUrl: string): string {
  if (filePathOrDataUrl.startsWith("data:")) return filePathOrDataUrl;
  const buf = fs.readFileSync(filePathOrDataUrl);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function generate(input: GenerationInput): Promise<GenerationResult> {
  const apiKey = getFashnApiKey();
  if (!apiKey) {
    throw new Error("FASHN_API_KEY is not set — fashn-direct provider is not configured.");
  }
  const start = Date.now();

  const modelImage = toDataUrl(input.referenceImages[0] ?? input.productImages[0]);
  const garmentImage = toDataUrl(input.productImages[0]);

  const runRes = await fetch(`${FASHN_BASE_URL}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model_name: "tryon-v1.6",
      inputs: { model_image: modelImage, garment_image: garmentImage },
    }),
  });
  if (!runRes.ok) {
    throw new Error(`FASHN /run failed: ${runRes.status} ${await runRes.text()}`);
  }
  const { id } = (await runRes.json()) as { id: string };

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusRes = await fetch(`${FASHN_BASE_URL}/status/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!statusRes.ok) continue;
    const status = (await statusRes.json()) as { status: string; output?: string[]; error?: unknown };
    if (status.status === "completed" && status.output?.[0]) {
      const imgRes = await fetch(status.output[0]);
      const imageBuffer = Buffer.from(await imgRes.arrayBuffer());
      return {
        imageBuffer,
        providerId: "fashn-direct",
        costUsd: ESTIMATED_COST_USD,
        latencyMs: Date.now() - start,
        meta: { predictionId: id },
      };
    }
    if (status.status === "failed") {
      throw new Error(`FASHN prediction ${id} failed: ${JSON.stringify(status.error)}`);
    }
  }
  throw new Error(`FASHN prediction ${id} timed out after ${POLL_TIMEOUT_MS}ms`);
}

export const fashnDirectProvider: ImageProvider = {
  id: "fashn-direct",
  role: "garment-fidelity",
  description:
    "FASHN's virtual try-on API called directly. Purpose-built for garment-on-model compositing; independent sources rate it class-leading on garment/print fidelity. Alternate path to fal-fashn in case fal's wrapper lags a FASHN release.",
  isConfigured,
  generate,
};
