import { Buffer } from "node:buffer";
import { editImages, generateImageBuffer, openai } from "./client";
import type { ImageOperation } from "./prompts";

export interface VisualQualityResult {
  pass: boolean;
  reasons: string[];
  scores?: Record<string, number>;
}

export class ImageQualityError extends Error {
  readonly code = "IMAGE_QUALITY_FAILED";
  readonly reasons: string[];

  constructor(reasons: string[]) {
    super("Generated image did not meet the required visual quality standard.");
    this.name = "ImageQualityError";
    this.reasons = reasons.slice(0, 6);
  }
}

export class ImageQualityUnavailableError extends Error {
  readonly code = "IMAGE_QUALITY_UNAVAILABLE";

  constructor() {
    super("Visual quality verification was unavailable.");
    this.name = "ImageQualityUnavailableError";
  }
}

function toDataUrl(buffer: Buffer): string {
  const mime =
    buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      ? "image/png"
      : buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
        ? "image/jpeg"
        : buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP"
          ? "image/webp"
          : "image/png";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function parseEvaluation(content: string | null | undefined): VisualQualityResult {
  if (!content) throw new Error("The visual evaluator returned no decision.");
  const clean = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(clean) as Partial<VisualQualityResult>;
  if (typeof parsed.pass !== "boolean" || !Array.isArray(parsed.reasons)) {
    throw new Error("The visual evaluator returned an invalid decision.");
  }
  return {
    pass: parsed.pass,
    reasons: parsed.reasons.filter((reason): reason is string => typeof reason === "string").slice(0, 6),
    scores: parsed.scores && typeof parsed.scores === "object" ? parsed.scores as Record<string, number> : undefined,
  };
}

const QA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    pass: { type: "boolean" },
    reasons: { type: "array", items: { type: "string" }, maxItems: 6 },
  },
  required: ["pass", "reasons"],
} as const;

export const visualQualityCriteria: Record<ImageOperation, string> = {
  outfit_swap: "Check face and model identity, hair, body proportions, pose, hands, framing, crop, camera angle, scene continuity, lighting continuity, and faithful transfer of the selected garment. Reject any changed person or scene, or any altered silhouette, color, artwork, typography, seams, stitching, or material behavior.",
  photoshoot: "Check faithful product silhouette, fit, proportions, color, graphic/logo placement, typography legibility, seams, stitching, hems, hardware, fabric hand and drape, material behavior, lighting, shadow, framing, and requested camera treatment.",
  mockup_to_model: "Check faithful transfer from mockup to model: silhouette, fit, proportions, color, artwork scale and placement, logo and typography legibility, distortion, seams, stitching, hems, hardware, fabric hand and drape, pose, scene, lighting, crop, and camera treatment.",
  text_to_design: "Check the candidate against the written brief with no source image required: intended silhouette, color palette, graphic/logo placement, exact requested text and typography legibility, distortion, seam construction, stitching, and believable material behavior.",
  sketch_to_design: "Check the source sketch's silhouette, panel lines, proportions, distinctive details, graphic/logo placement, exact typography, color direction, seam construction, stitching, fit, and material behavior. Reject invented or omitted construction details.",
  prompt_edit: "Check that only the requested edit changed. Verify preservation of every locked silhouette, color, artwork, logo, typography, seam, stitch, hem, construction detail, texture, scale, crop, and material behavior.",
  logo: "Check the candidate against the written brief with no source image required: exact brand name or initials, spelling, typography legibility, crisp geometry, intended style and color, balanced placement, no distortion, no pseudo-text, and suitability as a fashion identity mark.",
  lifestyle: "Check faithful product silhouette, fit, proportions, color, artwork/logo placement, typography, seams, stitching, fabric drape, material behavior, natural integration, scene/reference continuity, lighting, shadows, depth of field, framing, and requested camera treatment.",
  background_remove: "Check that the complete background is transparent with no residual backdrop, halo, added shadow, or texture. Verify the foreground subject is otherwise unchanged: silhouette, fine edges, color, artwork, logo, typography, seams, stitching, texture, scale, position, and crop.",
  background_replace: "Check that only the background changed. Verify the foreground identity/subject, silhouette, fine edges, color, artwork, logo, typography, seams, stitching, texture, scale, position, and crop remain unchanged, while the requested background, lighting blend, and shadows are coherent.",
};

