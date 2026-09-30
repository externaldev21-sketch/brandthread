import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { aiSafetyGuard, collectChatStrings, collectPromptStrings, findGeneratedImages } from "../aiSafetyGuard";
import { setImageModerationProvider } from "../../lib/imageModeration";
import { setTextModerationProvider } from "../../lib/aiSafety/promptFilter";

// 1x1 PNG padded so the base64 is long enough to count as an image payload.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const B64 = PNG.toString("base64");

let server: Server | null = null;
afterEach(async () => {
  setImageModerationProvider();
  setTextModerationProvider();
  delete process.env.AI_OUTPUT_MODERATION_STRICT;
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

async function start(opts: Parameters<typeof aiSafetyGuard>[1] & { signedIn?: boolean }, handler?: express.RequestHandler) {
  const hits: string[] = [];
  const recorded: Array<{ tool: string; sha256: string }> = [];
  const app = express();
  app.use(express.json());
  app.use(
    "/t",
    aiSafetyGuard("test-tool", {
      getUserId: () => (opts.signedIn === false ? null : "user_1"),
      recordProvenance: async (i) => {
        recorded.push(i);
      },
      ...opts,
    }),
    handler ??
      ((req, res) => {
        hits.push(String(req.body?.prompt));
        res.json({ b64_json: B64 });
      }),
  );
  setTextModerationProvider(async () => null);
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  const url = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/t`;
  const post = async (body: unknown) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as any };
  };
  return { post, hits, recorded };
}

describe("aiSafetyGuard", () => {
  it("blocks a filtered prompt before the route runs", async () => {
    const { post, hits } = await start({});
    const r = await post({ prompt: "Gucci logo hoodie" });
    expect(r.status).toBe(422);
    expect(r.json.code).toBe("AI_PROMPT_BLOCKED");
    expect(r.json.category).toBe("trademark");
    expect(typeof r.json.error).toBe("string");
    expect(hits).toEqual([]);
  });

  it("passes a clean prompt, labels output ai_generated and records provenance", async () => {
    setImageModerationProvider(async () => ({ status: "allowed" }));
    const { post, recorded } = await start({});
    const r = await post({ prompt: "plain black tee on white" });
    expect(r.status).toBe(200);
    expect(r.json.b64_json).toBe(B64);
    expect(r.json.ai_generated).toBe(true);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("withholds an output image flagged by moderation", async () => {
    setImageModerationProvider(async () => ({ status: "rejected", categories: ["sexual"] }));
    const { post, recorded } = await start({});
    const r = await post({ prompt: "plain black tee on white" });
    expect(r.status).toBe(422);
    expect(r.json.code).toBe("AI_OUTPUT_BLOCKED");
    expect(r.json.b64_json).toBeUndefined();
    expect(recorded).toHaveLength(0);
  });

  it("returns the image (fail-open) when moderation is unavailable, and withholds it when strict", async () => {
    setImageModerationProvider(async () => ({ status: "unavailable" }));
    const open = await start({});
    expect((await open.post({ prompt: "plain tee" })).status).toBe(200);
    await new Promise<void>((r) => server!.close(() => r()));

    process.env.AI_OUTPUT_MODERATION_STRICT = "1";
    const strict = await start({});
    const r = await strict.post({ prompt: "plain tee" });
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("AI_OUTPUT_UNAVAILABLE");
  });

  it("does nothing for signed-out requests (no moderation spend)", async () => {
    let imageChecks = 0;
    setImageModerationProvider(async () => {
      imageChecks += 1;
      return { status: "allowed" };
    });
    const { post } = await start({ signedIn: false });
    const r = await post({ prompt: "Gucci logo hoodie" });
    expect(r.status).toBe(200);
    expect(r.json.ai_generated).toBeUndefined();
    expect(imageChecks).toBe(0);
  });

  it("does not touch error responses or responses without images", async () => {
    const { post } = await start({}, (_req, res) => {
      res.status(502).json({ error: "Generation failed" });
    });
    const r = await post({ prompt: "plain tee" });
    expect(r.status).toBe(502);
    expect(r.json).toEqual({ error: "Generation failed" });
  });

  it("chat mode filters safety terms but not brand names, and skips output wrapping", async () => {
    const { post } = await start({ mode: "chat" }, (_req, res) => {
      res.json({ reply: "ok" });
    });
    expect((await post({ messages: [{ role: "user", content: "How do I price against Nike?" }] })).status).toBe(200);
    const blocked = await post({ messages: [{ role: "user", content: "show me nude woman pics" }] });
    expect(blocked.status).toBe(422);
    expect(blocked.json.category).toBe("sexual");
  });

  it("chat mode only reads the latest user turn, not the history or context", async () => {
    const { post } = await start({ mode: "chat" }, (_req, res) => {
      res.json({ reply: "ok" });
    });
    const r = await post({
      messages: [
        { role: "user", content: "nude woman" },
        { role: "assistant", content: "I can't help with that." },
        { role: "user", content: "ok, suggest a hoodie colour" },
      ],
      context: { products: ["Gucci"] },
    });
    expect(r.status).toBe(200);
  });
});

describe("extractors", () => {
  it("collectPromptStrings skips data URLs, links and base64 blobs", () => {
    const out = collectPromptStrings({
      prompt: "a tee",
      referenceImage: "data:image/png;base64,AAAA",
      url: "https://x.test/a.png",
      blob: "A".repeat(2000),
      nested: { brandName: "Acme" },
      list: ["one", "two"],
    });
    expect(out.sort()).toEqual(["Acme", "a tee", "one", "two"]);
  });

  it("collectChatStrings reads message/text and the last user message", () => {
    expect(collectChatStrings({ text: "hi", messages: [{ role: "user", content: "a" }, { role: "user", content: "b" }] }).sort()).toEqual(["b", "hi"]);
    expect(collectChatStrings(null)).toEqual([]);
  });

  it("findGeneratedImages finds top-level and nested b64_json", () => {
    expect(findGeneratedImages({ b64_json: B64 })).toHaveLength(1);
    expect(findGeneratedImages({ results: [{ b64_json: B64 }, { b64_json: B64 }], n: 2 })).toHaveLength(2);
    expect(findGeneratedImages({ b64_json: "short" })).toHaveLength(0);
  });
});
