import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "@workspace/api-zod";
import { requestPrimitives, validateRequest } from "../validateRequest";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.post(
    "/users/:id",
    validateRequest({
      params: z.object({ id: requestPrimitives.uuid }),
      query: z.object({ enabled: requestPrimitives.boolean }),
      body: z.object({
        email: requestPrimitives.email,
        role: z.enum(["buyer", "seller"]),
        name: requestPrimitives.shortText,
      }),
    }),
    (req, res) => res.json({ body: req.body, query: req.query, params: req.params }),
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("validateRequest", () => {
  it("rejects invalid params, enums, types, and oversized strings", async () => {
    const response = await fetch(`${base}/users/not-a-uuid?enabled=maybe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "bad",
        role: "admin",
        name: "x".repeat(161),
      }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("coerces valid query values and normalizes email", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const response = await fetch(`${base}/users/${id}?enabled=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "TEST@EXAMPLE.COM", role: "buyer", name: "Test" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      body: { email: "test@example.com" },
      query: { enabled: true },
      params: { id },
    });
  });
});