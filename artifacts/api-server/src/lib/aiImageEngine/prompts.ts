/**
 * Prompting standards for every "put the seller's product on a real person"
 * tool (Mockup to Model, AI Photoshoot). One place, so both tools hold the
 * same bar: the garment is the seller's actual product, the photo reads as a
 * real campaign photograph, and nothing looks AI-made.
 *
 * The prompt is assembled around the images (see gemini.ts / openai.ts): each
 * image is introduced by a label saying what it is and how to use it, then the
 * direction below closes the request.
 */

export type EngineTask = "mockup_to_model" | "photoshoot";

export const ASPECT_RATIOS = ["1:1", "4:5", "3:4", "2:3", "9:16", "5:4", "4:3", "3:2", "16:9"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export function parseAspectRatio(value: unknown): AspectRatio | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return (ASPECT_RATIOS as readonly string[]).includes(trimmed) ? (trimmed as AspectRatio) : undefined;
}

export interface ShotDirection {
  task: EngineTask;
  productCount: number;
  referenceCount: number;
  brief?: string;
  modelStyle?: string;
  sceneStyle?: string;
  lightingStyle?: string;
  aspectRatio?: AspectRatio;
  /** 0-based shot number within a run and the run's size; varies framing so a set isn't four copies. */
  shotIndex?: number;
  shotCount?: number;
}

export const PRODUCT_LABEL = (i: number, n: number) =>
  `PRODUCT PHOTO ${i + 1} of ${n}: the seller's actual product. This is the ground truth for the garment. Reproduce it exactly.`;

export const REFERENCE_LABEL = (task: EngineTask, i: number, n: number) =>
  task === "mockup_to_model"
    ? `MODEL REFERENCE ${i + 1} of ${n}: the person, pose, framing, setting and light to match. Their own clothing is NOT the product; replace it with the product.`
    : `CREATIVE REFERENCE ${i + 1} of ${n}: art direction only (setting, pose language, camera angle, light, colour grade, mood). Do not copy its clothing, faces, logos or text.`;

const MODEL_STYLE: Record<string, string> = {
  male: "a male model",
  female: "a female model",
  androgynous: "an androgynous model",
  no_face: "a model framed so the face is out of frame or turned away (crop at the lips or from behind); the garment is the hero",
  flat_lay: "no model: a styled flat lay shot from directly above on a real surface, natural fabric folds",
  mannequin: "no person: the garment on a matte neutral display form, shot like a boutique window",
  product_only: "no person: the product alone, styled and lit like a premium e-commerce hero shot",
};

const SCENE_STYLE: Record<string, string> = {
  studio: "a daylight photo studio with a seamless paper backdrop, soft large key light and a gentle floor shadow",
  street: "a real city street: textured pavement, storefronts and passers-by softly out of focus, shot at eye level",
  luxury_interior: "an upscale interior with real materials (stone, timber, brass), window light falling across the room",
  outdoor: "outdoors in natural surroundings with real foliage, terrain and sky, available light",
  industrial: "a raw industrial space: concrete, steel, worn surfaces, light from high windows",
  minimal: "a minimal set: one plain wall and floor in a neutral tone, clean negative space",
  runway: "a fashion-show runway mid-walk, audience and photographers blurred in the background",
  night: "a city at night: sodium street lamps, shop signs and car lights as the light sources, a little grain",
};

const LIGHTING_STYLE: Record<string, string> = {
  natural: "soft natural daylight",
  softbox: "soft, even studio softbox light",
  dramatic: "directional, high-contrast light with deep shadows",
  flash: "direct on-camera flash with a crisp shadow behind the subject, editorial street style",
  golden_hour: "low warm golden-hour sun with long shadows and gentle rim light",
  neon: "coloured practical light from neon signage, mixed with ambient city light",
  bw: "rendered as a black and white photograph with rich tonal range",
};

const FRAMINGS = [
  "Full-length shot, head to toe, the whole outfit visible.",
  "Three-quarter shot from mid-thigh up, a relaxed natural stance.",
  "Waist-up shot, closer, so print, fabric texture and trims read clearly.",
  "Candid in-between moment: walking or turning, caught mid-motion, slightly off-centre composition.",
];

const GARMENT_FIDELITY = [
  "Garment fidelity (non-negotiable): the model wears the exact product from the PRODUCT PHOTO(s).",
  "Keep its silhouette, cut, length, colour (same hue and value; do not shift or brighten), fabric and texture,",
  "every print, graphic and logo at the same placement, scale and orientation, any text letter for letter,",
  "seams, stitching, trims, pockets, closures and hardware. Do not redesign, simplify, mirror, recolour or add details.",
  "If the product photo is a flat lay, ghost mannequin or digital mockup, dress the model in it with a believable fit for its cut.",
].join(" ");