/**
 * Fast, strict visual QA. It intentionally fails closed: an outage or
 * malformed evaluator response never approves an unverified customer asset.
 */
export async function evaluateImageQuality(input: {
  output: Buffer;
  references?: Buffer[];
  brief: string;
  operation: ImageOperation;
}): Promise<VisualQualityResult> {
  const criteria = visualQualityCriteria[input.operation];

  const referenceContent = (input.references ?? []).map((reference) => ({
    type: "image_url" as const,
    image_url: { url: toDataUrl(reference), detail: "high" as const },
  }));

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a strict fashion image quality inspector. Return only the requested JSON object. Pass only when the output is faithful and usable, not merely plausible. ${criteria}`,
        },
        {
          role: "user",
          content: [
            ...referenceContent,
            { type: "image_url", image_url: { url: toDataUrl(input.output), detail: "high" as const } },
            {
              type: "text",
              text: `Operation: ${input.operation}\nWritten brief: <brief>${input.brief.slice(0, 1200)}</brief>\nThe reference images precede the candidate output. Evaluate the candidate against every reference and the brief.`,
            },
          ] as any,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "fashion_visual_quality",
          strict: true,
          schema: QA_SCHEMA,
        },
      } as any,
      max_completion_tokens: 500,
    });
    return parseEvaluation(response.choices[0]?.message?.content);
  } catch {
    throw new ImageQualityUnavailableError();
  }
}

export interface QualityGenerationInput {
  operation: ImageOperation;
  prompt: string;
  brief: string;
  references?: Buffer[];
  generate: (prompt: string) => Promise<Buffer>;
  evaluate?: typeof evaluateImageQuality;
}

/**
 * Generate, inspect, and correct exactly once. The retry is internal to one
 * request, so callers keep their existing user-facing quota semantics.
 */
export async function generateWithVisualQa(input: QualityGenerationInput): Promise<Buffer> {
  const evaluate = input.evaluate ?? evaluateImageQuality;
  let prompt = input.prompt;
  let lastReasons: string[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const output = await input.generate(prompt);
    const evaluation = await evaluate({
      output,
      references: input.references,
      brief: input.brief,
      operation: input.operation,
    });
    if (evaluation.pass) return output;
    lastReasons = evaluation.reasons.length > 0 ? evaluation.reasons : ["The result did not satisfy the requested quality criteria."];
    if (attempt === 0) {
      prompt = `${input.prompt}\n\nSTRICT CORRECTION PASS: Regenerate the image and correct every failed QA item. Do not trade away reference fidelity while correcting these issues:\n- ${lastReasons.join("\n- ")}`;
    }
  }

  throw new ImageQualityError(lastReasons);
}

export async function generateImageWithVisualQa(input: Omit<QualityGenerationInput, "generate"> & {
  size?: "1024x1024" | "512x512" | "256x256";
}): Promise<Buffer> {
  return generateWithVisualQa({
    ...input,
    generate: (prompt) => generateImageBuffer(prompt, input.size ?? "1024x1024"),
  });
}

export async function editImagesWithVisualQa(input: Omit<QualityGenerationInput, "generate"> & {
  imageFiles: string[];
  outputPath?: string;
  editOptions?: { background?: "transparent" | "opaque" | "auto" };
}): Promise<Buffer> {
  return generateWithVisualQa({
    ...input,
    generate: (prompt) => editImages(input.imageFiles, prompt, input.outputPath, input.editOptions),
  });
}