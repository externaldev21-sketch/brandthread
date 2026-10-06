import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  userId: "user-a" as string | null,
  prefs: new Map<string, Record<string, unknown>>(),
  cache: new Map<string, Record<string, unknown>>(),
  modelCalls: [] as Array<{ model: string; texts: string[] }>,
  modelReply: null as null | ((texts: string[]) => string),
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!state.userId) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = state.userId;
    next();
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ op: "eq", column, value }),
  inArray: (column: unknown, values: unknown[]) => ({ op: "in", column, values }),
}));

vi.mock("@workspace/db", () => {
  const userDisplayPreferences = { _name: "prefs", userId: "userId" };
  const translationCache = { _name: "cache", cacheKey: "cacheKey" };
  const rowsFor = (table: { _name: string }, where: any): Record<string, unknown>[] => {
    if (table._name === "prefs") {
      const row = state.prefs.get(where.value);
      return row ? [row] : [];
    }
    return (where.values as string[]).flatMap((key) => {
      const row = state.cache.get(key);
      return row ? [{ cacheKey: key, ...row }] : [];
    });
  };
  const db = {
    select: () => ({
      from: (table: { _name: string }) => ({
        where: (where: any) => {
          const rows = () => rowsFor(table, where);
          return {
            limit: async (n: number) => rows().slice(0, n),
            then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(rows()).then(resolve, reject),
          };
        },
      }),
    }),
    insert: (table: { _name: string }) => ({
      values: (values: any) => ({
        onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
          const { userId, ...rest } = values;
          state.prefs.set(userId, { ...(state.prefs.get(userId) ?? {}), ...rest, ...set });
        },
        onConflictDoNothing: async () => {
          for (const row of Array.isArray(values) ? values : [values]) {
            if (table._name === "cache" && !state.cache.has(row.cacheKey)) {
              const { cacheKey, ...rest } = row;
              state.cache.set(cacheKey, rest);
            }
          }
        },
      }),
    }),
  };
  return { db, userDisplayPreferences, translationCache };
});

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: async (params: { model: string; messages: Array<{ role: string; content: string }> }) => {
          const { texts } = JSON.parse(params.messages[1]!.content) as { texts: string[] };
          state.modelCalls.push({ model: params.model, texts });
          const content = state.modelReply
            ? state.modelReply(texts)
            : JSON.stringify({
              items: texts.map((t) => t.startsWith("Hola")
                ? { detectedLanguage: "es", translation: t.replace("Hola", "Hello") }
                : { detectedLanguage: "en", translation: t }),
            });
          return { model: params.model, choices: [{ message: { content } }] };
        },
      },
    },
  },
}));

import translateRouter from "../translate";
import displayPreferencesRouter from "../display-preferences";
import { rateLimitPolicyFor } from "../../middlewares/rateLimit";
import { hasTranslatableText, parseModelItems, translationCacheKey } from "../../lib/translation";
import { normalizeDisplayPreferences } from "../../lib/displayPreferences";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/translate", translateRouter);
  app.use("/api/display-preferences", displayPreferencesRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.userId = "user-a";
  state.prefs.clear();
  state.cache.clear();
  state.modelCalls = [];
  state.modelReply = null;
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://openai.test";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
});

const readJson = (res: Response): Promise<any> => res.json();

