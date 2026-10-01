import { describe, expect, it, vi } from "vitest";

// buildStudioCoverArtPrompt itself never touches the database or the OpenAI
// integration, but the module also exports functions
// (generateStudioCoverArtCandidates, etc.) that import those clients at
// module scope, which throw immediately without real provisioning — mocked
// here so this pure prompt-builder test can run standalone.
vi.mock("@workspace/db", () => ({ db: {}, studioCoverArt: {} }));
vi.mock("@workspace/integrations-openai-ai-server/image", () => ({ generateImageBuffer: vi.fn() }));

const { buildStudioCoverArtPrompt, STUDIO_COVER_SUBJECTS } = await import("./studioCoverArt");

/**
 * Dev asked for two variants per card: 'mono' (strict monochrome, the
 * original) and 'gel' (same chrome object and monochrome UI/backdrop, but
 * the photo gets one signature coloured light in its reflections — never a
 * flat colour fill, never neon). This only exercises the pure prompt
 * builder — no DB/network involved, so it runs everywhere.
 */
describe("buildStudioCoverArtPrompt variants", () => {
  it("defaults to the strictly monochrome prompt", () => {
    const prompt = buildStudioCoverArtPrompt("add-product");
    expect(prompt).toContain("strictly monochrome black/silver palette");
    expect(prompt).not.toContain("gel light");
  });

  it("the 'gel' variant keeps the same hero object/material/backdrop but adds one signature coloured light", () => {
    const mono = buildStudioCoverArtPrompt("add-product", "mono");
    const gel = buildStudioCoverArtPrompt("add-product", "gel");
    const subject = STUDIO_COVER_SUBJECTS["add-product"];
    expect(gel).toContain(subject.object);
    expect(gel).toContain(subject.materialAccent);
    expect(gel).toContain(subject.backdropTexture);
    expect(gel).toContain("gel light");
    expect(gel).not.toContain(mono); // different colour instruction, not merely appended
    expect(gel).toContain("never a flat colour fill");
    expect(gel).toContain("never neon");
  });

  it("every known card produces a valid prompt for both variants without throwing", () => {
    for (const cardId of Object.keys(STUDIO_COVER_SUBJECTS)) {
      expect(() => buildStudioCoverArtPrompt(cardId, "mono")).not.toThrow();
      expect(() => buildStudioCoverArtPrompt(cardId, "gel")).not.toThrow();
    }
  });

  it("go-live's gel variant still reads as red — its one allowed colour in either variant", () => {
    const gel = buildStudioCoverArtPrompt("go-live", "gel");
    expect(gel).toContain("red gel light");
  });
});
