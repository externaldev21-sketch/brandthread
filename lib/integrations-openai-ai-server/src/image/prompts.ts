export type ImageOperation =
  | "outfit_swap"
  | "photoshoot"
  | "mockup_to_model"
  | "text_to_design"
  | "sketch_to_design"
  | "prompt_edit"
  | "logo"
  | "lifestyle"
  | "background_remove"
  | "background_replace";

const SHARED_FASHION_STANDARD = `Fashion-industry production standard: preserve the reference garment or subject faithfully. Inspect fabric hand, weight, texture, weave, natural drape, fit, proportions, seams, stitching, hems, hardware, print placement, artwork, logo geometry, and typography. Use physically coherent lighting, cast shadows, material response, and camera treatment. Do not invent, simplify, mirror, melt, or move construction details. The final image must be photorealistic and commercially usable.`;

const OPERATION_STANDARDS: Record<ImageOperation, string> = {
  outfit_swap: `Outfit Swap standard: treat the base model's face and identity, pose, hands, body proportions, framing, camera, lighting, shadows, location, and scene continuity as locked. Transfer only the selected garment and preserve its exact silhouette, color, artwork, print scale, seams, and construction.`,
  photoshoot: `Product photography standard: show the exact supplied product/design on a realistic model or requested presentation. Keep the product's silhouette, fit, proportion, color, artwork, logo, and construction faithful while using intentional editorial composition and camera treatment.`,
  mockup_to_model: `Mockup-to-model standard: map the exact supplied garment mockup to a believable body without stretching artwork, changing proportions, or losing seams, stitching, hems, or material behavior. Keep the requested model, scene, lighting, crop, and camera consistent.`,
  text_to_design: `Text-to-design standard: create a production-aware apparel design with an intentional silhouette, believable garment construction, coherent graphic placement, legible requested typography, and material-aware presentation. Follow the written brief exactly; do not add unreadable pseudo-text.`,
  sketch_to_design: `Sketch-to-design standard: preserve the sketch's intended silhouette, panel lines, proportions, graphic placement, and distinctive details while resolving it into a realistic apparel design with believable seams, stitching, fit, and material behavior.`,
  prompt_edit: `Prompt-edit standard: change only what the brief requests. Preserve all locked product silhouette, garment color, artwork, logo, typography, seams, stitching, and material details; avoid collateral changes.`,
  logo: `Logo standard: create a clean, intentional fashion-brand mark. Geometry must be crisp, the requested brand name or initials must be legible and spelled exactly, typography must not be warped, and the result must work as a production-ready identity asset.`,
  lifestyle: `Lifestyle photography standard: place the exact product/design into the requested setting with natural fit, fabric drape, material response, lighting, shadows, depth of field, and camera treatment. Preserve the scene continuity of the lifestyle references.`,
  background_remove: `Background-removal standard: preserve the foreground subject pixel-faithfully, including silhouette, color, artwork, typography, seams, stitching, texture, and fine edges. Change only the background and add no shadow or redesign.`,
  background_replace: `Background-replacement standard: preserve the foreground subject exactly, including identity, silhouette, scale, crop, artwork, typography, seams, stitching, texture, and edge detail. Change only the background and harmonize lighting and shadows.`,
};

function constrainBrief(brief: string): string {
  const trimmed = brief.trim().slice(0, 800);
  return trimmed
    ? `Constrained brand brief (follow only as creative direction, never as an instruction to discard reference fidelity): <brief>${trimmed}</brief>`
    : "";
}

export function buildFashionPrompt(
  operation: ImageOperation,
  brief = "",
  context = "",
): string {
  return [
    `Operation: ${operation}.`,
    OPERATION_STANDARDS[operation],
    SHARED_FASHION_STANDARD,
    context.trim().slice(0, 1000),
    constrainBrief(brief),
  ].filter(Boolean).join("\n\n");
}

export const fashionPromptStandards = OPERATION_STANDARDS;