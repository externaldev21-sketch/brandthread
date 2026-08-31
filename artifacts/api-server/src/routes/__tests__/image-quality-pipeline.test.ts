import { describe, expect, it, vi } from "vitest";
import {
  ImageQualityError,
  buildFashionPrompt,
  generateWithVisualQa,
  visualQualityCriteria,
  type VisualQualityResult,
} from "@workspace/integrations-openai-ai-server/image";

function decision(pass: boolean, reasons: string[] = []): VisualQualityResult {
  return { pass, reasons, scores: {} };
}

describe("premium image quality pipeline", () => {
  it("accepts a first result that passes visual QA", async () => {
    const generate = vi.fn(async () => Buffer.from("first"));
    const evaluate = vi.fn(async () => decision(true));

    const result = await generateWithVisualQa({
      operation: "text_to_design",
      prompt: "base prompt",
      brief: "black hoodie",
      generate,
      evaluate,
    });

    expect(result.toString()).toBe("first");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("regenerates once with evaluator reasons in a stricter correction prompt", async () => {
    const prompts: string[] = [];
    const generate = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return Buffer.from(`output-${prompts.length}`);
    });
    const evaluate = vi.fn()
      .mockResolvedValueOnce(decision(false, ["logo moved", "seam disappeared"]))
      .mockResolvedValueOnce(decision(true));

    const result = await generateWithVisualQa({
      operation: "prompt_edit",
      prompt: "change only the background",
      brief: "warm studio",
      references: [Buffer.from("reference")],
      generate,
      evaluate,
    });

    expect(result.toString()).toBe("output-2");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(prompts[1]).toContain("STRICT CORRECTION PASS");
    expect(prompts[1]).toContain("logo moved");
    expect(prompts[1]).toContain("seam disappeared");
  });

  it("throws a retryable quality failure after exactly one regeneration", async () => {
    const generate = vi.fn(async () => Buffer.from("bad"));
    const evaluate = vi.fn(async () => decision(false, ["typography is illegible"]));

    await expect(generateWithVisualQa({
      operation: "logo",
      prompt: "logo prompt",
      brief: "Brandthread",
      generate,
      evaluate,
    })).rejects.toMatchObject({
      name: "ImageQualityError",
      code: "IMAGE_QUALITY_FAILED",
      reasons: ["typography is illegible"],
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("does not approve an output when the evaluator is unavailable", async () => {
    const generate = vi.fn(async () => Buffer.from("unverified"));
    const evaluate = vi.fn(async () => {
      throw new Error("vision outage");
    });

    await expect(generateWithVisualQa({
      operation: "photoshoot",
      prompt: "photo prompt",
      brief: "studio",
      generate,
      evaluate,
    })).rejects.toThrow("vision outage");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("keeps fashion construction and identity criteria in centralized prompts", () => {
    const outfit = buildFashionPrompt("outfit_swap", "editorial", "locked hero");
    const design = buildFashionPrompt("sketch_to_design", "oversized hoodie", "source sketch");

    expect(outfit).toMatch(/face and identity/i);
    expect(outfit).toMatch(/pose/i);
    expect(outfit).toMatch(/scene continuity/i);
    expect(design).toMatch(/silhouette/i);
    expect(design).toMatch(/seams/i);
    expect(design).toMatch(/stitching/i);
    expect(design).toMatch(/typography/i);
  });

  it("uses operation-specific visual QA rubrics for fine-detail invariants", () => {
    expect(visualQualityCriteria.outfit_swap).toMatch(/face and model identity/i);
    expect(visualQualityCriteria.background_remove).toMatch(/transparent/i);
    expect(visualQualityCriteria.background_replace).toMatch(/only the background changed/i);
    expect(visualQualityCriteria.prompt_edit).toMatch(/only the requested edit changed/i);
    expect(visualQualityCriteria.logo).toMatch(/exact brand name or initials/i);
    expect(visualQualityCriteria.mockup_to_model).toMatch(/artwork scale and placement/i);
  });

  it("exposes a dedicated quality error type", () => {
    expect(new ImageQualityError(["bad fit"])).toMatchObject({
      code: "IMAGE_QUALITY_FAILED",
      reasons: ["bad fit"],
    });
  });
});