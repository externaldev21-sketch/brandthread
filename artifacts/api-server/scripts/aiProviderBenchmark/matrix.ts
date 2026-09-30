import type { BenchmarkCase } from "../../src/lib/aiImageProviders/types";

const GARMENTS: BenchmarkCase["garment"][] = ["logo-tee", "knit-sweater", "denim", "jacket", "dress"];
const REFERENCE_STYLES: { id: BenchmarkCase["referenceStyle"]; label: string }[] = [
  { id: "studio-clean", label: "clean studio reference photo" },
  { id: "street-night", label: "street scene at night, mixed streetlight" },
  { id: "exotic-location", label: "exotic location with dramatic natural light" },
];

const GARMENT_PROMPT: Record<BenchmarkCase["garment"], string> = {
  "logo-tee": "graphic tee with a printed logo — logo/text must stay pixel-exact, zero warping",
  "knit-sweater": "cable-knit sweater — preserve knit texture and true color",
  denim: "denim jacket or jeans — preserve stitching, fade pattern, hardware",
  jacket: "structured jacket — preserve silhouette, seams, zipper/button hardware",
  dress: "patterned dress — preserve print scale/placement and drape",
};

/**
 * 5 garments × 3 reference styles = 15 cases. Fixture files are NOT
 * included in this repo (no real product/reference photos to commit) —
 * `runBenchmark.ts` checks for them at the paths below and tells you
 * exactly what's missing before it runs anything for real.
 */
export const BENCHMARK_MATRIX: BenchmarkCase[] = GARMENTS.flatMap((garment) =>
  REFERENCE_STYLES.map((ref): BenchmarkCase => ({
    id: `${garment}--${ref.id}`,
    garment,
    referenceStyle: ref.id,
    garmentFixture: `fixtures/${garment}.png`,
    referenceFixture: `fixtures/refs/${ref.id}.png`,
    prompt: `Product photoshoot. Garment: ${GARMENT_PROMPT[garment]}. Match the ${ref.label} for scene, pose, and lighting.`,
  }))
);
