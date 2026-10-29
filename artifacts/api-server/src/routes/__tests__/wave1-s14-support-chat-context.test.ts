/**
 * POST /api/support-chat/message builds the AI's account context from real
 * data. A seller with products must get the seller summary (products with
 * their price), never the "Could not load account data." fallback.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const prompts = vi.hoisted(() => [] as string[]);

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: async (params: { messages: Array<{ role: string; content: string }> }) => {
          prompts.push(params.messages[0].content);
          return { choices: [{ message: { content: "Hi!" } }], usage: { total_tokens: 1 } };
        },
      },
    },
  },
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user");
    next();
  },
}));

import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { db, dropWalletTransactions, dropWallets, drops, productVariants, products, users } from "@workspace/db";

const suffix = crypto.randomBytes(5).toString("hex");
const seller = `s14-chat-seller-${suffix}`;
let server: Server;
let dropId = "";
let walletId = "";
let base = "";

beforeAll(async () => {
  const { default: router } = await import("../support-chat");
  const app = express();
  app.use(express.json());
  app.use("/api/support-chat", router);
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await db.insert(users).values({
    clerkId: seller, email: `${seller}@test.invalid`, name: "S14 chat", role: "seller", accountType: "seller", brandName: `Brand ${suffix}`,
  });
  const [p] = await db.insert(products).values({ ownerId: seller, name: `Chat Hoodie ${suffix}`, status: "active", category: "tops" })
    .returning({ id: products.id });
  await db.insert(productVariants).values([
    { productId: p.id, size: "M", sku: `S14C-M-${p.id}`, priceCents: 4500, stock: 3 },
    { productId: p.id, size: "L", sku: `S14C-L-${p.id}`, priceCents: 5500, stock: 3 },
  ]);
  const [drop] = await db.insert(drops).values({ ownerId: seller, name: `Fall Drop ${suffix}`, type: "pre-order" }).returning({ id: drops.id });
  dropId = drop.id;
  const [wallet] = await db.insert(dropWallets).values({
    dropId: drop.id, sellerId: seller, balanceCents: 10_000, releasedCents: 3_000, reservedCents: 2_000,
  }).returning({ id: dropWallets.id });
  walletId = wallet.id;
  await db.insert(dropWalletTransactions).values({ walletId: wallet.id, type: "deposit", amountCents: 10_000, description: "Preorder" });
});

afterAll(async () => {
  await db.delete(dropWalletTransactions).where(eq(dropWalletTransactions.walletId, walletId));
  await db.delete(dropWallets).where(eq(dropWallets.id, walletId));
  await db.delete(drops).where(eq(drops.id, dropId));
  await db.delete(products).where(eq(products.ownerId, seller));
  await db.delete(users).where(eq(users.clerkId, seller));
  await new Promise<void>((r) => server.close(() => r()));
});

describe("support chat account context", () => {
  it("includes the seller's products with a real price", async () => {
    const res = await fetch(`${base}/api/support-chat/message`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": seller },
      body: JSON.stringify({ messages: [{ role: "user", content: "What do I sell?" }] }),
    });
    expect(res.status).toBe(200);
    const prompt = prompts.at(-1) ?? "";
    expect(prompt).not.toContain("Could not load account data.");
    expect(prompt).toContain("=== SELLER ACCOUNT ===");
    expect(prompt).toContain(`Chat Hoodie ${suffix} (tops, $45.00`);
    // Drop wallet + its transactions (these raw queries used non-existent
    // columns and always fell back to "No drop wallets yet.").
    expect(prompt).toContain(`- Drop "Fall Drop ${suffix}": held=$70.00, available=$50.00, released=$30.00`);
    expect(prompt).toContain(`deposit $100.00 for drop "Fall Drop ${suffix}"`);
  });
});
