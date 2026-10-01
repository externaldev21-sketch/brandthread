/**
 * The OpenAI client reports token usage for completed calls so the admin
 * dashboard can attribute AI spend. Verified against a local stand-in for the
 * OpenAI API: the real SDK code path runs, only the network endpoint is fake.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

const env = vi.hoisted(() => ({ server: null as null | { url: string } }));
let server: http.Server;
let requests = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests += 1;
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const params = JSON.parse(body || "{}");
      res.setHeader("content-type", "application/json");
      if (params.model === "boom") { res.statusCode = 500; res.end(JSON.stringify({ error: { message: "nope" } })); return; }
      res.end(JSON.stringify({
        id: "x", object: "chat.completion", created: 0, model: params.model,
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "hi" } }],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  env.server = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = env.server.url;
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test";
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("AI usage metering", () => {
  it("reports tokens for a completed chat call and leaves the response untouched", async () => {
    const { openai, setAiUsageReporter } = await import("@workspace/integrations-openai-ai-server");
    const seen: unknown[] = [];
    setAiUsageReporter((r) => seen.push(r));
    const out = await openai.chat.completions.create({ model: "gpt-4.1", messages: [{ role: "user", content: "hello" }] });
    expect(out.choices[0]!.message.content).toBe("hi");
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([{ feature: "chat", model: "gpt-4.1", inputTokens: 120, outputTokens: 30 }]);
    setAiUsageReporter(null);
  });

  it("never lets a failing call or a throwing reporter break the caller", async () => {
    const { openai, setAiUsageReporter } = await import("@workspace/integrations-openai-ai-server");
    setAiUsageReporter(() => { throw new Error("reporter down"); });
    const ok = await openai.chat.completions.create({ model: "gpt-4.1", messages: [{ role: "user", content: "x" }] });
    expect(ok.choices[0]!.message.content).toBe("hi");
    await expect(
      openai.chat.completions.create({ model: "boom", messages: [{ role: "user", content: "x" }] }, { maxRetries: 0 }),
    ).rejects.toThrow();
    setAiUsageReporter(null);
    expect(requests).toBeGreaterThanOrEqual(2);
  });
});
