/**
 * Shared types for the AI image-provider abstraction.
 *
 * This layer exists so each AI tool (Mockup to Model, AI Photoshoot, and
 * whatever ships after them) can pick a different provider AND pipeline
 * purely through server config (env vars), never a code change — see
 * `config.ts`. It does not replace or modify the existing production path
 * in `@workspace/integrations-openai-ai-server` or `routes/photography.ts`;
 * it is additive infrastructure that the benchmark script in
 * `scripts/aiProviderBenchmark` exercises today, and that a route can be
 * pointed at later once a provider wins a real, credentialed benchmark.
 */

/** A concrete, callable image provider. */
export type ProviderId =
  | "openai" // current production path: OpenAI image-edit (gpt-image-1 today; see config.ts for the migration knob)
  | "fashn-direct" // FASHN's own API, called directly (FASHN_API_KEY)
  | "fal-fashn" // FASHN's try-on model, via the fal.ai aggregator (FAL_KEY)
  | "fal-kling" // Kling Kolors virtual try-on, via fal.ai (FAL_KEY)
  | "fal-nano-banana" // Google Gemini image edit ("Nano Banana" family), via fal.ai (FAL_KEY)
  | "fal-qwen"; // Qwen image edit, via fal.ai (FAL_KEY)

/** Which family of task a provider is being asked to do. */
export type ProviderRole =
  /** Garment-on-model / virtual try-on: must preserve the real product exactly. */
  | "garment-fidelity"
  /** Free-form scene/model/pose generation: creative freedom, no product in frame yet. */
  | "creative-scene";

export type PipelineId =
  /** One call does everything: scene + garment fidelity in a single generation. */
  | "single-stage"
  /** Stage 1 (creative-scene provider) generates the scene/model/pose, then stage 2
   *  (garment-fidelity provider) composites the real product onto it. */
  | "two-stage";

export interface GenerationInput {
  /** Absolute file paths (or data: URLs) of the real product/garment photo(s). */
  productImages: string[];
  /** Absolute file paths (or data: URLs) of the seller's reference/creative photo(s). */
  referenceImages: string[];
  /** Optional free-text description of the desired shoot. */
  prompt?: string;
  /** For two-stage pipelines' stage 2: the stage-1 output to composite onto, if any. */
  sceneImage?: Buffer;
}

export interface GenerationResult {
  imageBuffer: Buffer;
  providerId: ProviderId;
  /** Best-effort cost estimate in USD for this single call, from the provider's published pricing. */
  costUsd: number;
  latencyMs: number;
  meta?: Record<string, unknown>;
}

export interface ImageProvider {
  id: ProviderId;
  role: ProviderRole;
  /** One line describing what this provider is and why it's in the matrix. */
  description: string;
  /** True only when the env vars this provider needs are actually present. Never throws. */
  isConfigured(): boolean;
  generate(input: GenerationInput): Promise<GenerationResult>;
}

/** One cell of the 5 garments × 3 reference-photo-styles benchmark matrix. */
export interface BenchmarkCase {
  id: string;
  garment: "logo-tee" | "knit-sweater" | "denim" | "jacket" | "dress";
  referenceStyle: "studio-clean" | "street-night" | "exotic-location";
  /** Fixture file the case expects at scripts/aiProviderBenchmark/fixtures/<garment>.png */
  garmentFixture: string;
  /** Fixture file the case expects at scripts/aiProviderBenchmark/fixtures/refs/<referenceStyle>.png */
  referenceFixture: string;
  prompt: string;
}

export interface BenchmarkRunResult {
  case: BenchmarkCase;
  pipeline: PipelineId;
  /** Provider(s) used: one for single-stage, two (stage1, stage2) for two-stage. */
  providers: ProviderId[];
  outputPath: string | null;
  costUsd: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
  mock: boolean;
}