const json = (method: string, body?: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe("POST /api/translate", () => {
  it("requires a signed-in account", async () => {
    state.userId = null;
    const res = await fetch(`${base}/api/translate`, json("POST", { texts: ["Hola amigos"], targetLanguage: "en" }));
    expect(res.status).toBe(401);
    expect(state.modelCalls).toHaveLength(0);
  });

  it("is covered by the expensive (AI) rate-limit policy", () => {
    expect(rateLimitPolicyFor("POST", "/api/translate", true)?.id).toBe("expensive");
    expect(rateLimitPolicyFor("POST", "/api/v1/translate", true)?.id).toBe("expensive");
  });

  it("translates, detects the language and caches so a repeat costs no model call", async () => {
    const first = await fetch(`${base}/api/translate`, json("POST", { texts: ["Hola amigos", "Good morning"], targetLanguage: "en" }));
    const body = await readJson(first);
    expect(first.status, JSON.stringify(body)).toBe(200);
    expect(body.translations).toEqual([
      { text: "Hola amigos", translatedText: "Hello amigos", detectedLanguage: "es", sameLanguage: false },
      { text: "Good morning", translatedText: "Good morning", detectedLanguage: "en", sameLanguage: true },
    ]);
    expect(state.modelCalls).toHaveLength(1);
    expect(state.modelCalls[0]!.model).toBe("gpt-5.4-mini");
    expect(state.cache.get(translationCacheKey("en", "Hola amigos"))).toMatchObject({ translatedText: "Hello amigos", detectedLanguage: "es" });

    const again = await fetch(`${base}/api/translate`, json("POST", { texts: [" Hola amigos "], targetLanguage: "en" }));
    expect((await readJson(again)).translations[0]).toMatchObject({ translatedText: "Hello amigos", detectedLanguage: "es" });
    expect(state.modelCalls).toHaveLength(1);
  });

  it("sends only cache misses, deduplicated, and skips text with no words", async () => {
    await fetch(`${base}/api/translate`, json("POST", { texts: ["Hola amigos"], targetLanguage: "en" }));
    state.modelCalls = [];
    const res = await fetch(`${base}/api/translate`, json("POST", { texts: ["Hola amigos", "Hola mundo", "Hola mundo", "🔥🔥 #ootd"], targetLanguage: "en" }));
    const body = await readJson(res);
    expect(state.modelCalls).toEqual([{ model: "gpt-5.4-mini", texts: ["Hola mundo"] }]);
    expect(body.translations[3]).toEqual({ text: "🔥🔥 #ootd", translatedText: "🔥🔥 #ootd", detectedLanguage: "und", sameLanguage: true });
  });

  it("answers 503 TRANSLATION_NOT_CONFIGURED without the integration and never fakes a result", async () => {
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const res = await fetch(`${base}/api/translate`, json("POST", { texts: ["Hola amigos"], targetLanguage: "en" }));
    expect(res.status).toBe(503);
    expect((await readJson(res)).code).toBe("TRANSLATION_NOT_CONFIGURED");
    expect(state.modelCalls).toHaveLength(0);
    expect(state.cache.size).toBe(0);
  });

  it("still serves cached translations when the integration is missing", async () => {
    await fetch(`${base}/api/translate`, json("POST", { texts: ["Hola amigos"], targetLanguage: "en" }));
    delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const res = await fetch(`${base}/api/translate`, json("POST", { texts: ["Hola amigos"], targetLanguage: "en" }));
    expect(res.status).toBe(200);
  });

  it("answers 502 when the model reply does not match and caches nothing", async () => {
    state.modelReply = () => JSON.stringify({ items: [] });
    const res = await fetch(`${base}/api/translate`, json("POST", { texts: ["Hola amigos"], targetLanguage: "en" }));
    expect(res.status).toBe(502);
    expect((await readJson(res)).code).toBe("TRANSLATION_FAILED");
    expect(state.cache.size).toBe(0);
  });

  it("rejects unsupported languages and oversized batches", async () => {
    expect((await fetch(`${base}/api/translate`, json("POST", { texts: ["Hola"], targetLanguage: "xx" }))).status).toBe(400);
    expect((await fetch(`${base}/api/translate`, json("POST", { texts: Array(21).fill("Hola"), targetLanguage: "en" }))).status).toBe(400);
    expect((await fetch(`${base}/api/translate`, json("POST", { texts: [], targetLanguage: "en" }))).status).toBe(400);
  });
});

describe("/api/display-preferences", () => {
  it("returns the defaults for an account that never changed anything", async () => {
    const res = await fetch(`${base}/api/display-preferences`);
    expect(await readJson(res)).toEqual({
      preferences: { translationLanguage: "en", autoTranslateCaptions: false, textSize: "default", highContrastIcons: false },
    });
  });

  it("persists a patch per account and merges later patches", async () => {
    let res = await fetch(`${base}/api/display-preferences`, json("PATCH", { textSize: "larger", translationLanguage: "es" }));
    expect((await readJson(res)).preferences).toMatchObject({ textSize: "larger", translationLanguage: "es" });
    res = await fetch(`${base}/api/display-preferences`, json("PATCH", { highContrastIcons: true, autoTranslateCaptions: true }));
    expect((await readJson(res)).preferences).toEqual({
      translationLanguage: "es", autoTranslateCaptions: true, textSize: "larger", highContrastIcons: true,
    });
    state.userId = "user-b";
    res = await fetch(`${base}/api/display-preferences`);
    expect((await readJson(res)).preferences.textSize).toBe("default");
  });

  it("rejects unknown values and keys, and signed-out callers", async () => {
    expect((await fetch(`${base}/api/display-preferences`, json("PATCH", { textSize: "huge" }))).status).toBe(400);
    expect((await fetch(`${base}/api/display-preferences`, json("PATCH", { theme: "light" }))).status).toBe(400);
    state.userId = null;
    expect((await fetch(`${base}/api/display-preferences`)).status).toBe(401);
  });
});

describe("translation helpers", () => {
  it("treats emoji, tags and links as nothing to translate", () => {
    expect(hasTranslatableText("🔥🔥")).toBe(false);
    expect(hasTranslatableText("#ootd @maison https://x.y/z")).toBe(false);
    expect(hasTranslatableText("Nuevo drop #ootd")).toBe(true);
  });

  it("parses model JSON strictly", () => {
    expect(parseModelItems('{"items":[{"detectedLanguage":"FR","translation":"Hi"}]}', 1)).toEqual([{ detectedLanguage: "fr", translation: "Hi" }]);
    expect(() => parseModelItems("nope", 1)).toThrow();
    expect(() => parseModelItems('{"items":[]}', 1)).toThrow();
  });

  it("normalises stored preferences", () => {
    expect(normalizeDisplayPreferences({ textSize: "bogus", translationLanguage: "xx", highContrastIcons: true }))
      .toEqual({ translationLanguage: "en", autoTranslateCaptions: false, textSize: "default", highContrastIcons: true });
  });
});