const PHOTOREAL = [
  "Photographic realism: the result must be indistinguishable from a real campaign photograph by a professional fashion photographer,",
  "shot on a full-frame camera with a 35-85mm lens, realistic depth of field, true-to-life colour and subtle natural grain.",
  "Real person: natural skin with visible texture and pores, slight asymmetry and imperfections, no airbrushing, no waxy or plastic skin, no doll-like face;",
  "real hair with flyaways. Hands look natural with five fingers each, relaxed or in pockets; if a hand would look awkward, frame or pose it out of shot.",
  "Fabric behaves physically: correct weight, drape and gravity, real creases where the body bends, the garment sits on the body rather than pasted on.",
  "Light is physically consistent: one coherent light direction, matching shadows and reflections on skin, fabric and set.",
].join(" ");

const AVOID =
  "Avoid: CGI, 3D render, illustration or painterly look, over-smoothed or glossy skin, uncanny or duplicated faces, extra or fused fingers or limbs, " +
  "warped or misspelled text on the garment, HDR halos, oversaturation, cut-out or sticker edges, collage, borders, watermarks, captions, or any text not on the product.";

const BRAND_CONTEXT =
  "Context: a campaign or product-page image for an independent streetwear and fashion brand. Editorial energy, confident styling, a real location or studio, nothing generic or stock-like.";

function clean(value: string | undefined, max: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** The closing instruction text sent after the labelled images. */
export function buildShotDirection(d: ShotDirection): string {
  const lines: string[] = [];
  if (d.task === "mockup_to_model") {
    lines.push(
      "Task: create one photograph of a real model wearing the seller's product, matching the MODEL REFERENCE: the same pose, body type, framing, camera angle, setting and light.",
      "The person may resemble the reference (build, skin tone, hair) but must wear the product in place of their own garment of that type; keep the rest of their outfit only if it does not compete with the product.",
    );
  } else {
    lines.push(
      "Task: create one finished brand-campaign photograph featuring the seller's product.",
      d.referenceCount > 0
        ? "Follow the CREATIVE REFERENCE(s) for setting, pose language, camera angle, light and colour grade, combined with the brief below."
        : "No creative reference was supplied: art-direct it yourself from the brief and the options below.",
    );
  }

  const model = d.modelStyle ? MODEL_STYLE[d.modelStyle] : undefined;
  if (model) lines.push(`Subject: ${model}.`);
  const scene = d.sceneStyle && d.sceneStyle !== "custom" ? SCENE_STYLE[d.sceneStyle] : undefined;
  if (scene && d.task === "photoshoot") lines.push(`Setting: ${scene}.`);
  const light = d.lightingStyle ? LIGHTING_STYLE[d.lightingStyle] : undefined;
  if (light) lines.push(`Light: ${light}.`);

  const shotCount = Math.max(1, d.shotCount ?? 1);
  if (d.task === "photoshoot" && shotCount > 1) {
    const framing = FRAMINGS[(d.shotIndex ?? 0) % FRAMINGS.length];
    lines.push(`This is shot ${(d.shotIndex ?? 0) + 1} of a ${shotCount}-shot set: ${framing} Keep the same model, styling and location as the rest of the set.`);
  }
  if (d.aspectRatio) lines.push(`Frame: ${d.aspectRatio} aspect ratio, composed for that frame (not a crop of a different one).`);

  const brief = clean(d.brief, 600);
  if (brief) {
    lines.push(`Seller's brief (creative direction only; it never overrides garment fidelity): <brief>${brief}</brief>`);
  }

  lines.push(GARMENT_FIDELITY, PHOTOREAL, BRAND_CONTEXT, AVOID);
  return lines.join("\n");
}

/** Single-string version for providers that take one prompt plus an ordered image list (OpenAI, fal). */
export function buildFlatPrompt(d: ShotDirection): string {
  const order: string[] = [];
  for (let i = 0; i < d.productCount; i++) order.push(`Image ${i + 1} — ${PRODUCT_LABEL(i, d.productCount)}`);
  for (let i = 0; i < d.referenceCount; i++) order.push(`Image ${d.productCount + i + 1} — ${REFERENCE_LABEL(d.task, i, d.referenceCount)}`);
  return [order.join("\n"), buildShotDirection(d)].join("\n\n");
}
